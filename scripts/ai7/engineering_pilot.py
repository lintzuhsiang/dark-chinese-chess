"""Build and verify the E2a-G cross-device handoff using frozen inference."""
import argparse
import hashlib
import io
import json
import platform
import subprocess
import sys
import zipfile
from pathlib import Path


LIMIT = 32 * 1024 * 1024
TOLERANCE = 1e-5
PAYLOADS = {"final.pt", "weights.npz", "vectors.npz", "observations.json"}
SOURCE_FILES = (
    "scripts/ai7/runtime.py", "scripts/ai7/geometry_head.py", "scripts/ai7/train.py",
    "scripts/ai7/environment.ts", "scripts/ai7/server.ts",
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(data):
    return (json.dumps(data, indent=2, sort_keys=True, allow_nan=False) + "\n").encode()


def versions(np, torch):
    return {"platform": platform.platform(), "python": platform.python_version(),
            "torch": str(torch.__version__), "numpy": np.__version__, "device": "cpu"}


def pinned_runtime(checkout, commit=None, extra_files=()):
    checkout = checkout.resolve()
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip()
    if commit is not None:
        require(revision == commit, f"Checkout {commit} for the pilot runtime, got {revision}")
    hashes = {}
    for name in (*SOURCE_FILES, *extra_files):
        data = (checkout / name).read_bytes()
        committed = subprocess.check_output(["git", "show", f"HEAD:{name}"], cwd=checkout)
        require(data == committed, f"Uncommitted runtime input: {name}")
        hashes[name] = sha(data)
    sys.path.insert(0, str(checkout))
    from scripts.ai7 import runtime
    require(Path(runtime.__file__).resolve().is_relative_to(checkout), "Incorrect runtime import path")
    return runtime, revision, hashes


def vectors(runtime, model, observations):
    import numpy as np
    import torch

    features = np.stack([runtime.encode(obs) for obs in observations])
    masks = runtime.mask_array(observations)
    require(len(features) >= 65, "Fixture must exercise both scoring paths")
    model.eval()
    with torch.inference_mode():
        large, value = model(torch.from_numpy(features), torch.from_numpy(masks))
        small = []
        for x, m in zip(features[:16].reshape(2, 8, -1), masks[:16].reshape(2, 8, -1)):
            dist, _ = model(torch.from_numpy(x), torch.from_numpy(m))
            small.append(dist.probs.numpy())
    return {"features": features, "masks": masks, "probabilities": large.probs.numpy(),
            "value": value.numpy(), "small_batch_probabilities": np.concatenate(small)}


def npz(arrays):
    import numpy as np

    output = io.BytesIO()
    np.savez(output, **arrays)
    return output.getvalue()


def build(args):
    import numpy as np
    import torch

    runtime, revision, source_hashes = pinned_runtime(args.source_worktree)
    pilot = args.pilot
    run = json.loads((pilot / "pilot/manifest.json").read_bytes())
    for name, digest in source_hashes.items():
        require(run["provenance"]["source_hashes"][name] == digest, f"Actual pilot source differs: {name}")
    completion = json.loads((pilot / "completion-verification.json").read_bytes())
    require(completion["validated_environment_transitions"] == 100_000, "Pilot endpoint differs")
    checkpoint = pilot / "pilot/final.pt"
    checkpoint_bytes = checkpoint.read_bytes()
    execution = json.loads((pilot / "pilot-execution.json").read_bytes())
    require(sha(checkpoint_bytes) == execution["after_resume"]["checkpoint_sha256"], "Incorrect final checkpoint")
    runtime.seed_all(91001, 2)
    model, metadata = runtime.load_checkpoint(checkpoint)
    require(metadata["config"]["seed"] == 91001 and metadata["env_steps"] == 100_000
            and metadata["model_config"]["architecture"] == "e2a_g", "Unexpected pilot checkpoint")
    bank_bytes = args.stage2.read_bytes()
    bank = json.loads(bank_bytes)
    require(args.stage2.name == "stage2.json" and bank["phase"] == "stage2", "Expected explored Stage2")
    require(sha(bank_bytes) == args.stage2_sha256, "Stage2 provenance differs")
    selection = sorted(bank["bank"], key=lambda row: row["id"])[::10]
    observations = [row[key] for row in selection for key in ("observation", "rotated")]
    payload = {
        "final.pt": checkpoint_bytes,
        "weights.npz": npz({name: tensor.detach().cpu().numpy() for name, tensor in model.state_dict().items()}),
        "vectors.npz": npz(vectors(runtime, model, observations)),
        "observations.json": encoded(observations),
    }
    manifest = {
        "schema_version": 1, "pilot_id": "e2a-g-m1-seed-91001-100k",
        "source_commit": revision, "recorded_parent_commit": run["provenance"]["source_revision"],
        "runtime_source_sha256": source_hashes, "producer_runtime": versions(np, torch),
        "checkpoint_sha256": sha(checkpoint_bytes), "core_revision": metadata["core_revision"],
        "model_config": metadata["model_config"], "architecture": metadata["architecture"],
        "observation_version": metadata["observation_version"], "environment_transitions": metadata["env_steps"],
        "training_seed": metadata["config"]["seed"],
        "fixture": {"stage2_sha256": sha(bank_bytes), "source_ids": [r["id"] for r in selection],
                    "observations": len(observations), "scope": "previously explored Stage2 public observations",
                    "tolerance_abs": TOLERANCE},
        "files": {name: sha(data) for name, data in payload.items()},
    }
    with zipfile.ZipFile(args.bundle, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in {**payload, "manifest.json": encoded(manifest)}.items():
            archive.writestr(name, data)
    print(encoded({"bundle_sha256": sha(args.bundle.read_bytes()), **manifest}).decode(), end="")


def verify(args):
    import numpy as np
    import torch

    require(args.bundle.stat().st_size <= LIMIT, "Bundle exceeds size limit")
    bundle = args.bundle.read_bytes()
    require(sha(bundle) == args.bundle_sha256, "Bundle SHA-256 differs from the published record")
    with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
        entries = archive.infolist()
        require(len(entries) == 5 and {entry.filename for entry in entries} == PAYLOADS | {"manifest.json"},
                "Unexpected bundle members")
        require(sum(entry.file_size for entry in entries) <= LIMIT, "Uncompressed bundle exceeds size limit")
        manifest = json.loads(archive.read("manifest.json"))
        require(set(manifest["files"]) == PAYLOADS, "Incomplete manifest")
        payload = {name: archive.read(name) for name in PAYLOADS}
    for name, data in payload.items():
        require(sha(data) == manifest["files"][name], f"Member SHA-256 mismatch: {name}")
    require(sha(payload["final.pt"]) == manifest["checkpoint_sha256"], "Original checkpoint SHA-256 mismatch")
    require(manifest["fixture"]["tolerance_abs"] == TOLERANCE, "Fixture tolerance differs")
    architecture = manifest["model_config"]["architecture"]
    extra = ("scripts/ai7/relational_head.py",) if architecture in ("e2b_g", "e2b_l") else ()
    runtime, revision, source_hashes = pinned_runtime(args.source_worktree, manifest["source_commit"], extra)
    require(source_hashes == manifest["runtime_source_sha256"], "Runtime source SHA-256 mismatch")
    require(runtime.CORE_REVISION == manifest["core_revision"]
            and runtime.OBSERVATION_VERSION == manifest["observation_version"], "Core or observation version mismatch")
    runtime.seed_all(manifest["training_seed"], 2)
    model = runtime.make_policy(manifest["model_config"])
    with np.load(io.BytesIO(payload["weights.npz"]), allow_pickle=False) as weights:
        expected = model.state_dict()
        require(set(weights.files) == set(expected), "Weights key mismatch")
        state = {}
        for name, tensor in expected.items():
            value = torch.from_numpy(weights[name])
            require(value.shape == tensor.shape and value.dtype == tensor.dtype, f"Weight shape/dtype mismatch: {name}")
            require(torch.isfinite(value).all(), f"Nonfinite weights: {name}")
            state[name] = value
        model.load_state_dict(state, strict=True)
    actual = vectors(runtime, model, json.loads(payload["observations.json"]))
    errors = {}
    masks = actual["masks"]
    with np.load(io.BytesIO(payload["vectors.npz"]), allow_pickle=False) as expected:
        require(set(expected.files) == set(actual), "Test vector key mismatch")
        for key in ("features", "masks"):
            require(np.array_equal(actual[key], expected[key]), f"Public input mismatch: {key}")
        for key in ("probabilities", "small_batch_probabilities", "value"):
            require(actual[key].shape == expected[key].shape and np.isfinite(actual[key]).all(),
                    f"Invalid output: {key}")
            errors[key] = float(np.max(np.abs(actual[key] - expected[key])))
            require(errors[key] <= TOLERANCE, f"Fixed-vector mismatch: {key} max error {errors[key]}")
    for key, mask in (("probabilities", masks), ("small_batch_probabilities", masks[:16])):
        probabilities = actual[key]
        require(not probabilities[~mask].any() and (probabilities >= 0).all(), "Illegal or negative probability")
        require(np.max(np.abs(probabilities.sum(axis=1) - 1)) <= TOLERANCE, "Probabilities not normalized")
    result = {"schema_version": 1, "status": "passed", "pilot_id": manifest["pilot_id"],
              "validation_scope": "fixed-vector frozen inference with portable final-policy tensors",
              "machine_id": args.machine_id, "runtime": versions(np, torch), "source_commit": revision,
              "bundle_sha256": args.bundle_sha256, "checkpoint_sha256": manifest["checkpoint_sha256"],
              "portable_weights_sha256": manifest["files"]["weights.npz"], "observations": len(masks),
              "tolerance_abs": TOLERANCE, "max_abs_errors": errors}
    if args.output:
        with args.output.open("xb") as handle:
            handle.write(encoded(result))
    print(encoded(result).decode(), end="")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("build", "verify"):
        command = commands.add_parser(name)
        command.add_argument("--source-worktree", type=Path, required=True)
        command.add_argument("--bundle", type=Path, required=True)
        if name == "build":
            command.add_argument("--pilot", type=Path, required=True)
            command.add_argument("--stage2", type=Path, required=True)
            command.add_argument("--stage2-sha256", required=True)
        else:
            command.add_argument("--bundle-sha256", required=True)
            command.add_argument("--machine-id", required=True)
            command.add_argument("--output", type=Path)
    args = parser.parse_args()
    {"build": build, "verify": verify}[args.command](args)


if __name__ == "__main__":
    main()
