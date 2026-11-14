"""Supervisor safety checks without starting any campaign training."""
from __future__ import annotations

import copy
from pathlib import Path
import tempfile
import unittest

from scripts.ai7.campaign import CAMPAIGN_BASE, Supervisor, atomic_json, directory_bytes, read_json, validate_config
from scripts.ai7.launch_campaign import launch_spec
from scripts.ai7.prepare_campaign import choose_budget


def config_fixture():
    return {
        "architectures": ["baseline", "critic", "cnn"], "seeds": [11, 23, 37],
        "jobs": [{"id": f"{architecture}-seed-{seed}", "architecture": architecture, "seed": seed}
                 for seed in [11, 23, 37] for architecture in ["baseline", "critic", "cnn"]],
        "max_wall_seconds": 25200, "max_artifact_bytes": 5_000_000_000,
        "target_env_steps": 4_000_000, "threads": 2, "batch_games": 16,
        "evaluation_pairs": 128, "eval_seed_start": 3_000_000,
        "reserve_evaluation_seconds": 3600, "reserve_report_seconds": 180,
    }


class CampaignTests(unittest.TestCase):
    def test_feasibility_reduces_one_common_budget_before_training(self):
        fast = {name: {"training_wall_seconds": 10, "env_steps": 32768} for name in ["baseline", "critic", "cnn"]}
        self.assertEqual(choose_budget(fast)["target_env_steps"], 4_000_000)
        slow = {name: {"training_wall_seconds": 40, "env_steps": 32768} for name in fast}
        selected = choose_budget(slow)
        self.assertTrue(selected["target_reduced_equally_before_campaign"])
        self.assertLess(selected["target_env_steps"], 4_000_000)
        self.assertLessEqual(selected["estimated_total_seconds_with_reserves"], 25200)

    def test_complete_matrix_and_budget_are_mandatory(self):
        config = config_fixture()
        validate_config(config, CAMPAIGN_BASE / "test")
        for key, value in [("max_wall_seconds", 25201), ("max_artifact_bytes", 5_000_000_001), ("threads", 3), ("target_env_steps", 4_000_001), ("evaluation_pairs", 127)]:
            invalid = copy.deepcopy(config)
            invalid[key] = value
            with self.assertRaises(ValueError):
                validate_config(invalid, CAMPAIGN_BASE / "test")
        invalid = copy.deepcopy(config)
        invalid["jobs"][-1] = invalid["jobs"][0]
        with self.assertRaises(ValueError):
            validate_config(invalid, CAMPAIGN_BASE / "test")
        with self.assertRaises(ValueError):
            validate_config(config, Path("/tmp/outside-campaign"))

    def test_atomic_status_and_storage_accounting(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "status.json"
            atomic_json(path, {"state": "training", "seed": 11})
            self.assertEqual(read_json(path)["seed"], 11)
            atomic_json(path, {"state": "completed"})
            self.assertEqual(read_json(path), {"state": "completed"})
            self.assertFalse(path.with_name("status.json.writing").exists())
            self.assertEqual(directory_bytes(Path(folder)), path.stat().st_size)

    def test_launchd_job_is_detached_sequential_and_single_use(self):
        spec = launch_spec(CAMPAIGN_BASE / "test/config.json", "local.banqi.ai7.test")
        self.assertFalse(spec["KeepAlive"])
        self.assertTrue(spec["RunAtLoad"])
        self.assertEqual(spec["Nice"], 10)
        self.assertEqual(spec["ProgramArguments"][:2], ["/usr/bin/caffeinate", "-i"])
        self.assertIn("scripts.ai7.guard_campaign", spec["ProgramArguments"])
        self.assertEqual(spec["EnvironmentVariables"]["OMP_NUM_THREADS"], "2")


if __name__ == "__main__":
    unittest.main()
