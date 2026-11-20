"""Validate imported evidence and freeze the two new evaluation protocols."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
import torch

from scripts.ai7.runtime import encode, mask_array, seed_all
from scripts.ai7.shared_protocol import audit_seeds, source_evidence
from .common import ROOT, INTEL, ENDPOINTS, METHODS, SEEDS, bundle, function_hash, historical_weights, json_digest, load_historical, load_original_historical, read, sha256, write


def prepare(output):
    directory = bundle(output)
    manifest = read(directory / "manifest.json")
    if (output / "plan.json").exists():
        raise FileExistsError("P0 evaluation protocol already frozen")
    # Capture reproducible validation commands and their actual subprocess outputs.
    checks = []
    commands = [
        ([sys.executable, "-B", str(directory / "run_evaluation.py"), "validate", "--intel-workspace", str(ROOT)], ROOT),
        (["node", "--import", "./source-and-evaluation/workspace/scripts/ai-eval/register.mjs", "validate_bank.ts"], directory),
    ]
    for command, cwd in commands:
        result = subprocess.run(command, cwd=cwd, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}, capture_output=True, text=True, check=True)
        checks.append({"command": command, "cwd": str(cwd), "returncode": result.returncode,
                       "stdout": result.stdout, "stderr": result.stderr, "result": json.loads(result.stdout.splitlines()[-1])})
    seed_all(19, 2)
    source = source_evidence()
    original_source = directory / "source-and-evaluation/workspace"
    functions = {name: {"intel": function_hash(ROOT, name), "m1": function_hash(original_source, name)}
                 for name in ["encode", "Policy", "mask_array", "seed_all", "collect", "summarize", "load_checkpoint"]}
    assert all(functions[name]["intel"] == functions[name]["m1"] for name in functions if name != "collect")
    core = read(original_source / "core-files.json")
    assert all(sha256(ROOT / name) == digest for name, digest in core.items())
    assert sha256(ROOT / "scripts/ai7/environment.ts") == manifest["observation"]["environment_ts_sha256"]
    for name in ["apps/web/src/game/deck.ts", "packages/ai-agents/src/seeded-random.ts"]:
        assert sha256(ROOT / name) == sha256(original_source / name)
    bank_data = read(directory / "tactical-bank/stage2.json")
    bank = bank_data["bank"]
    observations = [o for row in bank for o in [row["observation"], row["rotated"]]]
    features = np.stack([encode(o) for o in observations])
    masks = mask_array(observations)
    assert hashlib.sha256(features.astype("<f4").tobytes()).hexdigest() == manifest["observation"]["encoded_bank_float32_le_sha256"]
    assert hashlib.sha256(masks.astype("uint8").tobytes()).hexdigest() == manifest["observation"]["mask_uint8_sha256"]
    original_path = directory / "historical-opponent/baseline-seed-4023-step-3640000.pt"
    original_checkpoint, load_method = load_original_historical(original_path)
    weights = historical_weights(directory)
    assert set(weights) == set(original_checkpoint["model"])
    assert all(torch.equal(weights[name], original_checkpoint["model"][name]) for name in weights)
    common = load_historical(directory)
    with torch.inference_mode():
        actual = common(torch.from_numpy(features), torch.from_numpy(masks))[0].probs.numpy()
    with np.load(directory / "historical-opponent/reference-output.npz", allow_pickle=False) as reference:
        reference_error = float(np.max(np.abs(actual - reference["probabilities"])))
    assert reference_error <= 1e-5
    validation = {"subprocess_checks": checks, "functions": functions, "core_and_rules_files_identical": len(core),
                  "environment_and_action_bytes_identical": True, "deck_and_rng_bytes_identical": True,
                  "collect_difference": "only additional training=True trajectory audit fields (ply/quiet/hidden/old_legal_probabilities); inference branches unchanged",
                  "historical_original_load_method": load_method, "original_and_npz_tensors_bitwise_equal": True,
                  "reference_max_abs_probability_error": reference_error, "reference_tolerance": 1e-5,
                  "source_version_mismatch": {"Intel_training_commit": read(INTEL / "intel-source-evidence.json")["git_commit"],
                                              "M1_checkpoint_producer": manifest["versions"]["checkpoint_producer_manifest"],
                                              "M1_bundle_export_commit": manifest["original_git_commit"]},
                  "classification": "compatible common Intel inference runtime verified; source commits/dependency versions differ; not bit-identical cross-machine trajectories",
                  "reserved_access": False}
    state = original_checkpoint.get("training_state") or {}
    timing = {key: state.get(key) for key in ["env_steps", "updates", "completed_games", "attempted_games", "training_wall_seconds", "validation_seconds", "optimization_seconds", "inference_seconds", "optimizer_steps"]}
    write(output / "historical-checkpoint-evidence.json", {"sha256": sha256(original_path),
          "load_method": load_method, "env_steps": original_checkpoint["env_steps"],
          "seed": original_checkpoint["config"]["seed"], "model_config": original_checkpoint["model_config"],
          "config": original_checkpoint["config"], "timing_state": timing,
          "qualification": "one historical Exp2 baseline run, not all M1 campaign timing logs"})
    write(output / "compatibility-validation.json", validation)
    write(output / "intel-runtime-evidence.json", source)

    local_audit = audit_seeds(excluded=output)
    if local_audit["errors"]:
        raise ValueError("Local metadata audit contains unreadable records")
    m1_usage = read(directory / "source-and-evaluation/seed-usage.json")
    occupied = [{"min": r["start"], "max": r["end"], "source": entry["path"], "machine": "intel"}
                for entry in local_audit["records"] for r in entry["ranges"]]
    occupied += [{"min": row["start"], "max": row["end"], "source": row["evidence"], "machine": "intel_documented"} for row in local_audit["documented_reservations"]]
    occupied += [{**row, "machine": "m1_reported_inventory"} for row in m1_usage["observed_records"] if row["min"] <= row["max"]]
    occupied += [{"min": a, "max": b, "source": reason, "machine": "m1_conservative"} for a, b, reason in m1_usage["conservative_known_ranges"]]
    candidate = read(directory / "source-and-evaluation/provisional-shared-seeds.json")
    decks = candidate["decks"]
    assert len(decks) == len(set(decks)) == 256
    rejected = []
    while True:
        conflicts = [row for row in occupied if any(row["min"] <= deck <= row["max"] for deck in decks)]
        if not conflicts:
            break
        rejected.append({"proposed_range": [min(decks), max(decks)], "conflicts": conflicts})
        start = (max(row["max"] for row in conflicts) // 1000000 + 1) * 1000000
        decks = list(range(start, start + 256))
    old = read(INTEL / "shared-evaluation-manifest.json")["deck_seeds"]
    old_conflicts = [row for row in occupied if row["machine"].startswith("m1") and any(row["min"] <= seed <= row["max"] for seed in old)]
    write(output / "seed-audit.json", {"local_inventory": local_audit, "M1_inventory_sha256": sha256(directory / "source-and-evaluation/seed-usage.json"),
          "M1_observed_records": len(m1_usage["observed_records"]), "M1_inventory": m1_usage,
          "chosen_decks": decks, "new_conflicts": [], "rejected_candidates": rejected,
          "old_Intel_14M_conflicts": old_conflicts,
          "old_result_classification": "retain Intel internal results; 14M not a fresh shared cross-machine test because M1 curriculum uses it",
          "qualification": "M1 inventory is supplied exporter evidence, not independent access to every original M1 manifest/log; no reserved bank inspected"})

    shared = {"schema_version": 1, "protocol_id": "ai7-intel-p0-common-opponent-256-v1", "status": "fixed_before_new_evaluation_results",
              "created_epoch": time.time(), "decks": decks, "deck_seeds": decks, "deck_seed_list_sha256": json_digest(decks),
              "seed_generation": "M1 proposed consecutive 20M namespace, accepted after local and supplied M1 inventory audit; exact list is authority",
              "seats": [0, 1], "pairs": 256, "games_per_model_per_opponent": 512,
              "seed_audit_sha256": sha256(output / "seed-audit.json"), "change_after_results_allowed": False,
              "opponents": [{"id": "random", "implementation": "scripts.ai7.runtime.collect random branch", "source_sha256": source["source_hashes"]["scripts/ai7/runtime.py"]},
                            {"id": "m1_exp2_baseline_seed_4023_final", "original_checkpoint_sha256": sha256(original_path),
                             "portable_weights_sha256": sha256(directory / "historical-opponent/model-weights.npz"),
                             "original_checkpoint_path": str(original_path), "env_steps": 3640000, "training_seed": 4023,
                             "model_config": original_checkpoint["model_config"], "original_tensors_verified_equal_to_npz": True}],
              "sampling": read(INTEL / "shared-evaluation-manifest.json")["sampling"],
              "runtime": {"device": "cpu", "threads": 2, "batch_games": 16, "source_evidence_sha256": sha256(output / "intel-runtime-evidence.json"), "dependencies": source["dependencies"]},
              "stopping": {"terminal": "authoritative unchanged Chase v4 GameCore", "safety_plies": 4096, "safety_handling": "error, never manufactured draw"},
              "score": {"WIN": 1, "DRAW": .5, "LOSS": 0}, "selection": "all nine predetermined final checkpoints, no retraining or best-checkpoint selection",
              "uncertainty": {"deck_pairs": "bootstrap 10000 resamples seed19, paired across matched treatment/baseline; both seats averaged first", "replication": "3 independent training seeds, separate from deck sampling uncertainty"},
              "cross_machine": "portable common protocol; M1 original inventory supplied; future M1 execution must use this exact manifest/opponent and verify runtime; no direct pooling based only on names"}
    write(output / "shared-evaluation-manifest.json", shared)
    (output / "shared-evaluation-manifest.sha256").write_text(sha256(output / "shared-evaluation-manifest.json") + "  shared-evaluation-manifest.json\n")
    checkpoints = []
    index = read(INTEL / "checkpoint-index.json")
    for method in METHODS:
        for seed in SEEDS:
            for endpoint in ENDPOINTS:
                path = INTEL / "runs" / f"{method}-seed-{seed}" / f"{endpoint}.pt"
                row = next(row for row in index if row["relative_path"] == path.relative_to(INTEL).as_posix())
                assert path.is_file() and sha256(path) == row["sha256"]
                checkpoints.append({"method": method, "training_seed": seed, "endpoint": endpoint,
                                    "path": str(path), "sha256": row["sha256"], "env_steps": row["env_steps"]})
    evaluation_sources = {p.relative_to(ROOT).as_posix(): sha256(p) for p in sorted(Path(__file__).parent.rglob("*.py")) if "__pycache__" not in p.parts}
    for name in evaluation_sources:
        target = output / "evaluation-source" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((ROOT / name).read_bytes())
    plan = {"evaluation_only": True, "training_allowed": False, "bundle_manifest_sha256": sha256(directory / "manifest.json"),
            "bank_sha256": manifest["bank_sha256"], "checkpoint_manifest": checkpoints,
            "shared_evaluation_manifest_sha256": sha256(output / "shared-evaluation-manifest.json"),
            "historical_checkpoint_sha256": manifest["checkpoint_sha256"], "evaluation_sources": evaluation_sources,
            "tactical_protocol": {"position_counts": {"win": 200, "defense": 200}, "orientations": "paired original/180-degree rotation; no seat/color swap",
                                 "bootstrap_resamples": 4000, "bootstrap_seed": 91023, "inference_batch": 128,
                                 "top1_ties": "smallest numeric legal action ID", "target_rank": "1 + number of legal actions with strictly larger probability than best correct action",
                                 "multiple_targets": "sum all correct action probabilities; top1 membership in full correct set",
                                 "replication_unit": "training seed; position bootstrap is conditional on fixed trained checkpoints",
                                 "reserved_bank_access": False, "endpoints": ENDPOINTS, "endpoint_selection": "final at 3640000; all intermediate diagnostics retained, never selected by score"}}
    write(output / "plan.json", plan)
    print(json.dumps({"validated": True, "positions": len(bank), "checkpoints": len(checkpoints), "decks": [min(decks), max(decks)],
                      "historical_load": load_method, "reference_error": reference_error, "old_14M_M1_conflicts": len(old_conflicts)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.output.resolve())


if __name__ == "__main__":
    main()
