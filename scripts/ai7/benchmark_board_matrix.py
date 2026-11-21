"""Bounded CPU tensor timings on repeated public engineering fixtures, one process per arm."""
import argparse
import hashlib
import json
import os
import platform
import resource
import statistics
import sys
import time

import numpy as np
import torch

from .runtime import BOARD_ARMS, encode, make_policy, mask_array, seed_all
from .tests.test_relational_head import public_fixtures


def measure(function, repetitions):
    for _ in range(5):
        function()
    samples = []
    cpu = time.process_time()
    wall = time.perf_counter()
    for _ in range(repetitions):
        start = time.perf_counter_ns()
        function()
        samples.append((time.perf_counter_ns() - start) / 1e6)
    return {"median_ms": statistics.median(samples), "p90_ms": float(np.percentile(samples, 90)),
            "cpu_percent_one_core": 100 * (time.process_time() - cpu) / (time.perf_counter() - wall),
            "repetitions": repetitions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("arm", choices=("e2b_l", *BOARD_ARMS))
    args = parser.parse_args()
    seed_all(2718)
    model = make_policy({"architecture": args.arm})
    obs, _ = public_fixtures()
    report = {"arm": args.arm, "model_config": model.config, "seed": 2718,
              "parameters": sum(p.numel() for p in model.parameters()),
              "platform": platform.platform(), "machine": platform.machine(), "cpus": os.cpu_count(),
              "torch": torch.__version__, "numpy": np.__version__, "python": platform.python_version(),
              "torch_build": torch.__config__.show(), "torch_threads": torch.get_num_threads(),
              "interop_threads": torch.get_num_interop_threads(), "cases": []}
    for batch, indexes in [(1, [4]), (1, [0]), (16, [2, 4, 5]), (256, [2, 4, 5])]:
        observations = [obs[indexes[i % len(indexes)]] for i in range(batch)]
        x = torch.from_numpy(np.stack([encode(o) for o in observations]))
        mask = torch.from_numpy(mask_array(observations))
        case = {"batch": batch, "legal_per_state": mask.sum().item()/batch,
                "flip_fraction": mask[:, :32].sum().item()/mask.sum().item(),
                "input_sha256": hashlib.sha256(x.numpy().tobytes() + mask.numpy().tobytes()).hexdigest()}
        head = model.actor
        with torch.inference_mode():
            h = model.body(x)
            rows, ids = mask.nonzero(as_tuple=True)
            src, dst = head.source[ids], head.target[ids]
            repeats = 40 if batch != 256 else 15
            case["encoder"] = measure(lambda: model.body(x), repeats)
            case["legal_scorer"] = measure(lambda: head(h, x, mask), repeats)
            if head.board_projection is not None:
                case["projection"] = measure(lambda: head.board_projection(x, rows, ids, src, dst), repeats)
            def inference():
                distribution, _ = model(x, mask)
                return distribution.probs
            case["forward"] = measure(inference, repeats)
        if batch == 256:
            actions = mask.long().argmax(dim=1)
            def forward_backward():
                model.zero_grad(set_to_none=True)
                distribution, v = model(x, mask)
                loss = -distribution.log_prob(actions).mean() + .5*v.square().mean() - .01*distribution.entropy().mean()
                loss.backward()
            case["forward_backward"] = measure(forward_backward, 20)
        report["cases"].append(case)
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    report["peak_process_rss_mib"] = rss / (1024**2 if sys.platform == "darwin" else 1024)
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
