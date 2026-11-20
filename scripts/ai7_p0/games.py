"""New 256 paired-deck evaluations against Random and the exact M1 opponent."""
import argparse
import os
from pathlib import Path
import time

import numpy as np

from scripts.ai7.runtime import Bridge, load_checkpoint, seed_all
from scripts.ai7.evaluate import evaluate_checkpoint, paired_difference
from scripts.ai7.evaluate_shared import result_metrics
from .common import ROOT, METHODS, SEEDS, bundle, load_historical, read, sha256, write


def evaluate(output):
    plan = read(output / "plan.json")
    if (output / "shared-opponent-results.json").exists():
        raise FileExistsError("Completed shared-opponent evaluation exists")
    assert sha256(output / "shared-evaluation-manifest.json") == plan["shared_evaluation_manifest_sha256"]
    for name, digest in plan["evaluation_sources"].items():
        assert sha256(ROOT / name) == digest, f"Evaluation source changed: {name}"
    manifest = read(output / "shared-evaluation-manifest.json")
    assert manifest["decks"] == manifest["deck_seeds"] and len(set(manifest["decks"])) == 256
    os.environ["AI7_ARTIFACT_ROOT"] = str(output)
    seed_all(19, 2)
    opponent = load_historical(bundle(output))
    opponent_sha = manifest["opponents"][1]["original_checkpoint_sha256"]
    reports = []
    started = time.perf_counter()
    bridge = Bridge(output / "replays")
    expected_pairs = {(deck, seat) for deck in manifest["decks"] for seat in [0, 1]}
    try:
        for checkpoint in plan["checkpoint_manifest"]:
            if checkpoint["endpoint"] != "final":
                continue
            assert checkpoint["env_steps"] == 3640000 and sha256(checkpoint["path"]) == checkpoint["sha256"]
            for opponent_name in ["random", "m1_exp2_baseline_4023"]:
                name = f"{checkpoint['method']}-seed-{checkpoint['training_seed']}-vs-{opponent_name}"
                destination = output / "games" / f"{name}.json"
                if destination.exists():
                    existing = read(destination)
                    assert existing["checkpoint_sha256"] == checkpoint["sha256"]
                    assert existing["shared_manifest_sha256"] == plan["shared_evaluation_manifest_sha256"]
                    reports.append(existing)
                    continue
                tick = time.perf_counter()
                model, metadata = load_checkpoint(checkpoint["path"])
                assert metadata["env_steps"] == 3640000 and metadata["config"]["seed"] == checkpoint["training_seed"]
                result = evaluate_checkpoint(bridge, model, "final", manifest["decks"], opponent_name,
                                             opponent_model=None if opponent_name == "random" else opponent,
                                             archive_count=0, batch_games=16)
                assert len(result["games"]) == 512 and {(g["seed"], g["seat"]) for g in result["games"]} == expected_pairs
                result.update(result_metrics(result["games"]))
                result.update({"method": checkpoint["method"], "training_seed": checkpoint["training_seed"],
                               "checkpoint_sha256": checkpoint["sha256"], "checkpoint_path": checkpoint["path"],
                               "opponent_identity_sha256": manifest["opponents"][0]["source_sha256"] if opponent_name == "random" else opponent_sha,
                               "shared_manifest_sha256": plan["shared_evaluation_manifest_sha256"], "errors": 0,
                               "median_plies": float(np.median([g["plies"] for g in result["games"]])),
                               "per_seat": {str(seat): result_metrics([g for g in result["games"] if g["seat"] == seat]) for seat in [0, 1]},
                               "wall_seconds_with_checkpoint_load": time.perf_counter() - tick,
                               "games_per_second": result["completed"] / result["seconds"]})
                assert sha256(checkpoint["path"]) == checkpoint["sha256"]
                write(destination, result)
                reports.append(result)
                write(output / "games-status.json", {"state": "running", "completed_matchups": len(reports), "planned_matchups": 18,
                                                      "completed_games": sum(r["completed"] for r in reports)}, replace=True)
                print(f"Completed {name}: {len(reports)}/18", flush=True)
    except BaseException as error:
        write(output / "games-status.json", {"state": "failed", "error": repr(error), "completed_matchups": len(reports)}, replace=True)
        raise
    finally:
        bridge.close()
    contrasts = []
    for opponent_name in ["random", "m1_exp2_baseline_4023"]:
        for seed in SEEDS:
            baseline = next(r for r in reports if r["method"] == "baseline" and r["training_seed"] == seed and r["opponent"] == opponent_name)
            for method in METHODS[1:]:
                treated = next(r for r in reports if r["method"] == method and r["training_seed"] == seed and r["opponent"] == opponent_name)
                contrasts.append({"method": method, "training_seed": seed, "opponent": opponent_name,
                                  "score_difference": paired_difference(baseline["pair_scores"], treated["pair_scores"]),
                                  "rate_differences": {metric: (treated[metric] - baseline[metric]) / 512 for metric in ["wins", "draws", "losses"]},
                                  "no_progress_rate_difference": treated["no_progress_rate"] - baseline["no_progress_rate"]})
    write(output / "shared-opponent-results.json", {"shared_manifest_sha256": plan["shared_evaluation_manifest_sha256"],
          "reports": reports, "matched_seed_contrasts": contrasts, "elapsed_seconds": time.perf_counter() - started,
          "planned_games": 9216, "completed_games": sum(r["completed"] for r in reports),
          "replication_unit": "training seed, n=3; deck bootstrap is conditional on trained policies",
          "reused_prior_direct_matches": "previous 14M matched-Baseline matches retained separately; not rerun"})
    write(output / "games-status.json", {"state": "completed", "completed_matchups": 18, "completed_games": 9216}, replace=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evaluate(args.output.resolve())


if __name__ == "__main__":
    main()
