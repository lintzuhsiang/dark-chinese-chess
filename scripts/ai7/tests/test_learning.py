"""Correctness gates, including a tiny end-to-end optimization/reload check."""
from __future__ import annotations

import copy
import time
from pathlib import Path
import unittest

import numpy as np
import torch

from scripts.ai7.runtime import (
    Bridge, Policy, ROOT, advantages, collect, encode, load_checkpoint,
    mask_array, save_checkpoint, seed_all,
)
from scripts.ai7.train import optimize, sample_opponent
from scripts.ai7.evaluate import paired_difference, paired_interval


class LearningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        seed_all(37)
        cls.output = ROOT / f"benchmark-results/ai7-selfplay/correctness-overnight-{time.time_ns()}"
        cls.output.mkdir(parents=True, exist_ok=True)
        cls.bridge = Bridge(cls.output / "replays")

    @classmethod
    def tearDownClass(cls):
        cls.bridge.close()

    def test_complete_games_update_and_exact_reload(self):
        model = Policy()
        specs = [{"seed": 400 + i, "seat": i % 2, "action_seed": 200 + i, "opponent": "random", "archive": f"correctness-{i}.json"} for i in range(4)]
        result = collect(self.bridge, model, specs, {}, training=True)
        self.assertEqual(result["incomplete"], 0)
        self.assertEqual(len(result["games"]), 4)
        for trajectory, game in zip(result["trajectories"], result["games"]):
            self.assertTrue(all(row["reward"] == 0 for row in trajectory[:-1]))
            self.assertEqual(trajectory[-1]["reward"], game["return"])
            expected = 0 if game["result"]["type"] == "DRAW" else 1 if game["result"]["winner"] == ("P1" if game["seat"] == 0 else "P2") else -1
            self.assertEqual(game["return"], expected)
            _, returns = advantages(trajectory)
            np.testing.assert_allclose(returns, expected, atol=1e-5)
            for row in trajectory:
                self.assertIn(row["action"], row["legal"])
        optimizer = torch.optim.Adam(model.parameters(), lr=0.0003)
        config = {"gamma": 1., "gae_lambda": 1., "epochs": 2, "minibatch": 128, "clip": .2, "value_coefficient": .5, "entropy_coefficient": .01, "max_grad_norm": .5, "target_kl": .03}
        metrics = optimize(model, optimizer, result["trajectories"], config)
        self.assertGreater(metrics["parameter_delta_l2"], 0)
        self.assertGreater(metrics["optimizer_steps"], 0)
        self.assertTrue(all(np.isfinite(value) for value in metrics.values() if isinstance(value, float)))
        path = self.output / "reload-test.pt"
        save_checkpoint(path, model, optimizer, config, 1, result["env_steps"], np.random.default_rng(19), ["initial"])
        reloaded, checkpoint = load_checkpoint(path)
        for key, value in model.state_dict().items():
            self.assertTrue(torch.equal(value, reloaded.state_dict()[key]))
        new_optimizer = torch.optim.Adam(reloaded.parameters(), lr=.0003)
        new_optimizer.load_state_dict(checkpoint["optimizer"])
        row = result["trajectories"][0][0]
        features = torch.from_numpy(row["features"]).unsqueeze(0)
        mask = torch.zeros((1, 1056), dtype=torch.bool)
        mask[0, row["legal"]] = True
        with torch.no_grad():
            a, av = model(features, mask)
            b, bv = reloaded(features, mask)
            self.assertTrue(torch.equal(a.probs, b.probs))
            self.assertTrue(torch.equal(av, bv))
        # Exact optimizer continuation on the same batch, including Adam moments.
        torch.manual_seed(99)
        optimize(model, optimizer, result["trajectories"], config)
        torch.manual_seed(99)
        optimize(reloaded, new_optimizer, result["trajectories"], config)
        for a, b in zip(model.parameters(), reloaded.parameters()):
            self.assertTrue(torch.equal(a, b))

    def test_mask_is_strict_and_empty_masks_rejected(self):
        observation = self.bridge.request(command="reset", games=[{"id": 0, "seed": 101}])[0]["observation"]
        features = torch.from_numpy(encode(observation)).unsqueeze(0)
        self.assertEqual(features.shape, (1, 2163))
        masks = torch.from_numpy(mask_array([observation]))
        model = Policy()
        distribution, _ = model(features, masks)
        self.assertTrue(torch.equal(distribution.probs[~masks], torch.zeros_like(distribution.probs[~masks])))
        self.assertTrue(all(action in observation["legal"] for action in distribution.sample((1000,)).flatten().tolist()))
        with self.assertRaises(ValueError):
            model(features, torch.zeros_like(masks))

    def test_advantages_do_not_alternate_sign_with_opponent_turns(self):
        for reward in [1, 0, -1]:
            trajectory = [{"reward": 0, "value": .25}, {"reward": 0, "value": -.4}, {"reward": reward, "value": .7}]
            advantage, returns = advantages(trajectory)
            np.testing.assert_allclose(returns, reward, atol=1e-6)
            np.testing.assert_allclose(advantage, np.asarray([reward - .25, reward + .4, reward - .7]), atol=1e-6)

    def test_evaluation_is_repeatable_and_has_no_training_samples(self):
        model = Policy()
        before = copy.deepcopy(model.state_dict())
        specs = [{"seed": 2_000_501, "seat": seat, "action_seed": 123, "opponent": "random"} for seat in [0, 1]]
        a = collect(self.bridge, model, specs, {})
        b = collect(self.bridge, model, specs, {})
        self.assertEqual(a["games"], b["games"])
        self.assertTrue(all(not rows for rows in a["trajectories"]))
        self.assertTrue(all(torch.equal(value, model.state_dict()[key]) for key, value in before.items()))
        interrupted = collect(self.bridge, model, specs, {}, training=True, deadline=0)
        self.assertEqual(interrupted["games"], [])
        self.assertEqual(interrupted["trajectories"], [])
        self.assertEqual(interrupted["incomplete"], 2)

    def test_paired_statistics_and_opponent_pool(self):
        self.assertEqual(paired_interval([.5] * 100)["score"], .5)
        comparison = paired_difference({i: 0 for i in range(100)}, {i: 1 for i in range(100)})
        self.assertEqual(comparison["difference"], 1)
        self.assertEqual(comparison["bootstrap95"], [1, 1])
        self.assertGreater(comparison["hoeffding95"][0], 0)
        rng = np.random.default_rng(11)
        choices = [sample_opponent(rng, 10, ["initial", "old", "recent1", "recent2", "recent3"]) for _ in range(10000)]
        self.assertEqual(set(choices), {"current", "random", "initial", "old", "recent1", "recent2", "recent3"})
        self.assertAlmostEqual(choices.count("current") / len(choices), .5, delta=.03)


if __name__ == "__main__":
    unittest.main()
