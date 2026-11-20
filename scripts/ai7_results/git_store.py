"""Detached results checkout and append-only Git publication."""
from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import subprocess
import tempfile

from .records import KNOWN_USAGE, GAMES_LIMIT, JSON_LIMIT, identifier, load, parse, require, scan, sha


class GitFailure(ValueError):
    pass


def git(root, *args, input=None, env=None):
    process = subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", "-C", str(root), *args],
        input=input, capture_output=True, env=env,
    )
    if process.returncode:
        raise GitFailure(f"git {args[0]}: {process.stderr.decode(errors='replace').strip()}")
    return process.stdout


class ResultsGit:
    def __init__(self, repo, worktree, remote="origin", branch="experiment/shared-evaluation"):
        self.repo = Path(git(repo, "rev-parse", "--show-toplevel").decode().strip()).resolve()
        self.worktree = worktree.resolve()
        self.remote = identifier(remote)
        require(not self.worktree.is_relative_to(self.repo) and not self.repo.is_relative_to(self.worktree),
                "Use a separate results worktree outside the development checkout")
        self.ref = "refs/heads/" + branch
        git(self.repo, "check-ref-format", self.ref)
        token = sha(os.fsencode(self.worktree) + b"\0" + remote.encode() + b"\0" + self.ref.encode())[:24]
        self.cache = "refs/ai7-results/" + token

    @contextmanager
    def locked(self):
        self.worktree.parent.mkdir(parents=True, exist_ok=True)
        lock = self.worktree.parent / ("." + self.worktree.name + ".ai7.lock")
        with lock.open("a") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            yield

    def check_checkout(self):
        root = Path(git(self.worktree, "rev-parse", "--show-toplevel").decode().strip()).resolve()
        require(root == self.worktree, "Results path is not its own worktree")
        require(git(self.worktree, "rev-parse", "--absolute-git-dir")
                != git(self.repo, "rev-parse", "--absolute-git-dir"), "Expected a linked worktree")
        require(git(self.worktree, "rev-parse", "--path-format=absolute", "--git-common-dir")
                == git(self.repo, "rev-parse", "--path-format=absolute", "--git-common-dir"),
                "Unrelated results checkout")
        require(git(self.worktree, "rev-parse", "--abbrev-ref", "HEAD").strip() == b"HEAD",
                "Results checkout must be detached")
        require(not git(self.worktree, "status", "--porcelain", "--untracked-files=all").strip(),
                "Results checkout has user changes")

    def fetch(self):
        git(self.repo, "fetch", "--no-tags", "--no-write-fetch-head", self.remote,
            f"+{self.ref}:{self.cache}")
        return git(self.repo, "rev-parse", self.cache).decode().strip()

    def safe_tree(self, oid):
        for entry in git(self.repo, "ls-tree", "-rlz", oid, "--", "results").split(b"\0"):
            if not entry:
                continue
            head, path = entry.split(b"\t", 1)
            mode, kind, _, length = head.split()
            limit = GAMES_LIMIT if path.endswith(b"/games.jsonl.gz") else JSON_LIMIT
            require(mode == b"100644" and kind == b"blob" and int(length) <= limit,
                    f"Unsupported results-tree artifact: {os.fsdecode(path)}")

    def sync(self):
        old = None
        if self.worktree.exists():
            self.check_checkout()
            old = git(self.worktree, "rev-parse", "HEAD").decode().strip()
        oid = self.fetch()
        self.safe_tree(oid)
        if old and old != oid:
            git(self.repo, "merge-base", "--is-ancestor", old, oid)
            changes = git(self.repo, "diff", "--name-status", "--no-renames", "-z", old, oid, "--", "results")
            change_tokens = changes.split(b"\0")[:-1]
            require(all(change == b"A" for change in change_tokens[::2]), "Published results were modified or deleted")
            git(self.worktree, "checkout", "--no-overwrite-ignore", "--detach", oid)
        elif old is None:
            git(self.repo, "worktree", "add", "--detach", str(self.worktree), oid)
        try:
            runs, events = scan(self.worktree / "results")
        except (ValueError, OSError, KeyError, TypeError):
            if old and old != oid:
                git(self.worktree, "checkout", "--no-overwrite-ignore", "--detach", old)
            raise
        return oid, runs, events

    def additions(self, files, manifest, runs, events):
        study_file = f"results/{manifest['study_id']}/study.json"
        study = parse(files[study_file])
        if not (self.worktree / study_file).exists() and study["dataset_role"] == "confirmation":
            events = load(KNOWN_USAGE) + events
            prior_use = {"executed", "inspected", "selected", "tuned", "retired"}
            used_datasets = {event["dataset_id"] for event in events if event["state"] in prior_use}
            require(study["dataset_id"] not in used_datasets,
                    "The registered dataset has prior use. Declare a historical study or review the inventory.")
            protocol_file = f"results/{manifest['study_id']}/protocol.json"
            incoming = set(parse(files[protocol_file])["deck_seeds"])
            for event in events:
                evidence = event["evidence"]
                if event["state"] in prior_use and isinstance(evidence, dict):
                    require(not (incoming & set(evidence.get("deck_seeds", []))),
                            "Confirmation deck IDs overlap a registered exposure")
            for path in (self.worktree / "results").glob("*/study.json"):
                other = load(path)
                if other["dataset_id"] in used_datasets or other["dataset_role"] == "historical":
                    prior_program = load(path.with_name("protocol.json"))
                    require(not (incoming & set(prior_program["deck_seeds"])),
                            "Confirmation deck IDs overlap a used or historical study")
        for existing, _, _ in runs:
            if (existing["run_id"] == manifest["run_id"]
                    or existing["evaluation"]["evaluation_id"] == manifest["evaluation"]["evaluation_id"]):
                require(all(existing[key] == manifest[key] for key in ("run_id", "study_id", "treatment"))
                        and existing["evaluation"]["evaluation_id"] == manifest["evaluation"]["evaluation_id"],
                        "Run or evaluation ID already belongs to another publication")
        additions = {}
        for name, data in files.items():
            target = self.worktree / name
            if target.exists():
                require(target.is_file() and target.read_bytes() == data, f"Published identity conflict: {name}")
            else:
                additions[name] = data
        return additions

    def commit(self, base, additions, run_id):
        # A temporary index leaves the detached checkout clean even if commit/push is interrupted.
        with tempfile.TemporaryDirectory(prefix="ai7-result-index-") as directory:
            env = {**os.environ, "GIT_INDEX_FILE": str(Path(directory) / "index")}
            git(self.worktree, "read-tree", base, env=env)
            for name, data in sorted(additions.items()):
                oid = git(self.worktree, "hash-object", "-w", "--stdin", input=data, env=env).decode().strip()
                git(self.worktree, "update-index", "--add", "--cacheinfo", f"100644,{oid},{name}", env=env)
            tree = git(self.worktree, "write-tree", env=env).decode().strip()
            return git(self.worktree, "commit-tree", tree, "-p", base, "-m",
                       f"results(ai7): publish {run_id}", env=env).decode().strip()

    def push(self, commit):
        git(self.worktree, "push", "--porcelain", self.remote, f"{commit}:{self.ref}")

    def publish(self, files, manifest, attempts=3):
        with self.locked():
            for attempt in range(attempts):
                base, runs, events = self.sync()
                additions = self.additions(files, manifest, runs, events)
                if not additions:
                    return {"status": "already_published", "commit": base, "attempts": attempt + 1}
                commit = self.commit(base, additions, manifest["run_id"])
                try:
                    self.push(commit)
                except GitFailure:
                    # A concurrent publisher or an interrupted response can move the ref.
                    # The next iteration validates that tip and checks byte identity again.
                    if self.fetch() == base or attempt + 1 == attempts:
                        raise
                    continue
                oid, _, _ = self.sync()
                return {"status": "published", "commit": commit, "synced_commit": oid, "attempts": attempt + 1}
        raise AssertionError("Unreachable retry loop")
