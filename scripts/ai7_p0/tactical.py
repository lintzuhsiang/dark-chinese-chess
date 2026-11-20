"""Exact imported Stage2 evaluation: all 45 checkpoints, paired orientations."""
import argparse
import json
import time

import numpy as np
import torch

from scripts.ai7.runtime import encode, mask_array, load_checkpoint, seed_all
from .common import ENDPOINTS, METHODS, SEEDS, bundle, paired_statistics, read, sha256, target_metrics, write

PAIR_METRICS = ["target_probability", "top1_accuracy", "best_target_rank", "probability_over_uniform", "probability_excess_over_uniform", "symmetry_gap", "equivariance_tv"]


def evaluate(output):
    plan = read(output / "plan.json")
    if (output / "tactical-results.json").exists():
        raise FileExistsError("Completed tactical evaluation already exists")
    directory = bundle(output)
    bank_path = directory / "tactical-bank/stage2.json"
    assert sha256(bank_path) == plan["bank_sha256"]
    bank = read(bank_path)["bank"]
    assert len(bank) == len({row["semanticKey"] for row in bank}) == len({row["id"].split("-")[0] for row in bank}) == 400
    mapping = np.asarray(read(directory / "tactical-bank/action-rotation.json")["rotation"], dtype=np.int64)
    assert np.array_equal(mapping[mapping], np.arange(1056))
    observations = [o for row in bank for o in [row["observation"], row["rotated"]]]
    features, masks = np.stack([encode(o) for o in observations]), mask_array(observations)
    for row in bank:
        assert set(mapping[row["observation"]["legal"]]) == set(row["rotated"]["legal"])
        assert set(row["labels"]["safe"]).isdisjoint(row["labels"]["unsafe"])
        assert set(row["labels"]["safe"]) | set(row["labels"]["unsafe"]) == set(row["observation"]["legal"])
    seed_all(19, 2)
    results = []
    started = time.perf_counter()
    for checkpoint in plan["checkpoint_manifest"]:
        name = f"{checkpoint['method']}-seed-{checkpoint['training_seed']}-{checkpoint['endpoint']}"
        destination = output / "tactical-checkpoints" / f"{name}.json"
        if destination.exists():
            existing = read(destination)
            assert existing["checkpoint"]["sha256"] == checkpoint["sha256"]
            results.append(existing)
            continue
        assert sha256(checkpoint["path"]) == checkpoint["sha256"]
        model, metadata = load_checkpoint(checkpoint["path"])
        assert metadata["env_steps"] == checkpoint["env_steps"] and metadata["config"]["seed"] == checkpoint["training_seed"]
        t0 = time.perf_counter()
        with torch.inference_mode():
            probabilities = torch.cat([model(torch.from_numpy(features[offset:offset+128]), torch.from_numpy(masks[offset:offset+128]))[0].probs
                                       for offset in range(0, len(features), 128)]).numpy()
        assert not probabilities[~masks].any()
        positions = []
        for i, row in enumerate(bank):
            category = row["category"]
            targets = row["labels"]["wins" if category == "win" else "safe"]
            original, rotated = probabilities[2*i:2*i+2]
            left = target_metrics(original, row["observation"]["legal"], targets)
            right = target_metrics(rotated, row["rotated"]["legal"], mapping[targets].tolist())
            legal = np.array(row["observation"]["legal"])
            gap = abs(left["target_probability"] - right["target_probability"])
            tv = float(.5 * np.abs(original[legal] - rotated[mapping[legal]]).sum())
            pair = {"target_probability": (left["target_probability"] + right["target_probability"]) / 2,
                    "top1_accuracy": (left["top1_correct"] + right["top1_correct"]) / 2,
                    "best_target_rank": (left["best_target_rank"] + right["best_target_rank"]) / 2,
                    "probability_over_uniform": (left["probability_over_uniform"] + right["probability_over_uniform"]) / 2,
                    "probability_excess_over_uniform": (left["probability_excess_over_uniform"] + right["probability_excess_over_uniform"]) / 2,
                    "symmetry_gap": gap, "equivariance_tv": tv}
            positions.append({"id": row["id"], "category": category, "original": left, "rotated": right,
                              "paired": pair, "signed_symmetry_difference": left["target_probability"] - right["target_probability"],
                              "orientation_minimum_mass": min(left["target_probability"], right["target_probability"]),
                              "winning_action_rank": {"original": left["best_target_rank"], "rotated": right["best_target_rank"]} if category == "win" else None})
        summary = {}
        for category in ["win", "defense"]:
            selected = [p for p in positions if p["category"] == category]
            assert len(selected) == 200
            summary[category] = {metric: float(np.mean([p["paired"][metric] for p in selected])) for metric in PAIR_METRICS}
            summary[category].update({"positions": 200, "uniform_mass": float(np.mean([p["original"]["uniform_probability"] for p in selected])),
                                      "original_mass": float(np.mean([p["original"]["target_probability"] for p in selected])),
                                      "rotated_mass": float(np.mean([p["rotated"]["target_probability"] for p in selected])),
                                      "original_top1": float(np.mean([p["original"]["top1_correct"] for p in selected])),
                                      "rotated_top1": float(np.mean([p["rotated"]["top1_correct"] for p in selected])),
                                      "orientation_minimum_mass": float(np.mean([p["orientation_minimum_mass"] for p in selected]))})
        probability_path = output / "tactical-probabilities" / f"{name}.npz"
        probability_path.parent.mkdir(parents=True, exist_ok=True)
        with probability_path.open("xb") as stream:
            np.savez_compressed(stream, probabilities=probabilities)
        result = {"checkpoint": checkpoint, "bank_sha256": plan["bank_sha256"], "summary": summary,
                  "positions": positions, "probability_archive": str(probability_path.relative_to(output)),
                  "probability_archive_sha256": sha256(probability_path), "evaluation_seconds": time.perf_counter() - t0}
        write(destination, result)
        results.append(result)
        write(output / "tactical-status.json", {"state": "running", "completed_checkpoints": len(results), "planned": 45}, replace=True)
        print(json.dumps({"evaluated": name, "checkpoints_completed": len(results)}), flush=True)
    lookup = {(r["checkpoint"]["method"], r["checkpoint"]["training_seed"], r["checkpoint"]["endpoint"]): r for r in results}
    contrasts, trajectories = [], []
    for seed in SEEDS:
        for method in METHODS:
            for category in ["win", "defense"]:
                initial = lookup[method, seed, "initial"]
                for previous_endpoint, endpoint in zip(ENDPOINTS[:-1], ENDPOINTS[1:]):
                    previous, current = lookup[method, seed, previous_endpoint], lookup[method, seed, endpoint]
                    selected = lambda result: [p for p in result["positions"] if p["category"] == category]
                    a, b, start = selected(previous), selected(current), selected(initial)
                    assert [p["id"] for p in a] == [p["id"] for p in b] == [p["id"] for p in start]
                    trajectories.append({"method": method, "training_seed": seed, "category": category,
                                         "from": previous_endpoint, "to": endpoint,
                                         "adjacent": {metric: paired_statistics([y["paired"][metric] - x["paired"][metric] for x, y in zip(a, b)]) for metric in PAIR_METRICS},
                                         "from_initial": {metric: paired_statistics([y["paired"][metric] - x["paired"][metric] for x, y in zip(start, b)]) for metric in PAIR_METRICS}})
        for method in METHODS[1:]:
            for endpoint in ENDPOINTS:
                for category in ["win", "defense"]:
                    a = [p for p in lookup["baseline", seed, endpoint]["positions"] if p["category"] == category]
                    b = [p for p in lookup[method, seed, endpoint]["positions"] if p["category"] == category]
                    assert [p["id"] for p in a] == [p["id"] for p in b]
                    contrasts.append({"method": method, "training_seed": seed, "endpoint": endpoint, "category": category,
                                      "differences": {metric: paired_statistics([y["paired"][metric] - x["paired"][metric] for x, y in zip(a, b)]) for metric in PAIR_METRICS}})
    seed_replication = []
    for method in METHODS[1:]:
        for category in ["win", "defense"]:
            rows = [r for r in contrasts if r["method"] == method and r["category"] == category and r["endpoint"] == "final"]
            seed_replication.append({"method": method, "category": category, "training_seeds": 3,
                                     "seed_level_effects": {metric: [r["differences"][metric]["mean"] for r in rows] for metric in PAIR_METRICS},
                                     "qualification": "Three trained seeds are independent learning replications; conditional position intervals above do not measure this uncertainty. All comparisons exploratory/unadjusted."})
    write(output / "tactical-results.json", {"protocol": plan["tactical_protocol"], "bank_sha256": plan["bank_sha256"],
          "reports": results, "matched_seed_contrasts": contrasts, "learning_trajectories": trajectories,
          "training_seed_replication": seed_replication, "evaluation_seconds": time.perf_counter() - started,
          "checkpoints": 45, "oriented_position_evaluations": 36000, "reserved_access": False})
    write(output / "tactical-status.json", {"state": "completed", "completed_checkpoints": 45}, replace=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    from pathlib import Path
    evaluate(Path(args.output).resolve())


if __name__ == "__main__":
    main()
