"""Measure Core, encoding, serialization, bridge and device costs before training."""
from __future__ import annotations

import argparse
from pathlib import Path
import time

import numpy as np
import torch

from .runtime import Bridge, Policy, ROOT, encode, mask_array, provenance, seed_all, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "benchmark-results/ai7-selfplay/preflight")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    seed_all(7)
    bridge = Bridge(output / "replays")
    try:
        result = {"provenance": provenance(), "node_environment": bridge.metadata}
        result["core"] = bridge.request(command="benchmark", steps=2000)
        batches = []
        for count in [1, 8, 16]:
            observations = bridge.request(command="reset", games=[{"id": i, "seed": 900_000 + i} for i in range(count)])
            started = time.perf_counter()
            steps = 0
            for tick in range(100):
                actions = [{"id": row["id"], "action": row["observation"]["legal"][tick % len(row["observation"]["legal"])]} for row in observations]
                observations = bridge.request(command="step", actions=actions)
                steps += len(actions)
                observations = [row for row in observations if not row["terminated"]]
                if not observations:
                    break
            seconds = time.perf_counter() - started
            batches.append({"batch": count, "steps": steps, "seconds": seconds, "steps_per_second": steps / seconds})
        result["bridge_batches"] = batches
        if observations:
            populated = observations[0]["observation"]
            started = time.perf_counter()
            for _ in range(1000):
                encode(populated)
            result["python_encoding_populated_us"] = (time.perf_counter() - started) * 1000
            result["populated_history_length"] = len(populated["history"])
        started = time.perf_counter()
        for _ in range(100):
            bridge.request(command="reset", games=[])
        result["empty_batch_round_trip_ms"] = (time.perf_counter() - started) * 10
        observation = bridge.request(command="reset", games=[{"id": 0, "seed": 900_010}])[0]["observation"]
        started = time.perf_counter()
        for _ in range(1000):
            features = encode(observation)
        result["python_encoding_us"] = (time.perf_counter() - started) * 1000
        result["input_dim"] = len(features)
        model = Policy(input_dim=len(features))
        result["parameters"] = sum(parameter.numel() for parameter in model.parameters())
        devices = ["cpu"] + (["mps"] if torch.backends.mps.is_available() else [])
        result["devices"] = []
        for device in devices:
            model.to(device)
            for count in [1, 16, 256]:
                x = torch.from_numpy(np.stack([features] * count)).to(device)
                mask = torch.from_numpy(mask_array([observation] * count)).to(device)
                with torch.no_grad():
                    for _ in range(10):
                        model(x, mask)[0].probs.cpu()
                    started = time.perf_counter()
                    for _ in range(100):
                        model(x, mask)[0].probs.cpu()
                result["devices"].append({"device": device, "batch": count, "ms_per_batch": 10 * (time.perf_counter() - started)})
        write_json(output / "benchmark.json", result)
        print({key: value for key, value in result.items() if key != "provenance"}, flush=True)
    finally:
        bridge.close()


if __name__ == "__main__":
    main()
