"""Local-only acceptance tests using synthetic game records and a bare remote."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from .__main__ import checkpoint_availability, main, stage, staged_package
from .analysis import analyze
from .git_store import GitFailure, ResultsGit, git
from .records import (dataset_id, encode, fingerprint, load, scan, sha)

HASH = "a" * 64


def inputs():
    protocol = {"protocol_id": "test", "deck_seeds": [101, 102], "seats": [0, 1],
                "games_per_model_opponent": 4, "score": {"WIN": 1, "DRAW": .5, "LOSS": 0},
                "opponents": [{"name": "random", "implementation_sha256": HASH}],
                "sampling": {"action_seed": "deck_seed XOR 0x13579"},
                "evaluator": {"source_sha256": {"evaluator.py": HASH}}}
    protocol_bytes = encode(protocol)
    structural = {"core_revision": "a" * 40, "public_observation": "public-v1",
                  "action_mask_sha256": HASH, "terminal_rules_sha256": HASH,
                  "sampling_sha256": fingerprint(protocol["sampling"])}
    study = {"schema_version": 1, "study_id": "fixture", "protocol_id": "test", "protocol_version": "v1",
             "protocol_sha256": sha(protocol_bytes), "frozen_at": "2026-11-20T00:00:00+08:00",
             "dataset_id": dataset_id(protocol["deck_seeds"]), "dataset_role": "historical",
             "structural": structural, "evaluator_source_sha256": protocol["evaluator"]["source_sha256"],
             "cohorts": {"cohort": {"baseline": "A0", "treatments": ["A0", "A1"], "endpoint_transitions": 3640000,
                                    "pairs": {"pair-1": {"training_seed": 42, "machine_id": "intel"},
                                              "pair-2": {"training_seed": 43, "machine_id": "m1"}}}}}
    return study, protocol_bytes, protocol


def run_inputs(study, treatment, pair=1, partial=False):
    machine = "intel" if pair == 1 else "m1"
    run_id = f"fixture-{treatment}-{pair}" + ("-partial" if partial else "")
    status = "partial" if partial else "complete"
    manifest = {"schema_version": 1, "run_id": run_id, "study_id": study["study_id"], "cohort_id": "cohort",
                "treatment": treatment, "training_seed": 41+pair, "pair_id": f"pair-{pair}", "machine_id": machine,
                "source_commit": "b" * 40, "configuration_sha256": HASH, "status": status,
                "training_runtime": {"python": "3.11", "device": "cpu"},
                "checkpoint": {"sha256": HASH, "architecture": "public-mlp128-v1", "env_steps": 3640000,
                               "endpoint": "final", "filename": "final.pt", "locator": "producer artifact tree"},
                "evaluation": {"evaluation_id": "evaluation-" + run_id, "checkpoint_sha256": HASH,
                               "protocol_sha256": study["protocol_sha256"], "dataset_id": study["dataset_id"],
                               "machine_id": machine, "structural": study["structural"], "at": "2026-11-20",
                               "source_sha256": study["evaluator_source_sha256"],
                               "runtime": dict.fromkeys(["python", "torch", "numpy", "node", "device"], "test")}}
    rows = []
    for deck in (101, 102):
        for seat in (0, 1):
            win = treatment == "A1"
            result = {"type": "WIN", "reason": "NO_PIECES", "winner": "P1" if seat == 0 else "P2"} if win else {
                "type": "DRAW", "reason": "NO_PROGRESS"}
            rows.append({"opponent": "random", "opponent_identity_sha256": HASH,
                         "game": {"seed": deck, "seat": seat, "action_seed": deck ^ 0x13579, "opponent": "random",
                                  "prefix_plies": 0, "result": result, "plies": 90, "return": int(win)}})
    return manifest, rows[:1] if partial else rows


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ai7-results-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.remote = self.root / "remote.git"
        git(self.root, "init", "--bare", str(self.remote))
        self.left = self.root / "intel"
        git(self.root, "init", "-b", "dev-intel", str(self.left))
        self.setup_identity(self.left)
        (self.left / "dev.txt").write_text("source\n")
        git(self.left, "add", "dev.txt")
        git(self.left, "commit", "-m", "Synthetic development root")
        git(self.left, "remote", "add", "origin", str(self.remote))
        git(self.left, "push", "origin", "HEAD:refs/heads/experiment/shared-evaluation")
        self.right = self.root / "m1"
        git(self.root, "clone", "-b", "experiment/shared-evaluation", str(self.remote), str(self.right))
        git(self.right, "switch", "-c", "dev-m1")
        self.setup_identity(self.right)
        self.a = ResultsGit(self.left, self.root / "intel-results")
        self.b = ResultsGit(self.right, self.root / "m1-results")
        self.study, self.protocol_bytes, self.protocol = inputs()

    def setup_identity(self, root):
        git(root, "config", "user.email", "fixture@example.invalid")
        git(root, "config", "user.name", "Synthetic fixture")

    def package(self, method, pair=1, partial=False, adjust=None, report=False):
        manifest, rows = run_inputs(self.study, method, pair, partial)
        if adjust:
            adjust(manifest, rows)
        directory = Path(tempfile.mkdtemp(dir=self.root))
        args = SimpleNamespace(outbox=self.root / "outbox", study=directory/"study.json",
                               protocol=directory/"protocol.json", manifest=directory/"manifest.json",
                               conformance=directory/"proof.json", games=directory/"games.jsonl",
                               report=None, dataset_events=None)
        args.study.write_bytes(encode(self.study))
        args.protocol.write_bytes(self.protocol_bytes)
        args.manifest.write_bytes(encode(manifest))
        args.conformance.write_bytes(encode({"passed": True, "manifest_sha256": self.study["protocol_sha256"]}))
        args.games.write_bytes(b"".join(map(encode, rows)))
        if report:
            payload = {"checkpoint_identity": {"sha256": HASH, "seed": manifest["training_seed"],
                                               "treatment": method},
                       "manifest_sha256": self.study["protocol_sha256"], "opponent": "random",
                       "opponent_identity": {"implementation_sha256": HASH}, "completed": len(rows),
                       "games": [row["game"] for row in rows]}
            path = directory/"report.json"
            path.write_bytes(encode(payload))
            args.report = [path]
        return staged_package(stage(args))

    def test_publish_idempotent_conflict_sync_and_missing_checkpoint(self):
        data, manifest = self.package("A0", report=True)
        dev = git(self.right, "rev-parse", "HEAD")
        (self.right / "dev.txt").write_text("dirty development\n")
        self.assertEqual(self.a.publish(data, manifest)["status"], "published")
        self.assertEqual(self.a.publish(data, manifest)["status"], "already_published")
        with self.b.locked():
            _, runs, events = self.b.sync()
        self.assertEqual(len(runs), 1)
        self.assertEqual({e["state"] for e in events}, {"executed", "inspected"})
        self.assertEqual(runs[0][0]["run_id"], manifest["run_id"])
        self.assertEqual(checkpoint_availability(manifest, [self.right]), "missing_from_supplied_checkpoint_roots")
        self.assertEqual(git(self.right, "rev-parse", "HEAD"), dev)
        self.assertEqual((self.right/"dev.txt").read_text(), "dirty development\n")
        changed = dict(data)
        manifest_path = next(n for n in data if n.endswith("/manifest.json"))
        changed[manifest_path] = data[manifest_path].replace(b"producer artifact tree", b"other location")
        with self.assertRaisesRegex(ValueError, "identity conflict"):
            self.b.publish(changed, manifest)

    def test_two_concurrent_writers_reconcile_non_fast_forward(self):
        first, second = self.package("A0"), self.package("A1", pair=2)
        barrier = threading.Barrier(2)
        original_a, original_b = self.a.push, self.b.push

        def once(push):
            def delayed(commit):
                if not getattr(delayed, "called", False):
                    delayed.called = True
                    barrier.wait(timeout=15)
                return push(commit)
            return delayed

        with patch.object(self.a, "push", side_effect=once(original_a)), patch.object(self.b, "push", side_effect=once(original_b)):
            with ThreadPoolExecutor(max_workers=2) as pool:
                jobs = [pool.submit(self.a.publish, *first), pool.submit(self.b.publish, *second)]
                attempts = sorted(job.result(timeout=30)["attempts"] for job in jobs)
        self.assertEqual(attempts, [1, 2])
        with self.a.locked():
            _, runs, _ = self.a.sync()
        self.assertEqual({r[0]["run_id"] for r in runs}, {"fixture-A0-1", "fixture-A1-2"})

    def test_retry_failed_push_and_interrupted_sync(self):
        package = self.package("A0")
        with patch.object(self.a, "push", side_effect=GitFailure("offline")):
            with self.assertRaisesRegex(GitFailure, "offline"):
                self.a.publish(*package)
        self.assertEqual(git(self.a.worktree, "status", "--porcelain"), b"")
        self.assertEqual(self.a.publish(*package)["status"], "published")
        real = self.b.fetch
        with self.b.locked():
            with patch.object(self.b, "fetch", side_effect=GitFailure("interrupted fetch")):
                with self.assertRaises(GitFailure):
                    self.b.sync()
            oid, runs, _ = self.b.sync()
        self.assertEqual(real(), oid)
        self.assertEqual(len(runs), 1)

    def test_lost_push_response_and_local_byte_conflict(self):
        package = self.package("A0")
        push = self.a.push
        def lost_response(commit):
            push(commit)
            raise GitFailure("response lost")
        with patch.object(self.a, "push", side_effect=lost_response):
            self.assertEqual(self.a.publish(*package)["status"], "already_published")
        with self.assertRaisesRegex(ValueError, "Outbox identity conflict"):
            self.package("A0", adjust=lambda m, r: m["checkpoint"].update(locator="different"))

    def test_validation_rejects_bad_metadata_protocol_and_game_completeness(self):
        with self.assertRaises(KeyError):
            self.package("A0", adjust=lambda m, r: m.pop("configuration_sha256"))
        with self.assertRaisesRegex(ValueError, "differs: protocol_sha256"):
            self.package("A0", adjust=lambda m, r: m["evaluation"].update(protocol_sha256=HASH))
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            self.package("A0", adjust=lambda m, r: r.pop())
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.package("A0", adjust=lambda m, r: r.append(r[0]))
        with self.assertRaisesRegex(ValueError, "Unknown game fields"):
            self.package("A0", adjust=lambda m, r: r[0]["game"].update(weights=[1, 2]))
        with patch("scripts.ai7_results.records.RAW_LIMIT", 2):
            with self.assertRaisesRegex(ValueError, "payload exceeds"):
                self.package("A0")

    def test_analysis_separates_pair_and_deck_and_excludes_partial(self):
        for args in [("A0", 1, False), ("A1", 1, False), ("A1", 2, True)]:
            self.a.publish(*self.package(*args))
        runs, events = scan(self.a.worktree/"results", "fixture")
        report = analyze(self.study, runs, events, [])
        self.assertEqual(len(report["contrasts"]), 1)
        effect = report["contrasts"][0]
        self.assertEqual(effect["paired_deck"]["difference"], .5)
        self.assertEqual(effect["paired_deck"]["pairs"], 2)
        self.assertEqual(report["training_seed_effects"][0]["n"], 1)
        self.assertEqual(report["training_seed_effects"][0]["planned_pairs"], 2)
        self.assertTrue(any(f["reason"] == "partial_or_unpaired_excluded" for f in report["findings"]))
        self.assertTrue(any(f["reason"] == "missing_pair_member" for f in report["findings"]))


    def test_sync_rejects_corrupt_and_changed_published_tree(self):
        self.a.publish(*self.package("A0"))
        with self.b.locked():
            old, _, _ = self.b.sync()
        manifest = next((self.a.worktree/"results").glob("fixture/*/*/manifest.json"))
        name = str(manifest.relative_to(self.a.worktree))
        oid = self.a.commit(old, {name: b"{}"}, "synthetic-invalid-rewrite")
        self.a.push(oid)
        with self.b.locked():
            with self.assertRaisesRegex(ValueError, "modified or deleted"):
                self.b.sync()
        self.assertEqual(git(self.b.worktree, "rev-parse", "HEAD").decode().strip(), old)

    def test_oversized_or_unexpected_run_file_rejected(self):
        files, manifest = self.package("A0")
        staged = self.root/"outbox"/manifest["run_id"]
        path = next((staged/"results").glob("fixture/*/*/manifest.json")).parent
        (path/"model.pt").write_bytes(b"fake weights")
        with self.assertRaisesRegex(ValueError, "Unexpected run files"):
            staged_package(staged)
        (path/"model.pt").unlink()
        with (path/"conformance.json").open("wb") as stream:
            stream.truncate(1024*1024+1)
        with self.assertRaisesRegex(ValueError, "oversized"):
            staged_package(staged)

    def test_reused_deck_set_cannot_start_new_confirmation_study(self):
        files, manifest = self.package("A0")
        self.a.publish(files, manifest)
        self.study["study_id"] = "renamed"
        self.study["dataset_role"] = "confirmation"
        next_run = self.package("A1")
        with self.assertRaisesRegex(ValueError, "prior use"):
            self.a.publish(*next_run)

    def test_cli_discovers_new_runs_and_writes_study_report(self):
        files, manifest = self.package("A0")
        producer = ["--repo", str(self.left), "--worktree", str(self.a.worktree)]
        consumer = ["--repo", str(self.right), "--worktree", str(self.b.worktree)]

        def command(argv):
            stream = io.StringIO()
            with redirect_stdout(stream):
                main(argv)
            return json.loads(stream.getvalue())

        source = self.root/"outbox"/manifest["run_id"]
        pending = command(producer + ["publish-run", "--staged", str(source)])
        self.assertEqual(pending["status"], "validated_and_staged_offline")
        self.assertFalse(self.a.worktree.exists())
        self.assertEqual(command(producer + ["publish-run", "--staged", str(source), "--push"])["status"],
                         "published")
        synced = command(consumer + ["sync-results"])
        self.assertEqual(synced["new_run_ids"], [manifest["run_id"]])
        self.assertEqual(command(consumer + ["sync-results"])["new_run_ids"], [])
        output = self.root/"review"
        command(consumer + ["analyze-study", "--study-id", "fixture", "--output", str(output)])
        self.assertEqual(load(output/"summary.json")["runs"][0]["metrics"]["random"]["score"], .5)
        self.assertIn("missing_pair_member", (output/"report.md").read_text())

    def test_existing_intel21m_reproduces_when_artifacts_available(self):
        original = Path(__file__).resolve().parents[2] / "benchmark-results/ai7-selfplay/gae-critic-factorial-20261115"
        source = original/"joint-21m-evaluation-20261117-v1"
        if not (source/"validation.json").exists():
            self.skipTest("Existing Intel 21M artifacts not in this checkout")
        self.assertTrue(load(source/"validation.json")["passed"])
        protocol_path = source/"shared-evaluation-manifest.json"
        protocol = load(protocol_path)
        protocol_hash = sha(protocol_path.read_bytes())
        frozen = load(source/"freeze.json")
        validation = source/"preflight-validation.json"
        self.assertEqual(frozen["manifest_sha256"], protocol_hash)
        runtime = load(source/"runtime-metadata.json")
        studies = {"schema_version": 1, "study_id": "campaign4-21m", "protocol_id": protocol["protocol_id"],
                   "protocol_version": "v1", "protocol_sha256": protocol_hash, "frozen_at": frozen["at"],
                   "dataset_id": dataset_id(protocol["deck_seeds"]), "dataset_role": "historical",
                   "structural": {"core_revision": runtime["coreRevision"], "public_observation": runtime["observationVersion"],
                                  "action_mask_sha256": protocol["evaluator"]["source_sha256"]["scripts/ai7/environment.ts"],
                                  "terminal_rules_sha256": sha((Path(__file__).resolve().parents[2]/"docs/chase-v4-spec.md").read_bytes()),
                                  "sampling_sha256": fingerprint(protocol["sampling"])},
                   "evaluator_source_sha256": protocol["evaluator"]["source_sha256"],
                   "cohorts": {"intel-4a": {"treatments": ["A0","A1","A2","A3"], "baseline": "A0",
                                         "endpoint_transitions": 3640000, "pairs": {
                                             f"seed-{seed}": {"training_seed": seed, "machine_id":"intel"}
                                             for seed in (7011,7023,7037)}}}}
        studies["cohorts"]["m1-4b"] = {
            "baseline": "B0", "treatments": ["B0", "B1"], "endpoint_transitions": 3640000,
            "pairs": {f"seed-{seed}": {"training_seed": seed, "machine_id": "m1"}
                      for seed in (7011, 7023, 7037)},
        }
        study_path = self.root/"historical-study.json"
        study_path.write_bytes(encode(studies))
        for cp in load(validation)["final_checkpoints"]:
            seed, name = cp["seed"], cp["id"]
            training_file = original/"runs"/name/"manifest.json"
            training = load(training_file)
            prov = training["provenance"]
            checkpoint_path = Path(cp["path"])
            checkpoint = {"sha256": cp["sha256"], "architecture": prov["architecture"], "endpoint": "final",
                          "env_steps": cp["env_steps"], "filename": checkpoint_path.name, "locator": str(checkpoint_path)}
            manifest = {"schema_version": 1, "study_id": studies["study_id"], "run_id": "4a-"+name,
                        "machine_id": "intel", "cohort_id": "intel-4a", "training_seed": seed, "pair_id": f"seed-{seed}",
                        "treatment": cp["treatment"], "source_commit": prov["source_revision"],
                        "status": "complete",
                        "training_runtime": {k: prov[k] for k in ("python","torch","numpy","platform")},
                        "checkpoint": checkpoint, "evaluation": {"evaluation_id":"21m-"+name, "machine_id":"intel",
                              "checkpoint_sha256": cp["sha256"], "protocol_sha256": protocol_hash, "dataset_id": studies["dataset_id"],
                              "structural": studies["structural"], "source_sha256": studies["evaluator_source_sha256"],
                              "at": load(source/"status.json")["finished_at"],
                              "runtime": {**{k:prov[k] for k in ("python","torch","numpy")}, "node":runtime["node"],"device":"cpu"}}}
            m = self.root/(name+".json")
            m.write_bytes(encode(manifest))
            args = SimpleNamespace(outbox=self.root/"outbox", study=study_path, protocol=protocol_path, manifest=m,
                                   report=sorted((source/"games").glob(name+"-vs-*.json")), games=None,
                                   conformance=validation, dataset_events=None,
                                   training_manifest=training_file, checkpoint=checkpoint_path)
            self.a.publish(*staged_package(stage(args)))
        with self.b.locked():
            _, runs, events = self.b.sync()
        report = analyze(studies, runs, events, [])
        self.assertEqual(len(runs), 12)
        self.assertEqual(sum(len(rows) for _, rows, _ in runs), 18432)
        self.assertEqual(sum(r.get("cohort_id") == "m1-4b" and r["reason"] == "missing_pair_member"
                             for r in report["findings"]), 6)
        expected = load(source/"paired-analysis.json")
        effect_names = {"A1":"extra_at_095", "A2":"lambda_without_extra"}
        for result in report["training_seed_effects"]:
            if result["treatment"] not in effect_names:
                continue
            prior = next(r for r in expected["paired_training_seed_effects"]
                         if r["opponent"] == result["opponent"] and r["metric"] == "score"
                         and r["effect"] == effect_names[result["treatment"]])
            self.assertEqual(result["mean"], prior["mean"])
        for result in report["contrasts"]:
            if result["treatment"] not in effect_names:
                continue
            prior = next(r for r in expected["per_seed_contrasts"]
                         if r["opponent"] == result["opponent"] and r["metric"] == "score"
                         and r["training_seed"] == result["training_seed"] and r["effect"] == effect_names[result["treatment"]])
            self.assertEqual(result["paired_deck"]["bootstrap95"], prior["deck_bootstrap95"])


if __name__ == "__main__":
    unittest.main()
