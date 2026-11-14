"""Register one bounded campaign with the user's existing macOS launchd domain."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import time

from .campaign import ROOT, Supervisor, atomic_json, read_json, validate_config


def launch_spec(config_path, label):
    output = config_path.parent
    return {
        "Label": label,
        "ProgramArguments": ["/usr/bin/caffeinate", "-i", str(ROOT / ".venv/bin/python"),
                             "-m", "scripts.ai7.guard_campaign", "--config", str(config_path)],
        "WorkingDirectory": str(ROOT),
        "RunAtLoad": True,
        "KeepAlive": False,
        "ProcessType": "Background",
        "Nice": 10,
        "LowPriorityIO": True,
        "EnvironmentVariables": {
            "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONUNBUFFERED": "1", "PYTHONPYCACHEPREFIX": "/tmp/ai7-overnight-pycache",
            "MPLCONFIGDIR": "/tmp/ai7-overnight-matplotlib",
            "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2",
            "VECLIB_MAXIMUM_THREADS": "2",
        },
        "StandardOutPath": str(output / "launchd-stdout.log"),
        "StandardErrorPath": str(output / "launchd-stderr.log"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--label", required=True)
    args = parser.parse_args()
    path = args.config.resolve()
    config = read_json(path)
    validate_config(config, path.parent)
    if read_json(path.parent / "launch-status.json", {}).get("verified_running"):
        raise RuntimeError("This campaign has already been launched; inspect its existing service")
    if not args.label.startswith("local.banqi.ai7.") or not all(character.isalnum() or character in ".-" for character in args.label):
        raise ValueError("Use a task-specific launchd label")
    # Source fingerprints are checked before any training can start.
    Supervisor(path.parent, config).check_sources()
    plist_path = path.parent / "launchd.plist"
    with plist_path.open("wb") as file:
        plistlib.dump(launch_spec(path, args.label), file)
    domain = f"gui/{os.getuid()}"
    command = ["/bin/launchctl", "bootstrap", domain, str(plist_path)]
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    launch = {"method": "macOS launchd RunAtLoad, single-use; idle-sleep assertion while running",
              "label": args.label, "service": f"{domain}/{args.label}", "initiator_pid": os.getpid(),
              "bootstrap_returncode": result.returncode, "stdout": result.stdout, "stderr": result.stderr,
              "verified_running": False, "plist": str(plist_path)}
    atomic_json(path.parent / "launch-status.json", launch)
    if result.returncode:
        raise RuntimeError(f"launchd bootstrap rejected: {result.stderr}")
    # Do not claim success from bootstrap alone: wait for actual supervisor state.
    for _ in range(20):
        status = read_json(path.parent / "run-status.json", {})
        pid = status.get("supervisor_pid")
        if pid and status.get("state") in ("training", "evaluation", "completed", "partial"):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                pass
            else:
                launch.update({"verified_running": True, "supervisor_pid": pid, "state_at_verification": status["state"]})
                break
        time.sleep(.5)
    detail = subprocess.run(["/bin/launchctl", "print", launch["service"]], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    (path.parent / "launchd-service.txt").write_text(detail.stdout + detail.stderr)
    atomic_json(path.parent / "launch-status.json", launch)
    print(json.dumps(launch), flush=True)
    if not launch["verified_running"]:
        raise RuntimeError("Service registered but live supervisor could not be verified; inspect launchd logs")


if __name__ == "__main__":
    main()
