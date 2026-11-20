"""Safely import a supplied M1 bundle without touching existing artifacts."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_name(name):
    parts = PurePosixPath(name).parts
    if not parts or PurePosixPath(name).is_absolute() or ".." in parts or "\\" in name:
        raise ValueError(f"Unsafe archive member: {name}")
    if parts[0] != "intel-evaluation-bundle":
        raise ValueError(f"Unexpected archive root: {name}")
    return parts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--existing-copy", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    skipped, extracted = [], []
    with tarfile.open(args.archive, "r:gz") as archive:
        members = archive.getmembers()
        if len(members) > 10000 or sum(m.size for m in members) > 1_000_000_000:
            raise ValueError("Unexpected archive size")
        names = set()
        for member in members:
            parts = safe_name(member.name)
            if member.name in names:
                raise ValueError("Duplicate archive member")
            names.add(member.name)
            if any("reserved" in part.lower() or "confirmation-bank" in part.lower() for part in parts):
                skipped.append(member.name)
                continue
            if member.isdir():
                (output / member.name).mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                raise ValueError(f"Links and special members are unsupported: {member.name}")
            destination = output / member.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, destination.open("xb") as target:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    target.write(block)
            extracted.append(member.name)
    bundle = output / "intel-evaluation-bundle"
    checks = []
    for line in (bundle / "checksums.sha256").read_text().splitlines():
        expected, name = line.split("  ", 1)
        parts = safe_name("intel-evaluation-bundle/" + name)
        if any("reserved" in part.lower() for part in parts):
            raise ValueError("Checksum list requests excluded reserved data")
        actual = sha256(bundle / name)
        if actual != expected:
            raise ValueError(f"Checksum mismatch: {name}")
        existing_matches = None
        if args.existing_copy:
            existing_matches = sha256(args.existing_copy / name) == expected
            if not existing_matches:
                raise ValueError(f"Existing extracted copy differs: {name}")
        checks.append({"path": name, "sha256": actual, "existing_copy_matches": existing_matches})
    manifest = json.loads((bundle / "manifest.json").read_text())
    assert sha256(bundle / "tactical-bank/stage2.json") == manifest["bank_sha256"]
    assert sha256(bundle / "historical-opponent/baseline-seed-4023-step-3640000.pt") == manifest["checkpoint_sha256"]
    result = {"archive_path": str(args.archive.resolve()), "archive_sha256": sha256(args.archive),
              "bundle_path": str(bundle), "extracted_files": len(extracted), "verified_files": len(checks),
              "reserved_members_not_extracted": skipped, "reserved_included_by_manifest": manifest["tactical"]["reserved_included"],
              "checks": checks, "status": "checksums_verified; semantic_and_inference_validation_pending"}
    (output.parent / "import-validation.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key != "checks"}))


if __name__ == "__main__":
    main()
