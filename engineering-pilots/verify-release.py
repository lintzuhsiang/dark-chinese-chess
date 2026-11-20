"""Retrieve published engineering-pilot bundles and run their pinned CPU verifier."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machine-id", required=True)
    parser.add_argument("pilots", nargs="+")
    args = parser.parse_args()
    catalog = Path(__file__).resolve().parent
    with TemporaryDirectory() as temp:
        cache = Path(temp)
        for pilot in args.pilots:
            record = json.loads((catalog / pilot / "pilot.json").read_text())
            source = cache / record["source_commit"]
            repo = record["repository"]
            tag = record["release_tag"]
            if not source.exists():
                subprocess.run(["git", "clone", "--quiet", "--depth", "1", "--branch", tag,
                                f"https://github.com/{repo}.git", str(source)], check=True)
            bundle = cache / record["bundle_filename"]
            subprocess.run(["gh", "release", "download", tag, "--repo", repo,
                            "--pattern", bundle.name, "--dir", str(cache)], check=True)
            subprocess.run([sys.executable, "-B", "-m", "scripts.ai7.engineering_pilot", "verify",
                            "--source-worktree", str(source), "--bundle", str(bundle),
                            "--bundle-sha256", record["bundle_sha256"], "--machine-id", args.machine_id],
                           cwd=source, check=True)


if __name__ == "__main__":
    main()
