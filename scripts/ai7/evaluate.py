"""Independent paired-seat evaluation. Evaluation games never update weights."""
from __future__ import annotations

import argparse
import hashlib
import math
from pathlib import Path
import time

import numpy as np

from .runtime import Bridge, ROOT, collect, guard_artifacts, load_checkpoint, provenance, seed_all, summarize, write_json


def paired_interval(scores, confidence=0.95):
    """Conservative Hoeffding interval: independent seed pairs are the units."""
    if not scores:
        return {"pairs": 0, "score": None, "lower": None, "upper": None}
    mean = float(np.mean(scores))
    radius = math.sqrt(math.log(2 / (1 - confidence)) / (2 * len(scores)))
    return {"pairs": len(scores), "score": mean, "lower": max(0, mean - radius), "upper": min(1, mean + radius), "confidence": confidence, "method": "hoeffding-independent-deck-pairs"}


def paired_difference(initial, trained, seed=19):
    common = sorted(set(initial) & set(trained))
    if not common:
        return {"pairs": 0, "difference": None, "bootstrap95": None, "hoeffding95": None}
    differences = np.asarray([trained[key] - initial[key] for key in common])
    rng = np.random.default_rng(seed)
    samples = differences[rng.integers(0, len(differences), size=(10000, len(differences)))].mean(axis=1)
    lower, upper = np.quantile(samples, [0.025, 0.975])
    radius = math.sqrt(2 * math.log(40) / len(differences))  # differences in [-1,1]
    delta = float(np.mean(differences))
    return {
        "pairs": len(common), "difference": delta,
        "bootstrap95": [float(lower), float(upper)],
        "hoeffding95": [max(-1, delta - radius), min(1, delta + radius)],
        "method": "paired-deck bootstrap (10000 resamples); conservative bounded-pair Hoeffding also reported",
        "bootstrap_seed": seed, "training_seeds": 1,
    }


def evaluate_checkpoint(bridge, model, checkpoint_name, seeds, opponent_name, opponent_model=None, device="cpu", archive_count=4, batch_games=16, deadline=float("inf")):
    specifications = [{
        "seed": seed, "seat": seat, "action_seed": (seed ^ 0x13579), "opponent": opponent_name,
        **({"archive": f"{checkpoint_name}-{opponent_name}-seed-{seed}-seat-{seat}.json"} if i < archive_count else {}),
    } for i, (seed, seat) in enumerate((seed, seat) for seed in seeds for seat in [0, 1])]
    games = []
    attempted = 0
    start = time.perf_counter()
    for offset in range(0, len(specifications), batch_games):
        if time.perf_counter() >= deadline:
            break
        result = collect(bridge, model, specifications[offset:offset + batch_games], {opponent_name: opponent_model} if opponent_model else {}, device, deadline=deadline)
        games.extend(result["games"])
        attempted += result["attempted"]
        guard_artifacts(ROOT / "benchmark-results/ai7-selfplay")
    pairs = {}
    for seed in seeds:
        legs = [game for game in games if game["seed"] == seed]
        if len(legs) == 2:
            pairs[seed] = float(np.mean([(game["return"] + 1) / 2 for game in legs]))
    return {
        "checkpoint": checkpoint_name, "opponent": opponent_name,
        "planned": len(specifications), "skipped": len(specifications) - attempted,
        "attempted": attempted, "incomplete": attempted - len(games),
        **summarize(games), "paired_score": paired_interval(list(pairs.values())),
        "seconds": time.perf_counter() - start, "pair_scores": pairs, "games": games,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoints", nargs="+", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pairs", type=int, default=128)
    parser.add_argument("--seed-start", type=int, default=2_000_000)
    parser.add_argument("--opponents", nargs="+", choices=["random", "ev", "ai6a"], default=["random"])
    parser.add_argument("--historical", nargs="*", type=Path, default=[])
    parser.add_argument("--archive-count", type=int, default=4)
    parser.add_argument("--device", choices=["cpu", "mps"], default="cpu")
    parser.add_argument("--deadline-epoch", type=float, default=None, help="Absolute UTC Unix deadline, including all checkpoint evaluations")
    args = parser.parse_args()
    if not 1 <= args.pairs <= 1024 or args.seed_start < 1_000_000 or not 0 <= args.archive_count <= 32:
        raise ValueError("Use 1-1024 held-out seed pairs and 0-32 replay archives per matchup")
    # Fail before any games or output directories if a checkpoint was mistyped.
    checkpoint_paths = [path.resolve() for path in [*args.checkpoints, *args.historical]]
    for path in checkpoint_paths:
        if not path.is_file():
            raise FileNotFoundError(path)
    if len({path.stem for path in args.checkpoints}) != len(args.checkpoints):
        raise ValueError("Comparison checkpoints must have distinct filename stems")
    output = args.output.resolve()
    if not output.is_relative_to(ROOT / "benchmark-results/ai7-selfplay"):
        raise ValueError("Evaluation output must be inside benchmark-results/ai7-selfplay")
    output.mkdir(parents=True, exist_ok=False)
    guard_artifacts(ROOT / "benchmark-results/ai7-selfplay")
    write_json(output / "manifest.json", {
        "provenance": provenance(),
        "checkpoint_sha256": {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in checkpoint_paths},
        "checkpoint_paths": [str(path.resolve()) for path in args.checkpoints],
        "historical_paths": [str(path.resolve()) for path in args.historical],
        "seed_start": args.seed_start, "pairs": args.pairs, "opponents": args.opponents,
    })
    seed_all(19)
    deadline = float("inf") if args.deadline_epoch is None else time.perf_counter() + max(0, args.deadline_epoch - time.time())
    seeds = list(range(args.seed_start, args.seed_start + args.pairs))
    historical = {f"historical-{i}-{path.stem}": load_checkpoint(path, args.device)[0] for i, path in enumerate(args.historical)}
    reports = []
    bridge = Bridge(output / "replays")
    try:
        for checkpoint_path in args.checkpoints:
            model, checkpoint = load_checkpoint(checkpoint_path, args.device)
            for opponent in [*args.opponents, *historical]:
                report = evaluate_checkpoint(bridge, model, checkpoint_path.stem, seeds, opponent, historical.get(opponent), args.device, args.archive_count, deadline=deadline)
                report["checkpoint_path"] = str(checkpoint_path.resolve())
                report["training_env_steps"] = checkpoint["env_steps"]
                write_json(output / f"{checkpoint_path.stem}-vs-{opponent}.json", report)
                reports.append(report)
                print({key: value for key, value in report.items() if key not in ("games", "pair_scores")}, flush=True)
        comparisons = []
        for opponent in [*args.opponents, *historical]:
            matchups = [report for report in reports if report["opponent"] == opponent]
            for later in matchups[1:]:
                comparisons.append({"initial": matchups[0]["checkpoint"], "trained": later["checkpoint"], "opponent": opponent, **paired_difference(matchups[0]["pair_scores"], later["pair_scores"])})
        write_json(output / "summary.json", {
            "metadata": bridge.metadata, "seeds": seeds,
            "deadline_epoch": args.deadline_epoch,
            "deadline_reached": time.perf_counter() >= deadline,
            "scoring": "win=1/draw=.5/loss=0; average both seat-swapped legs before computing intervals",
            "evaluation_action_sampling": "stochastic masked categorical; independent explicit RNG per focal/opponent role and deck seed; reset for every checkpoint",
            "comparisons": comparisons,
            "matchups": [{key: value for key, value in report.items() if key not in ("games", "pair_scores")} for report in reports],
        })
    finally:
        bridge.close()


if __name__ == "__main__":
    main()
