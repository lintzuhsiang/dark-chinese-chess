"""Small independent launchd parent enforcing campaign lifetime after a crash."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import signal
import subprocess
import time

from .campaign import ROOT, atomic_json, directory_bytes, read_json, utc_now, validate_config


def running_groups(output):
    status = read_json(output / "run-status.json", {})
    return {record["pid"] for run in status.get("runs", [])
            for record in [run.get(phase, {}) for phase in ("training", "evaluation", "probes")]
            if record.get("state") == "running" and record.get("pid")}


def signal_groups(groups, signum):
    for pgid in groups:
        try:
            os.killpg(pgid, signum)
        except ProcessLookupError:
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config_path = args.config.resolve()
    output = config_path.parent
    config = read_json(config_path)
    validate_config(config, output)
    previous = read_json(output / "guard-control.json", {})
    started = previous.get("started_epoch", time.time())
    deadline = started + config["max_wall_seconds"]
    atomic_json(output / "guard-control.json", {"started_epoch": started, "deadline_epoch": deadline,
                "guard_pid": os.getpid(), "started_at": utc_now()})
    process = subprocess.Popen([str(ROOT / ".venv/bin/python"), "-m", "scripts.ai7.campaign", "--config", str(config_path)],
                               cwd=ROOT, stdin=subprocess.DEVNULL, start_new_session=True)
    stop = {"requested": False}
    def request_stop(_signal, _frame):
        stop["requested"] = True
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    reason = None
    while process.poll() is None:
        if stop["requested"]:
            reason = "guard_termination_requested"
        elif time.time() >= deadline - 30:
            reason = "global_wall_time_limit"
        elif directory_bytes(output) >= config["max_artifact_bytes"] - 100_000_000:
            reason = "global_storage_limit"
        if reason:
            process.terminate()
            try:
                process.wait(timeout=min(15, max(1, deadline - time.time() - 10)))
            except subprocess.TimeoutExpired:
                pass
            break
        time.sleep(2)
    groups = running_groups(output)
    if reason or process.returncode not in (None, 0):
        for pid in groups:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        time.sleep(min(3, max(0, deadline - time.time() - 5)))
        signal_groups(groups, signal.SIGKILL)
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=3)
        status = read_json(output / "run-status.json", {})
        for run in status.get("runs", []):
            for phase in ("training", "evaluation", "probes"):
                if run.get(phase, {}).get("state") == "running":
                    run[phase].update({"state": "failed", "reason": reason or "supervisor_crashed"})
        status.update({"state": "partial", "guard_stop_reason": reason or "supervisor_crashed", "finished_at": utc_now()})
        atomic_json(output / "run-status.json", status)
        # Make the most informative available report if time/storage permit.
        if deadline - time.time() > 20 and directory_bytes(output) < config["max_artifact_bytes"] - 20_000_000:
            env = {**os.environ, "AI7_ARTIFACT_ROOT": str(output)}
            try:
                subprocess.run([str(ROOT / ".venv/bin/python"), "-m", "scripts.ai7.research", "--campaign", str(output)],
                               cwd=ROOT, env=env, timeout=min(60, deadline - time.time() - 5), check=True)
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
                status["guard_report_error"] = str(error)
                atomic_json(output / "run-status.json", status)
    atomic_json(output / "guard-status.json", {"state": "finished", "reason": reason,
                "supervisor_returncode": process.returncode, "finished_at": utc_now(),
                "elapsed_seconds": time.time() - started, "artifact_bytes": directory_bytes(output)})


if __name__ == "__main__":
    main()
