"""Run from the pinned E4 worktree. Uses only public observations and trusted local weights."""
from pathlib import Path
import hashlib
import json
import sys

sys.path.insert(0, str(Path.cwd()))
from scripts.ai7.runtime import encode, load_checkpoint, mask_array, seed_all
import numpy as np
import torch

ROOT = Path.cwd()
HERE = Path(__file__).resolve().parent
TOLERANCE = 1e-5


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def predict(path, observations, expected):
    assert fingerprint(path) == expected["sha256"], path
    model, checkpoint = load_checkpoint(path)
    config = checkpoint["config"]
    architecture = "e3_joint" if expected["arm"] == "B0" else "e4_ray"
    assert (config["seed"], checkpoint["env_steps"], config["architecture"]) == (
        expected["seed"], expected["transitions"], architecture)
    x = torch.tensor(np.stack([encode(o) for o in observations]))
    mask = torch.tensor(mask_array(observations))
    with torch.inference_mode():
        policy, value = model(x, mask)
    assert torch.isfinite(value).all()
    assert policy.probs[~mask].count_nonzero() == 0
    return [
        {"legal": o["legal"], "mask_true_ids": mask[i].nonzero().flatten().tolist(),
         "probabilities": policy.probs[i, o["legal"]].tolist(), "value": float(value[i])}
        for i, o in enumerate(observations)
    ]


def main():
    seed_all(19, 2)
    doc = json.loads((HERE / "public-fixed-vectors.json").read_text())
    out = []
    for expected in doc["checkpoints"]:
        path = ROOT / expected["path"].removeprefix("overlay/")
        actual = predict(path, doc["observations"], expected)
        prob_error = value_error = 0.
        for a, b in zip(actual, expected["outputs"]):
            assert a["legal"] == b["legal"] and a["mask_true_ids"] == b["mask_true_ids"]
            prob_error = max(prob_error, float(np.max(np.abs(np.array(a["probabilities"]) - b["probabilities"]))))
            value_error = max(value_error, abs(a["value"] - b["value"]))
        assert max(prob_error, value_error) <= TOLERANCE, (path, prob_error, value_error)
        out.append(dict(arm=expected["arm"], seed=expected["seed"], transitions=expected["transitions"],
                        probability_max_abs_error=prob_error, value_max_abs_error=value_error))
    print(json.dumps(dict(checkpoints=out, vector_count=len(doc["observations"]),
                          torch=torch.__version__, numpy=np.__version__, tolerance=TOLERANCE), indent=2))


if __name__ == "__main__":
    main()
