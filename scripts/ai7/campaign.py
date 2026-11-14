"""Bounded sequential local campaign supervisor. Does not depend on a chat session."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import traceback

ROOT = Path(__file__).resolve().parents[2]
CAMPAIGN_BASE = ROOT / "benchmark-results/ai7-selfplay/overnight-comparison"
MAX_SECONDS = 7 * 3600
MAX_BYTES = 5_000_000_000
ARCHITECTURES = ("baseline", "critic", "cnn")
SEEDS = (11, 23, 37)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".writing")
    with temporary.open("w") as file:
        json.dump(value, file, indent=2, allow_nan=False)
        file.write("\n")
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)


def directory_bytes(path):
    total = 0
    for folder, _, files in os.walk(path, followlinks=False):
        for name in files:
            try:
                total += (Path(folder) / name).lstat().st_size
            except FileNotFoundError:
                pass  # an atomic checkpoint replacement raced this sample
    return total


def validate_config(config, output):
    if not output.resolve().is_relative_to(CAMPAIGN_BASE):
        raise ValueError("Campaign output must be isolated under overnight-comparison")
    if set(config["architectures"]) != set(ARCHITECTURES) or tuple(config["seeds"]) != SEEDS:
        raise ValueError("This campaign requires exactly baseline/critic/cnn and seeds 11,23,37")
    matrix = [(job["architecture"], job["seed"]) for job in config["jobs"]]
    if len(matrix) != 9 or set(matrix) != {(architecture, seed) for architecture in ARCHITECTURES for seed in SEEDS}:
        raise ValueError("Campaign must contain each of the nine independent runs exactly once")
    if len({job["id"] for job in config["jobs"]}) != 9:
        raise ValueError("Duplicate run ID")
    for job in config["jobs"]:
        if job["id"] != f"{job['architecture']}-seed-{job['seed']}":
            raise ValueError("Invalid run directory name")
    if not 0 < config["max_wall_seconds"] <= MAX_SECONDS or not 0 < config["max_artifact_bytes"] <= MAX_BYTES:
        raise ValueError("Campaign exceeds the seven-hour/5 GB authorization")
    if not 1 <= config["target_env_steps"] <= 4_000_000:
        raise ValueError("Common target must be in [1, 4000000]")
    if not 1 <= config["threads"] <= 2 or config["batch_games"] != 16:
        raise ValueError("Campaign uses two or fewer Torch threads, 16 games, one job at a time")
    if config["evaluation_pairs"] < 128:
        raise ValueError("Primary protocol requires at least 128 independent deck pairs")
    if config["eval_seed_start"] < 3_000_000:
        raise ValueError("Final held-out seed set must be new")
    if config["reserve_evaluation_seconds"] + config["reserve_report_seconds"] >= config["max_wall_seconds"]:
        raise ValueError("No training time remains after reserves")
    if config["reserve_evaluation_seconds"] <= 0 or config["reserve_report_seconds"] < 120:
        raise ValueError("Positive evaluation and reporting reserves are required")


class Supervisor:
    def __init__(self, output, config):
        self.output = output.resolve()
        self.config = config
        validate_config(config, self.output)
        old = read_json(self.output / "run-status.json")
        if old:
            for run in old.get("runs", []):
                for phase in ("training", "evaluation", "probes"):
                    record = run.get(phase, {})
                    if record.get("state") == "running" and record.get("pid"):
                        try:
                            os.kill(record["pid"], 0)
                        except ProcessLookupError:
                            pass
                        else:
                            raise RuntimeError(f"Refusing duplicate execution: prior {phase} PID {record['pid']} is still alive")
        guard = read_json(self.output / "guard-control.json", {})
        self.status = old or {
            "schema_version": 1, "state": "initializing", "started_at": utc_now(),
            "started_epoch": guard.get("started_epoch", time.time()), "runs": [
                {**job, "training": {"state": "pending"}, "evaluation": {"state": "pending"}, "probes": {"state": "pending"}}
                for job in config["jobs"]
            ],
        }
        self.deadline = self.status["started_epoch"] + config["max_wall_seconds"]
        self.status.update({"supervisor_pid": os.getpid(), "deadline_epoch": self.deadline, "limits": {
            "wall_seconds": config["max_wall_seconds"], "artifact_bytes": config["max_artifact_bytes"],
            "sequential_heavy_jobs": 1, "torch_threads": config["threads"],
        }})
        self.stop_requested = False
        self.active = None
        self.env = {
            **os.environ,
            "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONUNBUFFERED": "1", "PYTHONPYCACHEPREFIX": "/tmp/ai7-overnight-pycache",
            "MPLCONFIGDIR": "/tmp/ai7-overnight-matplotlib",
            "AI7_ARTIFACT_ROOT": str(self.output),
            "OMP_NUM_THREADS": str(config["threads"]), "MKL_NUM_THREADS": str(config["threads"]),
            "OPENBLAS_NUM_THREADS": str(config["threads"]), "VECLIB_MAXIMUM_THREADS": str(config["threads"]),
        }

    def persist(self):
        self.status.update({"updated_at": utc_now(), "artifact_bytes": directory_bytes(self.output), "elapsed_seconds": time.time() - self.status["started_epoch"]})
        atomic_json(self.output / "run-status.json", self.status)

    def event(self, event, **details):
        with (self.output / "supervisor-events.jsonl").open("a") as file:
            file.write(json.dumps({"at": utc_now(), "event": event, **details}) + "\n")

    def check_sources(self):
        if not self.config.get("source_hashes"):
            raise RuntimeError("Campaign requires frozen source fingerprints from correctness-gated preparation")
        for name, expected in self.config.get("source_hashes", {}).items():
            path = ROOT / name
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise RuntimeError(f"Campaign source changed after correctness gates: {name}")

    def budget_reason(self, deadline):
        if self.stop_requested:
            return "termination_requested"
        if time.time() >= min(deadline, self.deadline):
            return "wall_time_limit"
        if directory_bytes(self.output) >= self.config["max_artifact_bytes"] - 200_000_000:
            return "storage_reserve_reached"
        return None

    def child(self, name, arguments, deadline, status_record):
        self.check_sources()
        reason = self.budget_reason(deadline)
        if reason:
            return {"returncode": None, "stop_reason": reason, "started": False}
        logs = self.output / "logs"
        logs.mkdir(exist_ok=True)
        process = subprocess.Popen(
            [str(ROOT / ".venv/bin/python"), "-m", *arguments], cwd=ROOT,
            env=self.env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1, start_new_session=True,
        )
        self.active = process
        status_record.update({"state": "running", "pid": process.pid, "started_at": utc_now(), "command": arguments})
        self.persist()
        self.event("child_started", name=name, pid=process.pid, command=arguments)

        def stream_log(stream, channel):
            with (logs / f"{name}.{channel}.jsonl").open("a", buffering=1) as file:
                for line in stream:
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        payload = line.rstrip("\n")
                    file.write(json.dumps({"at": utc_now(), "stream": channel, "payload": payload}, allow_nan=False) + "\n")
            stream.close()

        threads = [threading.Thread(target=stream_log, args=(stream, channel), daemon=True)
                   for stream, channel in [(process.stdout, "stdout"), (process.stderr, "stderr")]]
        for thread in threads:
            thread.start()
        stop_reason = None
        try:
            while process.poll() is None:
                reason = self.budget_reason(deadline)
                if reason:
                    stop_reason = reason
                    self.event("child_stopping", name=name, reason=reason)
                    # The trainer gets a chance to save/roll back a coherent boundary;
                    # do not kill its GameCore child before that handler can run.
                    process.terminate()
                    try:
                        process.wait(timeout=min(30, max(1, self.deadline - time.time())))
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGTERM)
                        try:
                            process.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            os.killpg(process.pid, signal.SIGKILL)
                            process.wait(timeout=3)
                    break
                self.persist()
                time.sleep(2)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=3)
            # A failed Python process must not leave an orphan Core competing with
            # the next training job. Its isolated process group contains only it.
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            for thread in threads:
                thread.join(timeout=5)
            self.active = None
        result = {"returncode": process.returncode, "stop_reason": stop_reason, "started": True, "finished_at": utc_now()}
        status_record.update(result)
        self.event("child_finished", name=name, **result)
        return result

    def report(self, final=False):
        # Reporting is lightweight compared with collection. It always runs from
        # persisted files, including when all scientific results are missing.
        self.persist()
        remaining = self.deadline - time.time()
        if remaining < 5:
            self.fallback_report("Global deadline leaves insufficient time for plotting")
            return
        record = {}
        result = self.child("report-final" if final else "report-progress", [
            "scripts.ai7.research", "--campaign", str(self.output),
        ], min(self.deadline - 1, time.time() + 120), record)
        if result["returncode"] != 0:
            self.fallback_report(f"Report generator did not finish: {result}")

    def fallback_report(self, reason):
        (self.output / "overnight-summary.md").write_text(
            "# AI-7 overnight campaign\n\nResults are incomplete. " + reason +
            "\nInspect run-status.json, per-run results and structured logs. No strength winner is established.\n" +
            "\n".join(f"- {run['id']}: training {run['training']['state']}, evaluation {run['evaluation']['state']}" for run in self.status["runs"]) + "\n")
        atomic_json(self.output / "comparison.json", {"incomplete": True, "reason": reason, "runs": self.status["runs"]})
        (self.output / "comparison.csv").write_text("architecture,seed,training_state,evaluation_state\n" + "".join(
            f"{run['architecture']},{run['seed']},{run['training']['state']},{run['evaluation']['state']}\n" for run in self.status["runs"]))

    def run(self):
        self.check_sources()
        self.status["state"] = "training"
        self.persist()
        self.event("supervisor_started", pid=os.getpid(), deadline_epoch=self.deadline)
        training_deadline = self.deadline - self.config["reserve_evaluation_seconds"] - self.config["reserve_report_seconds"]
        for run in self.status["runs"]:
            if run["training"]["state"] == "completed":
                continue
            run_root = self.output / "runs" / run["id"]
            eligible = self.config.get("eligible_architectures", list(ARCHITECTURES))
            if run["architecture"] not in eligible:
                run["training"] = {"state": "skipped", "reason": "architecture_failed_correctness_gate"}
                continue
            reason = self.budget_reason(training_deadline)
            if reason:
                run["training"] = {"state": "skipped", "reason": reason}
                continue
            arguments = [
                "scripts.ai7.train", "--output", str(run_root), "--architecture", run["architecture"],
                "--seed", str(run["seed"]), "--max-env-steps", str(self.config["target_env_steps"]),
                "--max-updates", "100000", "--training-seconds", str(self.config["per_run_training_seconds"]),
                "--batch-games", "16", "--threads", str(self.config["threads"]), "--device", "cpu",
                "--checkpoint-every-steps", str(self.config["milestone_steps"]), "--max-replays", "4",
                "--validation-seed-start", str(self.config["validation_seed_start"]), "--validation-pairs", "8",
                "--deadline-epoch", str(training_deadline),
            ]
            resume_path = run_root / "latest.pt"
            if run_root.exists():
                if not resume_path.exists():
                    run["training"] = {"state": "failed", "reason": "existing_run_without_exact_resume_checkpoint"}
                    continue
                arguments.extend(["--resume", str(resume_path)])
            result = self.child(run["id"] + "-training", arguments, training_deadline, run["training"])
            summary = read_json(run_root / "summary.json", {})
            reached = summary.get("env_steps", 0) == self.config["target_env_steps"]
            run["training"].update({"state": "completed" if result["returncode"] == 0 and reached else "partial" if summary.get("env_steps", 0) > 0 else "failed",
                                    "summary": str(run_root / "summary.json"), "env_steps": summary.get("env_steps", 0)})
            self.persist()
            self.report()
        self.status["state"] = "evaluation"
        self.persist()
        for run in self.status["runs"]:
            run_root = self.output / "runs" / run["id"]
            evaluation = self.output / "evaluations" / run["id"]
            if run["evaluation"]["state"] == "completed":
                continue
            if not (run_root / "initial.pt").exists() or not (run_root / "final.pt").exists():
                run["evaluation"] = {"state": "skipped", "reason": "missing_initial_or_final_checkpoint"}
                run["probes"] = {"state": "skipped", "reason": "missing_final_checkpoint"}
                continue
            if evaluation.exists():
                summary = read_json(evaluation / "summary.json", {})
                reports = summary.get("matchups", [])
                complete = len(reports) == 2 and all(report.get("completed") == self.config["evaluation_pairs"] * 2 for report in reports)
                run["evaluation"] = {"state": "completed" if complete else "partial", "reason": "existing_evaluation_retained_without_overwrite", "summary": str(evaluation / "summary.json")}
                continue
            result = self.child(run["id"] + "-evaluation", [
                "scripts.ai7.evaluate", "--checkpoints", str(run_root / "initial.pt"), str(run_root / "final.pt"),
                "--output", str(evaluation), "--pairs", str(self.config["evaluation_pairs"]),
                "--seed-start", str(self.config["eval_seed_start"]), "--opponents", "random", "--archive-count", "2",
                "--deadline-epoch", str(self.deadline - self.config["reserve_report_seconds"]),
            ], self.deadline - self.config["reserve_report_seconds"], run["evaluation"])
            summary = read_json(evaluation / "summary.json", {})
            reports = summary.get("matchups", [])
            complete = len(reports) == 2 and all(report.get("completed") == self.config["evaluation_pairs"] * 2 for report in reports)
            run["evaluation"].update({"state": "completed" if result["returncode"] == 0 and complete else "partial" if reports else "skipped" if not result["started"] else "failed", "summary": str(evaluation / "summary.json")})
            self.persist()
        self.status["state"] = "probes"
        self.persist()
        for run in self.status["runs"]:
            run_root = self.output / "runs" / run["id"]
            if not (run_root / "initial.pt").exists() or not (run_root / "final.pt").exists():
                run["probes"] = {"state": "skipped", "reason": "missing_initial_or_final_checkpoint"}
                continue
            probe_path = self.output / "probes" / f"{run['id']}.json"
            if probe_path.exists():
                probe = read_json(probe_path, {})
                complete = all(probe.get(label, {}).get("completed", 0) == probe.get(label, {}).get("planned", -1) for label in ("initial", "final"))
                run["probes"] = {"state": "completed" if complete else "partial", "path": str(probe_path), "retained": True}
            else:
                result = self.child(run["id"] + "-probes", [
                    "scripts.ai7.research", "--checkpoint", str(run_root / "final.pt"),
                    "--initial-checkpoint", str(run_root / "initial.pt"),
                    "--probe-output", str(probe_path), "--deadline-epoch", str(self.deadline - self.config["reserve_report_seconds"]),
                ], self.deadline - self.config["reserve_report_seconds"], run["probes"])
                probe = read_json(probe_path, {})
                complete = all(probe.get(label, {}).get("completed", 0) == probe.get(label, {}).get("planned", -1) for label in ("initial", "final"))
                run["probes"].update({"state": "completed" if result["returncode"] == 0 and complete else "partial" if probe else "skipped" if not result["started"] else "failed", "path": str(probe_path)})
            self.persist()
        for run in self.status["runs"]:
            for phase in ("training", "evaluation", "probes"):
                if run[phase]["state"] == "pending":
                    run[phase].update({"state": "skipped", "reason": "campaign_stopped_before_phase"})
        self.status["state"] = "completed" if all(run["training"]["state"] == run["evaluation"]["state"] == run["probes"]["state"] == "completed" for run in self.status["runs"]) else "partial"
        self.status["finished_at"] = utc_now()
        self.report(final=True)
        self.persist()
        self.event("supervisor_finished", state=self.status["state"], artifact_bytes=self.status["artifact_bytes"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    config_path = args.config.resolve()
    output = config_path.parent
    config = read_json(config_path)
    if config is None:
        raise ValueError("Missing campaign config")
    with (output / "supervisor.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        supervisor = Supervisor(output, config)
        def stop(_signum, _frame):
            supervisor.stop_requested = True
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        try:
            supervisor.run()
        except BaseException as error:
            supervisor.status.update({"state": "failed", "error": str(error), "traceback": traceback.format_exc(), "finished_at": utc_now()})
            supervisor.event("supervisor_failed", error=str(error), traceback=traceback.format_exc())
            supervisor.fallback_report(str(error))
            supervisor.persist()
            raise


if __name__ == "__main__":
    main()
