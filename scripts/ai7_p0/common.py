"""Evaluation-only artifact and compatibility helpers. Never creates an optimizer."""
import ast
from functools import lru_cache
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from scripts.ai7.runtime import Policy

ROOT = Path(__file__).resolve().parents[2]
INTEL = ROOT / "benchmark-results/ai7-selfplay/intel-learning/20261115-v1"
METHODS = ["baseline", "gae_lambda_095", "chain_lite"]
SEEDS = [6011, 6023, 6037]
ENDPOINTS = ["initial", "step-000910000", "step-001820000", "step-002730000", "final"]


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def json_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value, replace=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if replace:
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        temporary.replace(path)
    else:
        with path.open("x") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")


def bundle(output):
    return output / "imports/intel-evaluation-bundle"


def function_source(root, name):
    source = (root / "scripts/ai7/runtime.py").read_text()
    node = next(n for n in ast.parse(source).body if getattr(n, "name", None) == name)
    return ast.get_source_segment(source, node)


def function_hash(root, name):
    return hashlib.sha256(function_source(root, name).encode()).hexdigest()


def load_original_historical(path):
    # Owner-supplied trusted experiment artifact, checksum-verified before load.
    return torch.load(path, map_location="cpu", weights_only=False), "native_torch_load"


def historical_weights(directory):
    schema = read(directory / "historical-opponent/weight-schema.json")
    metadata = read(directory / "historical-opponent/checkpoint-metadata.json")
    manifest = read(directory / "manifest.json")
    original = directory / "historical-opponent/baseline-seed-4023-step-3640000.pt"
    assert sha256(original) == manifest["checkpoint_sha256"]
    assert metadata["env_steps"] == 3640000 and metadata["config"]["seed"] == 4023
    assert metadata["model_config"] == {"architecture": "baseline", "input_dim": 2163, "width": 128}
    weights = {}
    with np.load(directory / "historical-opponent/model-weights.npz", allow_pickle=False) as data:
        if set(data.files) != set(schema):
            raise ValueError("Historical tensor key mismatch")
        for key, specification in schema.items():
            value = data[key]
            if list(value.shape) != specification["shape"] or value.dtype != np.dtype("float32"):
                raise ValueError(f"Historical tensor shape/dtype mismatch: {key}")
            if hashlib.sha256(value.astype("<f4").tobytes()).hexdigest() != specification["sha256_float32"]:
                raise ValueError(f"Historical tensor digest mismatch: {key}")
            weights[key] = torch.from_numpy(value.copy())
    return weights


def load_historical(directory):
    model = Policy()
    model.load_state_dict(historical_weights(directory), strict=True)
    model.eval()
    return model


def target_metrics(probabilities, legal_ids, target_ids):
    legal = np.array(sorted(legal_ids), dtype=np.int64)
    targets = np.array(sorted(set(target_ids)), dtype=np.int64)
    if len(legal) == 0 or len(targets) == 0 or not set(targets).issubset(set(legal)):
        raise ValueError("Tactical targets must be nonempty legal actions")
    p = np.asarray(probabilities)
    if not np.isfinite(p[legal]).all() or not np.isclose(p[legal].sum(), 1., atol=1e-5):
        raise ValueError("Invalid masked policy probabilities")
    top1 = int(legal[np.argmax(p[legal])])  # Ties: smallest numeric legal action ID.
    mass = float(p[targets].sum())
    uniform = len(targets) / len(legal)
    return {"target_probability": mass, "uniform_probability": uniform,
            "probability_over_uniform": mass / uniform, "probability_excess_over_uniform": mass - uniform,
            "top1_action": top1, "top1_correct": top1 in set(targets),
            "best_target_rank": 1 + int(np.count_nonzero(p[legal] > p[targets].max())),
            "top1_tie_count": int(np.count_nonzero(p[legal] == p[top1])),
            "target_actions": targets.tolist(), "legal_count": len(legal)}


@lru_cache(maxsize=16)
def bootstrap_indices(count, resamples, seed):
    indices = np.random.default_rng(seed).integers(count, size=(resamples, count))
    indices.setflags(write=False)
    return indices


def paired_statistics(differences, resamples=4000, seed=91023):
    values = np.asarray(differences, dtype=np.float64)
    if not len(values):
        raise ValueError("No paired samples")
    indices = bootstrap_indices(len(values), resamples, seed)
    samples = values[indices].mean(1)
    return {"mean": float(values.mean()), "percentile95": np.quantile(samples, [.025, .975]).tolist(),
            "pairs": len(values), "resamples": resamples, "bootstrap_seed": seed,
            "unit": "independent source positions; both orientations averaged before resampling; conditional on fixed trained models"}
