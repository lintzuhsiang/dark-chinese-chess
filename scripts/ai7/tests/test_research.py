from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import torch
from torch.distributions import Categorical

from scripts.ai7.evaluate import evaluate_checkpoint
from scripts.ai7.research import aggregate_rows, build_report, comparison_rows, probe_policy, seed_statistics


class UniformMaskedPolicy(torch.nn.Module):
    def forward(self, features, masks):
        logits = torch.zeros((len(features), 1056)).masked_fill(~masks, -torch.inf)
        return Categorical(logits=logits), torch.zeros(len(features))


class ResearchTests(unittest.TestCase):
    def test_training_seeds_are_replication_units(self):
        summary = seed_statistics([.02, .04, .06])
        self.assertEqual(summary["replications"], 3)
        self.assertAlmostEqual(summary["mean"], .04)
        self.assertLess(summary["t95"][0], 0)
        self.assertEqual(summary["hoeffding95"], [-1, 1])
        unbounded = seed_statistics([-200, -100, 0], None, None)
        self.assertIsNone(unbounded["hoeffding95"])
        self.assertIsNotNone(unbounded["t95"])

    def test_partial_evaluation_is_excluded_from_cross_seed_comparison(self):
        config = {"architectures": ["baseline", "critic", "cnn"], "seeds": [11, 23, 37], "target_env_steps": 4000, "evaluation_pairs": 128}
        rows = []
        for architecture in config["architectures"]:
            for seed in config["seeds"]:
                rows.append({"architecture": architecture, "training_seed": seed, "training_steps": 4000, "initial_completed": 256, "final_completed": 256 if seed != 37 else 128, "initial_paired_score": .5, "final_paired_score": .55, "score_improvement": .05, "improvement_ci_low": -.01, "final_explained_variance": -.2, "no_progress_rate": .7})
        aggregates, matched = aggregate_rows(rows, config)
        self.assertEqual(aggregates["baseline"]["improvement"]["replications"], 2)
        self.assertEqual(aggregates["cnn"]["training_seeds"], [11, 23])
        self.assertEqual(matched["critic_minus_baseline"]["final_score"]["replications"], 2)

    def test_report_retains_all_nine_pending_or_failed_rows(self):
        with tempfile.TemporaryDirectory() as temporary:
            campaign = Path(temporary)
            jobs = [{"id": f"{architecture}-seed-{seed}", "architecture": architecture, "seed": seed} for architecture in ["baseline", "critic", "cnn"] for seed in [11, 23, 37]]
            config = {"jobs": jobs, "architectures": ["baseline", "critic", "cnn"], "seeds": [11, 23, 37], "target_env_steps": 4000, "evaluation_pairs": 128}
            (campaign / "config.json").write_text(json.dumps(config))
            (campaign / "run-status.json").write_text(json.dumps({"phase": "training", "runs": [{"id": jobs[0]["id"], "training": {"state": "failed"}}]}))
            run = campaign / "runs" / jobs[0]["id"]
            run.mkdir(parents=True)
            (run / "metrics.jsonl").write_text('{"env_steps":100,"normalized_entropy":0.9}\n{"unfinished":')
            result = build_report(campaign)
            self.assertEqual(len(result["rows"]), 9)
            self.assertEqual(result["rows"][0]["training_state"], "failed")
            self.assertEqual(result["rows"][0]["training_steps"], 100)
            self.assertIsNone(result["rows"][0]["training_steps_per_second"])
            for name in ["comparison.csv", "comparison.json", "overnight-summary.md", "learning-curves.png"]:
                self.assertTrue((campaign / name).is_file())
            self.assertIn("0/9", (campaign / "overnight-summary.md").read_text())

    def test_probe_inference_does_not_receive_diagnostic_labels(self):
        observation = {"board": [1] * 32, "references": [0] * 32, "hiddenInventory": [1, 2, 2, 2, 2, 2, 5] * 2, "remainingInventory": [1, 2, 2, 2, 2, 2, 5] * 2, "history": [], "player": 0, "color": 0, "quiet": 0, "ply": 0, "legal": list(range(32))}
        suite = {"probes": [{"id": "test", "category": "test", "observation": observation, "groups": {"good": [0], "not_applicable": []}, "immediateLossRisk": {str(action): .5 if action == 0 else 0 for action in range(32)}, "interpretation": "test"}]}
        result = probe_policy(UniformMaskedPolicy(), suite)
        self.assertEqual(result["completed"], 1)
        self.assertAlmostEqual(result["summary"]["good"]["mean_mass"], 1 / 32)
        self.assertIsNone(result["summary"]["not_applicable"]["mean_mass"])
        self.assertAlmostEqual(result["positions"][0]["expected_immediate_loss_risk"], .5 / 32)

    def test_expired_evaluation_reports_skipped_without_fake_draws(self):
        result = evaluate_checkpoint(None, None, "test", [3000000, 3000001], "random", deadline=0)
        self.assertEqual(result["planned"], 4)
        self.assertEqual(result["attempted"], 0)
        self.assertEqual(result["completed"], 0)
        self.assertEqual(result["skipped"], 4)
        self.assertEqual(result["draws"], 0)


if __name__ == "__main__":
    unittest.main()
