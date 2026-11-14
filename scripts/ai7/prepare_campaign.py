"""Sequential smoke profiling, conservative feasibility, and frozen campaign plan."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

from .campaign import ARCHITECTURES, CAMPAIGN_BASE, ROOT, SEEDS, atomic_json, read_json, validate_config


def choose_budget(profiles, max_wall_seconds=25200, reserve_evaluation=3600, reserve_report=180, target=4_000_000):
    # Costs include complete Core collection, PPO, validation and checkpoints.
    # Apply a 50% slowdown allowance for thermal/load/policy-distribution changes.
    costs = {architecture: profiles[architecture]["training_wall_seconds"] / profiles[architecture]["env_steps"] for architecture in ARCHITECTURES}
    available = max_wall_seconds - reserve_evaluation - reserve_report - 300
    per_step_all_runs = 3 * sum(costs.values()) * 1.5
    affordable = math.floor(available / per_step_all_runs / 10000) * 10000
    selected = min(target, affordable)
    if selected < 10000:
        raise RuntimeError("Measured throughput cannot support all nine minimum runs with reserves")
    selected -= selected % 4
    return {
        "target_env_steps": selected,
        "estimated_training_seconds_without_margin": 3 * selected * sum(costs.values()),
        "estimated_training_seconds_with_50pct_margin": per_step_all_runs * selected,
        "estimated_total_seconds_with_reserves": per_step_all_runs * selected + reserve_evaluation + reserve_report,
        "per_run_training_seconds": min(24000, math.ceil(selected * max(costs.values()) * 2 + 120)),
        "measured_seconds_per_step": costs,
        "target_reduced_equally_before_campaign": selected < target,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--smoke-steps", type=int, default=32768)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(CAMPAIGN_BASE) or args.smoke_steps < 6000:
        raise ValueError("Use a new overnight-comparison directory and a meaningful bounded smoke profile")
    output.mkdir(parents=True, exist_ok=False)
    env = {**os.environ, "AI7_ARTIFACT_ROOT": str(output), "PYTHONPYCACHEPREFIX": "/tmp/ai7-overnight-pycache",
           "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "VECLIB_MAXIMUM_THREADS": "2"}
    profiles = {}
    for architecture in ARCHITECTURES:
        run = output / "preflight" / architecture
        run.parent.mkdir(exist_ok=True)
        command = [sys.executable, "-m", "scripts.ai7.train", "--output", str(run),
                   "--architecture", architecture, "--seed", "101", "--max-env-steps", str(args.smoke_steps),
                   "--max-updates", "100000", "--training-seconds", "300", "--batch-games", "16", "--threads", "2",
                   "--checkpoint-every-steps", str(args.smoke_steps // 4), "--max-replays", "0",
                   "--validation-seed-start", "1100000", "--validation-pairs", "2"]
        started = time.perf_counter()
        with (run.parent / f"{architecture}.stdout.jsonl").open("w") as stdout, (run.parent / f"{architecture}.stderr.log").open("w") as stderr:
            result = subprocess.run(command, cwd=ROOT, env=env, stdout=stdout, stderr=stderr, timeout=330)
        summary = read_json(run / "summary.json", {})
        if result.returncode or summary.get("env_steps") != args.smoke_steps or not summary.get("checkpoint_exact_reload"):
            raise RuntimeError(f"{architecture} failed the smoke gate: inspect {run.parent}")
        profiles[architecture] = {**summary, "launch_wall_seconds": time.perf_counter() - started}
        atomic_json(output / "preflight-profiles.json", profiles)
        print(json.dumps({"architecture": architecture, "smoke_steps": summary["env_steps"], "training_seconds": summary["training_wall_seconds"], "parameters": summary.get("parameters")}), flush=True)
    budget = choose_budget(profiles)
    # Latin-square order distributes architecture order across independent seeds.
    jobs = [{"id": f"{architecture}-seed-{seed}", "architecture": architecture, "seed": seed}
            for row, seed in enumerate(SEEDS) for architecture in (ARCHITECTURES[row:] + ARCHITECTURES[:row])]
    from .runtime import provenance
    source = provenance()
    config = {
        "schema_version": 1, "architectures": list(ARCHITECTURES), "seeds": list(SEEDS), "jobs": jobs,
        "max_wall_seconds": 25200, "max_artifact_bytes": 5_000_000_000,
        "reserve_evaluation_seconds": 3600, "reserve_report_seconds": 180,
        "target_env_steps": budget["target_env_steps"], "milestone_steps": budget["target_env_steps"] // 4,
        "per_run_training_seconds": budget["per_run_training_seconds"], "threads": 2, "batch_games": 16,
        "evaluation_pairs": 128, "eval_seed_start": 3_000_000, "validation_seed_start": 1_100_000,
        "eligible_architectures": list(ARCHITECTURES), "feasibility": budget,
        "source_hashes": source["source_hashes"], "source_revision": source["source_revision"], "core_revision": source["core_revision"],
        "protocol": {
            "selection": "Final predetermined endpoint; no selection on held-out games or probes",
            "independent_replication_unit": "training seed (11,23,37)",
            "primary_opponent": "uniform random legal action", "primary_seed_pairs": 128,
            "rewards": {"win": 1, "draw": 0, "loss": -1, "intermediate": 0},
            "ppo": {"gamma": 1, "gae_lambda": 1, "learning_rate": .0003, "epochs": 4, "minibatch": 256, "clip": .2, "target_kl": .03, "value_coefficient": .5, "entropy_coefficient": .01, "max_grad_norm": .5},
            "frozen_ev_ai6a": "Optional omitted from primary campaign; no model selection from final results",
            "probes": "Evaluation only, compare initial/final, never used by PPO or checkpoint selection",
        },
    }
    validate_config(config, output)
    atomic_json(output / "config.json", config)
    atomic_json(output / "source-provenance.json", source)
    for name, digest in config["source_hashes"].items():
        data = (ROOT / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise RuntimeError(f"Source changed while freezing campaign: {name}")
        target = output / "source-snapshot" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(json.dumps({"campaign": str(output), "feasibility": budget}), flush=True)


if __name__ == "__main__":
    main()
