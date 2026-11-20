"""Collection-only restart pilot; no optimization, evaluation or Intel emulation."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import time

import numpy as np

from .runtime import Bridge, Policy, ROOT, collect, provenance, seed_all, summarize
from .restart_sampling import RestartSampler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--archive-sha256", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--steps-per-treatment", type=int, default=16384)
    args = parser.parse_args()
    if args.steps_per_treatment < 1:
        raise ValueError("Positive pilot transition limit required")
    output = args.output.resolve()
    if not output.is_relative_to(ROOT / "benchmark-results/ai7-selfplay"):
        raise ValueError("Pilot output must be inside AI-7 artifacts")
    if hashlib.sha256(args.archive.read_bytes()).hexdigest() != args.archive_sha256:
        raise ValueError("Archive SHA mismatch")
    output.mkdir(parents=True, exist_ok=False)
    # These seeds belong to infrastructure pilots, not the provisional training cohort.
    seed_all(87001)
    model = Policy()
    before = {key: value.clone() for key, value in model.state_dict().items()}
    bridge = Bridge(output / "replays")
    started = time.perf_counter()
    cpu = time.process_time()
    reports = {}
    try:
        load_started = time.perf_counter()
        catalog = bridge.request(command="load-restarts", path=str(args.archive.resolve()), sha256=args.archive_sha256)
        load_seconds = time.perf_counter() - load_started
        for treatment in ["B0", "B1", "B2"]:
            sampler = RestartSampler(catalog, args.archive_sha256, treatment, 87002)
            rng = np.random.default_rng(87003)
            games = []
            completed_steps = 0
            incomplete = 0
            zero_decisions = 0
            samples = 0
            reset_seconds = 0.
            treatment_started = time.perf_counter()
            while completed_steps < args.steps_per_treatment:
                specs = [{"seed": int(rng.integers(0, 900000)), "seat": int(rng.integers(0, 2)),
                    "action_seed": int(rng.integers(0, 2**32)), "opponent": "current", **sampler.sample()} for _ in range(16)]
                result = collect(bridge, model, specs, {}, training=True,
                    max_env_steps=args.steps_per_treatment - completed_steps)
                completed_steps += result["env_steps"]
                incomplete += result["incomplete"]
                zero_decisions += result["zero_decision_games"]
                samples += sum(len(trajectory) for trajectory in result["trajectories"])
                reset_seconds += result["reset_seconds"]
                games.extend(result["games"])
            seconds = time.perf_counter() - treatment_started
            reports[treatment] = {"env_steps": completed_steps, "wall_seconds": seconds,
                "steps_per_second": completed_steps / seconds, "incomplete_episodes": incomplete,
                "completed_episodes": len(games), "zero_decision_games": zero_decisions,
                "completed_learner_samples": samples, "optimizer_steps": 0,
                "reset_seconds_including_replay": reset_seconds,
                "sampling": sampler.state_dict(), "outcomes": summarize(games),
                "terminal_reasons": dict(Counter(game["result"]["reason"] for game in games)),
                "completed_normal_episodes": sum("restartId" not in game for game in games),
                "completed_restart_episodes": sum("restartId" in game for game in games),
                "mean_continuation_plies": float(np.mean([game.get("continuation_plies", game["plies"]) for game in games])) if games else None,
                "summary_counter_scope": "summarize plies/captures/flips/repetitions include replay prefix; continuation length is separate",
                "games": games}
            print(json.dumps({key: value for key, value in reports[treatment].items() if key not in ["games", "sampling"]}, allow_nan=False), flush=True)
        if not all(value.equal(model.state_dict()[key]) for key, value in before.items()):
            raise RuntimeError("Collection-only pilot changed policy parameters")
        report = {"purpose": "collection throughput and accounting only; no learning or held-out evaluation",
            "archive_sha256": args.archive_sha256, "archive_load_and_full_validation_seconds": load_seconds,
            "local_policy": "untrained local Baseline MLP; NOT the pending Intel training reference",
            "source": provenance(), "wall_seconds": time.perf_counter() - started,
            "parent_cpu_seconds": time.process_time() - cpu, "treatments": reports,
            "B3": "not run; verified predictor and valid replicated public-state targets pending",
            "reserved_bank_access": False}
        (output / "pilot.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    finally:
        bridge.close()


if __name__ == "__main__":
    main()
