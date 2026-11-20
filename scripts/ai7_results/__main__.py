"""Publish, sync and analyze AI-7 result records. No evaluator or trainer is launched."""
import argparse
from pathlib import Path
import tempfile

from .analysis import analyze, markdown
from .git_store import ResultsGit
from .records import (KNOWN_USAGE, JSON_LIMIT, RAW_LIMIT, bounded, dataset_id, encode, event_files,
                      fingerprint, identifier, load, parse,
                      require, rows_from_reports, scan, sha, study_and_protocol, write_run)


def staged_package(path):
    require({p.name for p in path.iterdir()} == {"results"}, "Expected a single staged results tree")
    runs, _ = scan(path / "results")
    require(len(runs) == 1, "Each staged publication must contain exactly one run")
    files = {str(p.relative_to(path)): p.read_bytes() for p in (path / "results").rglob("*") if p.is_file()}
    return files, runs[0][0]


def bind(record, key, value):
    require(record.get(key, value) == value, f"Producer metadata differs: {key}")
    record[key] = value


def stage(args):
    study_bytes = bounded(args.study, JSON_LIMIT)
    protocol_bytes = bounded(args.protocol, JSON_LIMIT)
    study, protocol = parse(study_bytes), parse(protocol_bytes)
    for key, value in {"protocol_id": protocol["protocol_id"], "protocol_sha256": sha(protocol_bytes),
                       "dataset_id": dataset_id(protocol["deck_seeds"]),
                       "evaluator_source_sha256": protocol["evaluator"]["source_sha256"]}.items():
        bind(study, key, value)
    bind(study["structural"], "sampling_sha256", fingerprint(protocol["sampling"]))
    study, protocol, opponents = study_and_protocol(encode(study), protocol_bytes)
    manifest = load(args.manifest)
    training_manifest = getattr(args, "training_manifest", None)
    if training_manifest:
        raw = load(training_manifest)
        bind(manifest, "configuration_sha256", fingerprint(raw["config"]))
        bind(manifest, "source_commit", raw["provenance"]["source_revision"])
        bind(manifest, "training_seed", raw["config"]["seed"])
        if "source_hashes" in raw["provenance"]:
            bind(manifest, "training_source_sha256", raw["provenance"]["source_hashes"])
    checkpoint = manifest["checkpoint"]
    checkpoint_path = getattr(args, "checkpoint", None)
    if checkpoint_path:
        from scripts.ai7.shared_protocol import sha256
        bind(checkpoint, "sha256", sha256(checkpoint_path))
        checkpoint.setdefault("filename", checkpoint_path.name)
    evaluation = manifest["evaluation"]
    bind(evaluation, "checkpoint_sha256", checkpoint["sha256"])
    for key in ("dataset_id", "protocol_sha256"):
        bind(evaluation, key, study[key])
    proof = bounded(args.conformance, JSON_LIMIT)
    if args.report:
        rows = rows_from_reports(args.report, manifest, opponents)
    else:
        rows = [parse(line) for line in bounded(args.games, RAW_LIMIT).splitlines()]
    files, manifest = write_run(study, protocol, opponents, manifest, proof, rows)
    files[f"results/{study['study_id']}/study.json"] = encode(study)
    files[f"results/{study['study_id']}/protocol.json"] = protocol_bytes
    events = load(args.dataset_events) if args.dataset_events else []
    if rows:
        evaluation = manifest["evaluation"]
        events.append({"dataset_id": study["dataset_id"], "event_id": evaluation["evaluation_id"] + "-executed",
                       "state": "executed", "at": evaluation["at"], "machine_id": evaluation["machine_id"],
                       "evidence": {"evaluation_id": evaluation["evaluation_id"], "run_id": manifest["run_id"],
                                    "completed_games": len(rows), "protocol_sha256": study["protocol_sha256"]}})
    files.update(event_files(load(KNOWN_USAGE) + events))
    args.outbox.mkdir(parents=True, exist_ok=True)
    destination = args.outbox / manifest["run_id"]
    if not destination.exists():
        with tempfile.TemporaryDirectory(dir=args.outbox, prefix=".stage-") as temporary:
            package = Path(temporary) / "publication"
            for name, payload in files.items():
                path = package / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(payload)
            existing_files, _ = staged_package(package)
            require(existing_files == files, "Staging content changed")
            try:
                package.rename(destination)
            except OSError:
                if not destination.is_dir():
                    raise
    existing_files, _ = staged_package(destination)
    require(existing_files == files, f"Outbox identity conflict: {destination}")
    return destination


