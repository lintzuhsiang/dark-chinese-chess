"""Correctness gates for the independent, larger outcome critic architecture."""
from __future__ import annotations

import copy
import json
import unittest

import torch

from scripts.ai7.critic import ImprovedCriticPolicy
from scripts.ai7.runtime import Policy


class ImprovedCriticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)

    def inputs(self):
        features = torch.randn(3, 2163)
        masks = torch.zeros(3, 1056, dtype=torch.bool)
        masks[0, [1, 12, 432]] = True
        masks[1, [3, 720]] = True
        masks[2, 1055] = True
        return features, masks

    def test_seeded_actor_matches_baseline_exactly(self):
        for seed in (11, 23, 37):
            torch.manual_seed(seed)
            baseline = Policy()
            torch.manual_seed(seed)
            improved = ImprovedCriticPolicy()
            for name in ("body", "actor"):
                initial = getattr(baseline, name).state_dict()
                actual = getattr(improved, name).state_dict()
                self.assertEqual(initial.keys(), actual.keys())
                self.assertTrue(all(torch.equal(value, actual[key]) for key, value in initial.items()))
            features, masks = self.inputs()
            with torch.no_grad():
                expected, _ = baseline(features, masks)
                distribution, _ = improved(features, masks)
            self.assertTrue(torch.equal(expected.probs, distribution.probs))

    def test_shapes_masks_finite_outputs_and_config_reload(self):
        model = ImprovedCriticPolicy()
        features, masks = self.inputs()
        distribution, values = model(features, masks)
        self.assertEqual(distribution.probs.shape, (3, 1056))
        self.assertEqual(values.shape, (3,))
        self.assertTrue(torch.isfinite(values).all())
        self.assertTrue(torch.isfinite(distribution.probs).all())
        self.assertTrue(torch.equal(distribution.probs[~masks], torch.zeros_like(distribution.probs[~masks])))
        for actions in distribution.sample((100,)):
            self.assertTrue(masks.gather(1, actions[:, None]).all())
        self.assertEqual(distribution.probs[2, 1055].item(), 1)
        config = json.loads(json.dumps(model.config))
        restored = ImprovedCriticPolicy(**config)
        restored.load_state_dict(copy.deepcopy(model.state_dict()))
        with torch.no_grad():
            exact_distribution, exact_values = restored(features, masks)
        self.assertTrue(torch.equal(distribution.probs, exact_distribution.probs))
        self.assertTrue(torch.equal(values, exact_values))

    def test_actor_and_critic_gradients_and_updates_are_independent(self):
        model = ImprovedCriticPolicy()
        actor_parameters = [*model.body.parameters(), *model.actor.parameters()]
        critic_parameters = list(model.critic.parameters())
        self.assertFalse({id(parameter) for parameter in actor_parameters} & {id(parameter) for parameter in critic_parameters})
        self.assertGreater(sum(parameter.numel() for parameter in critic_parameters), sum(parameter.numel() for parameter in actor_parameters))
        features, masks = self.inputs()
        actor_before = [parameter.detach().clone() for parameter in actor_parameters]
        critic_before = [parameter.detach().clone() for parameter in critic_parameters]
        optimizer = torch.optim.Adam(model.parameters(), lr=0.0003)
        distribution, _ = model(features, masks)
        (-distribution.log_prob(torch.tensor([1, 3, 1055])).mean()).backward()
        self.assertTrue(any(parameter.grad is not None and parameter.grad.abs().sum() > 0 for parameter in actor_parameters))
        self.assertTrue(all(parameter.grad is None for parameter in critic_parameters))
        optimizer.step()
        self.assertTrue(any(not torch.equal(before, after) for before, after in zip(actor_before, actor_parameters)))
        self.assertTrue(all(torch.equal(before, after) for before, after in zip(critic_before, critic_parameters)))

        optimizer.zero_grad(set_to_none=True)
        actor_before = [parameter.detach().clone() for parameter in actor_parameters]
        _, values = model(features, masks)
        (values - torch.tensor([-1., 0., 1.])).square().mean().backward()
        self.assertTrue(all(parameter.grad is None for parameter in actor_parameters))
        self.assertTrue(any(parameter.grad is not None and parameter.grad.abs().sum() > 0 for parameter in critic_parameters))
        optimizer.step()
        self.assertTrue(all(torch.equal(before, after) for before, after in zip(actor_before, actor_parameters)))
        self.assertTrue(any(not torch.equal(before, after) for before, after in zip(critic_before, critic_parameters)))

    def test_rejects_invalid_observation_or_mask_contract(self):
        model = ImprovedCriticPolicy()
        features, masks = self.inputs()
        masks[1] = False
        with self.assertRaises(ValueError):
            model(features, masks)
        with self.assertRaises(ValueError):
            model(features, masks.float())
        with self.assertRaises(ValueError):
            model(features[:, :-1], masks)
        with self.assertRaises(ValueError):
            ImprovedCriticPolicy(input_dim=2164)
        with self.assertRaises(ValueError):
            ImprovedCriticPolicy(critic_widths=[])


if __name__ == "__main__":
    unittest.main()
