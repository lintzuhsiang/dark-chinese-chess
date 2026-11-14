"""Detached fallback when macOS launchd lacks Desktop privacy authorization."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time

from .campaign import ROOT, Supervisor, atomic_json, read_json, validate_config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config_path = args.config.resolve()
    output = config_path.parent
    config = read_json(config_path)
    validate_config(config, output)
    Supervisor(output, config).check_sources()
    launch_path = output / "detached-launch-status.json"
    if launch_path.exists():
        raise FileExistsError("A detached attempt already exists; inspect before launching another writer")
    env = {**os.environ, "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
           "PYTHONPYCACHEPREFIX": "/tmp/ai7-overnight-pycache", "MPLCONFIGDIR": "/tmp/ai7-overnight-matplotlib",
           "PYTHONUNBUFFERED": "1", "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
           "OPENBLAS_NUM_THREADS": "2", "VECLIB_MAXIMUM_THREADS": "2"}
    command = ["/usr/bin/nice", "-n", "10", "/usr/bin/nohup", "/usr/bin/caffeinate", "-i",
               str(ROOT / ".venv/bin/python"), "-m", "scripts.ai7.guard_campaign", "--config", str(config_path)]
    with (output / "detached-stdout.log").open("a") as stdout, (output / "detached-stderr.log").open("a") as stderr:
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                   stdout=stdout, stderr=stderr, start_new_session=True)
    info = {"method": "nice10 + nohup + new OS session + caffeinate + independent guard",
            "launcher_pid": os.getpid(), "detached_pid": process.pid, "started_epoch": time.time(),
            "verified_running": False, "command": command,
            "fallback_reason": "launchd child denied Desktop pyvenv.cfg by macOS privacy controls",
            "launcher_source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    atomic_json(launch_path, info)
    for _ in range(30):
        if process.poll() is not None:
            break
        state = read_json(output / "run-status.json", {})
        if state.get("state") == "training" and state.get("supervisor_pid"):
            os.kill(state["supervisor_pid"], 0)
            info.update({"verified_running": True, "supervisor_pid": state["supervisor_pid"],
                         "guard_pid": read_json(output / "guard-control.json", {}).get("guard_pid")})
            break
        time.sleep(.5)
    atomic_json(launch_path, info)
    print(json.dumps(info), flush=True)
    if not info["verified_running"]:
        raise RuntimeError("Detached process did not establish a live supervisor; inspect detached-stderr.log")


if __name__ == "__main__":
    main()