def checkpoint_availability(manifest, roots):
    checkpoint = manifest["checkpoint"]
    filename = checkpoint.get("filename")
    if not roots or not filename:
        return "not_checked_locally; Git contains a reference only"
    require(Path(filename).name == filename and filename not in (".", ".."), "Unsafe checkpoint filename")
    candidates = [root / filename for root in roots if (root / filename).is_file()]
    if not candidates:
        return "missing_from_supplied_checkpoint_roots"
    from scripts.ai7.shared_protocol import sha256
    return ("verified_local_bytes" if any(sha256(p) == checkpoint["sha256"] for p in candidates)
            else "local_file_hash_mismatch")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--worktree", type=Path, help="Dedicated detached results worktree")
    parser.add_argument("--remote", default="origin")
    parser.add_argument("--branch", default="experiment/shared-evaluation")
    commands = parser.add_subparsers(dest="command", required=True)
    publish = commands.add_parser("publish-run")
    for name in ("study", "protocol", "manifest", "conformance", "games", "dataset-events", "staged", "outbox",
                 "training-manifest", "checkpoint"):
        publish.add_argument("--" + name, type=Path)
    publish.add_argument("--report", action="append", type=Path)
    publish.add_argument("--push", action="store_true", help="Authorize committing and pushing this validated publication")
    sync = commands.add_parser("sync-results")
    sync.add_argument("--checkpoint-root", type=Path, action="append", default=[])
    analyze_parser = commands.add_parser("analyze-study")
    analyze_parser.add_argument("--study-id", required=True)
    analyze_parser.add_argument("--output", type=Path, required=True, help="New report directory outside the results worktree")
    args = parser.parse_args(argv)
    from .git_store import git
    try:
        repo = Path(git(args.repo, "rev-parse", "--show-toplevel").decode().strip())
        worktree = args.worktree or repo.parent / ("." + repo.name + "-shared-results")
        store = ResultsGit(repo, worktree, args.remote, args.branch)
        if args.command == "publish-run":
            raw_inputs = (args.study, args.protocol, args.manifest, args.conformance, args.games,
                          args.report, args.dataset_events, args.training_manifest, args.checkpoint)
            if args.staged:
                require(not any(raw_inputs), "--staged cannot be combined with source inputs")
                staged = args.staged.resolve()
            else:
                require(all(raw_inputs[:4]) and bool(args.report) != bool(args.games),
                        "Provide study, protocol, manifest, conformance and either report JSONs or per-game JSONL")
                args.outbox = (args.outbox or repo / "benchmark-results/ai7-selfplay/results-outbox").resolve()
                require(not args.outbox.is_relative_to(store.worktree), "Keep the outbox outside the results worktree")
                staged = stage(args)
            files, manifest = staged_package(staged)
            info = store.publish(files, manifest) if args.push else {"status": "validated_and_staged_offline"}
            result = {"run_id": manifest["run_id"], "outbox": str(staged), **info}
        elif args.command == "sync-results":
            with store.locked():
                old = None
                if store.worktree.exists():
                    store.check_checkout()
                    old = git(store.worktree, "rev-parse", "HEAD").decode().strip()
                oid, runs, events = store.sync()
                added = (set(git(store.worktree, "diff", "--name-only", "-z", "--diff-filter=A",
                                 old, oid, "--", "results").decode().split("\0")) if old else None)
                new_ids = [manifest["run_id"] for manifest, _, _ in runs if added is None or
                           f"results/{manifest['study_id']}/{manifest['treatment']}/{manifest['run_id']}/manifest.json" in added]
            result = {"commit": oid, "worktree": str(store.worktree), "dataset_events": len(events), "new_run_ids": new_ids,
                      "runs": [{**manifest, "validation": status,
                                "checkpoint_availability": checkpoint_availability(manifest, args.checkpoint_root)}
                               for manifest, _, status in runs]}
        else:
            identifier(args.study_id)
            destination = args.output.resolve()
            require(not destination.is_relative_to(store.worktree), "Keep derived reports outside the results worktree")
            with store.locked():
                store.check_checkout()
                root = store.worktree / "results"
                runs, events = scan(root, args.study_id)
                study = load(root / args.study_id / "study.json")
                report = analyze(study, runs, events, [])
            destination.mkdir(parents=True, exist_ok=False)
            (destination / "summary.json").write_bytes(encode(report))
            (destination / "report.md").write_text(markdown(report))
            result = {"study_id": args.study_id, "runs": len(runs), "report": str(destination)}
        print(encode(result).decode(), end="")
    except (ValueError, KeyError, TypeError, OSError, EOFError) as error:
        parser.exit(2, f"ai7-results: {error}\n")


if __name__ == "__main__":
    main()
