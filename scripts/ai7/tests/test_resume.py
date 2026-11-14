"""Exact complete-boundary resume, including real Core collection and PPO."""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import unittest

import numpy as np
import torch

from scripts.ai7.runtime import ROOT, load_checkpoint


class ResumeTests(unittest.TestCase):
    def assert_nested_equal(self, a, b):
        if isinstance(a, torch.Tensor):
            self.assertTrue(torch.equal(a, b))
        elif isinstance(a, np.ndarray):
            np.testing.assert_array_equal(a, b)
        elif isinstance(a, dict):
            self.assertEqual(set(a), set(b))
            for key in a:
                self.assert_nested_equal(a[key], b[key])
        elif isinstance(a, (tuple, list)):
            self.assertEqual(len(a), len(b))
            for aa, bb in zip(a, b):
                self.assert_nested_equal(aa, bb)
        else:
            self.assertEqual(a, b)

    def check_uninterrupted_and_cli_resume(self, architecture):
        root = ROOT / f"benchmark-results/ai7-selfplay/correctness-resume-{architecture}-{time.time_ns()}"
        root.mkdir(parents=True)
        environment = dict(os.environ, PYTHONPYCACHEPREFIX="/tmp/ai7-pycache", AI7_ARTIFACT_ROOT=str(root))
        common = ["--architecture", architecture, "--seed", "11", "--max-env-steps", "6000", "--max-updates", "100", "--checkpoint-every-steps", "2000", "--batch-games", "4", "--threads", "1", "--validation-pairs", "0", "--max-replays", "0"]
        def run(name, extra):
            output = root / name
            with (root / f"{name}-{len(list(root.glob(name + '-*.log')))}.log").open("w") as logfile:
                result = subprocess.run([sys.executable, "-m", "scripts.ai7.train", "--output", str(output), *common, *extra], cwd=ROOT, env=environment, stdout=logfile, stderr=subprocess.STDOUT, timeout=90)
            self.assertEqual(result.returncode, 0)
            return output
        full = run("full", [])
        resumed = run("resumed", ["--stop-after-updates", "2"])
        self.assertEqual(json.loads((resumed / "summary.json").read_text())["stop_reason"], "requested_boundary_stop")
        run("resumed", ["--resume", str(resumed / "latest.pt")])
        _, a = load_checkpoint(full / "final.pt")
        _, b = load_checkpoint(resumed / "final.pt")
        for key in ["model", "optimizer", "torch_rng", "numpy_rng", "python_rng", "sampling_rng", "opponent_pool", "opponent_models", "update", "env_steps"]:
            self.assert_nested_equal(a[key], b[key])
        for key in ["updates", "rollouts", "env_steps", "attempted_games", "completed_games", "incomplete_games", "next_milestone", "last_resume_steps", "replay_count", "optimizer_steps"]:
            self.assertEqual(a["training_state"][key], b["training_state"][key])
        self.assertEqual((full / "training-games.jsonl").read_text(), (resumed / "training-games.jsonl").read_text())
        self.assertEqual(a["env_steps"], 6000)
        self.assertLessEqual(len(list(full.glob("*.pt"))), 6)

    def test_all_architectures_uninterrupted_and_cli_resume_are_exact(self):
        for architecture in ["baseline", "critic", "cnn"]:
            with self.subTest(architecture=architecture):
                self.check_uninterrupted_and_cli_resume(architecture)

    def test_sigterm_rolls_back_to_an_exact_resumable_boundary(self):
        root = ROOT / f"benchmark-results/ai7-selfplay/correctness-signal-{time.time_ns()}"
        root.mkdir(parents=True)
        output = root / "interrupted"
        environment = dict(os.environ, PYTHONPYCACHEPREFIX="/tmp/ai7-pycache", AI7_ARTIFACT_ROOT=str(root))
        command = [sys.executable, "-m", "scripts.ai7.train", "--output", str(output), "--architecture", "baseline", "--seed", "11", "--max-env-steps", "50000", "--checkpoint-every-steps", "2000", "--batch-games", "4", "--threads", "1", "--validation-pairs", "0", "--max-replays", "0"]
        with (root / "signal.log").open("w") as logfile:
            process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=logfile, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 15
            while not (output / "status.json").exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue((output / "status.json").exists())
            time.sleep(.05)
            process.send_signal(signal.SIGTERM)
            self.assertEqual(process.wait(timeout=30), 0)
        summary = json.loads((output / "summary.json").read_text())
        self.assertEqual(summary["stop_reason"], "signal")
        self.assertEqual(summary["status"], "partial")
        self.assertTrue(summary["checkpoint_exact_reload"])
        _, checkpoint = load_checkpoint(output / "latest.pt")
        self.assertEqual(checkpoint["env_steps"], summary["env_steps"])
        self.assertEqual(checkpoint["training_state"]["env_steps"], summary["env_steps"])
        # Resume from a shorter, still future target. The initial longer bound
        # affects no training decisions because public milestones remain 2000.
        command[command.index("--max-env-steps") + 1] = "6000"
        with (root / "resume.log").open("w") as logfile:
            result = subprocess.run([*command, "--resume", str(output / "latest.pt")], cwd=ROOT, env=environment, stdout=logfile, stderr=subprocess.STDOUT, timeout=90)
        self.assertEqual(result.returncode, 0)
        resumed_summary = json.loads((output / "summary.json").read_text())
        self.assertEqual(resumed_summary["env_steps"], 6000)
        self.assertEqual(resumed_summary["status"], "completed")


if __name__ == "__main__":
    unittest.main()
