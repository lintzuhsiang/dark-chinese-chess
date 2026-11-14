"""Architecture correctness gates; no tactical examples or strategy targets."""
from __future__ import annotations

import copy
import unittest

import torch

from scripts.ai7.cnn import BoardCNNPolicy, split_public_features


class BoardCNNTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)

    def setUp(self):
        torch.manual_seed(23)

    def test_layout_preserves_every_input_and_square_coordinate(self):
        features = torch.arange(2 * 2163, dtype=torch.float32).reshape(2, 2163)
        board, public = split_public_features(features)
        self.assertEqual(tuple(board.shape), (2, 49, 8, 4))
        self.assertEqual(tuple(public.shape), (2, 595))
        for square in range(32):
            row, column = divmod(square, 4)
            self.assertTrue(torch.equal(board[:, :16, row, column], features[:, square * 16:(square + 1) * 16]))
            self.assertTrue(torch.equal(board[:, 16:, row, column], features[:, 512 + square * 33:512 + (square + 1) * 33]))
        reconstructed = torch.cat([
            board[:, :16].reshape(2, 16, 32).transpose(1, 2).reshape(2, 512),
            board[:, 16:].reshape(2, 33, 32).transpose(1, 2).reshape(2, 1056),
            public,
        ], dim=1)
        self.assertTrue(torch.equal(features, reconstructed))

    def test_output_shapes_mask_and_single_action(self):
        model = BoardCNNPolicy()
        features = torch.randn(3, 2163)
        mask = torch.zeros((3, 1056), dtype=torch.bool)
        mask[0, [0, 17, 1055]] = True
        mask[1, [1, 32, 500]] = True
        mask[2, 1024] = True
        distribution, values = model(features, mask)
        self.assertEqual(tuple(distribution.probs.shape), (3, 1056))
        self.assertEqual(tuple(values.shape), (3,))
        self.assertTrue(torch.isfinite(values).all())
        self.assertTrue(torch.isfinite(distribution.logits[mask]).all())
        self.assertTrue(torch.isneginf(distribution.logits[~mask]).all())
        self.assertTrue((distribution.probs[~mask] == 0).all())
        self.assertEqual(distribution.probs[2, 1024].item(), 1)
        sampled = distribution.sample((1000,))
        self.assertTrue(mask.gather(1, sampled.T).all())

    def test_rejects_empty_and_malformed_inputs(self):
        model = BoardCNNPolicy()
        features = torch.zeros((2, 2163))
        for mask in [torch.zeros((2, 1056), dtype=torch.bool), torch.ones((2, 32), dtype=torch.bool), torch.ones((2, 1056))]:
            with self.assertRaises(ValueError):
                model(features, mask)
        mask = torch.ones((2, 1056), dtype=torch.bool)
        with self.assertRaises(ValueError):
            model(torch.zeros((2, 2162)), mask)
        for config in [{"input_dim": 2162}, {"width": 0}, {"board_channels": 0}, {"architecture": "baseline"}]:
            with self.assertRaises(ValueError):
                BoardCNNPolicy(**config)

    def test_all_public_blocks_and_both_heads_receive_gradients(self):
        model = BoardCNNPolicy()
        optimizer = torch.optim.Adam(model.parameters(), lr=.0003)
        features = torch.randn((4, 2163), requires_grad=True)
        mask = torch.zeros((4, 1056), dtype=torch.bool)
        mask[:, [0, 32, 500, 1055]] = True
        old = copy.deepcopy(model.state_dict())
        distribution, values = model(features, mask)
        # Arbitrary numerical targets only test differentiation, not game strategy.
        loss = -distribution.log_prob(torch.tensor([0, 32, 500, 1055])).mean() + values.square().mean()
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        self.assertTrue(torch.isfinite(features.grad).all())
        for start, end in [(0, 512), (512, 1568), (1568, 1596), (1596, 1603), (1603, 2163)]:
            self.assertGreater(features.grad[:, start:end].abs().sum().item(), 0)
        for name, parameter in model.named_parameters():
            self.assertIsNotNone(parameter.grad, name)
            self.assertTrue(torch.isfinite(parameter.grad).all(), name)
            self.assertGreater(parameter.grad.abs().sum().item(), 0, name)
        optimizer.step()
        for key in ["board_encoder.0.weight", "public_encoder.0.weight", "actor.weight", "critic.weight"]:
            self.assertFalse(torch.equal(old[key], model.state_dict()[key]), key)

    def test_config_reconstructs_exact_outputs_and_is_seeded(self):
        model = BoardCNNPolicy()
        torch.manual_seed(23)
        same_seed = BoardCNNPolicy()
        self.assertTrue(all(torch.equal(a, b) for a, b in zip(model.parameters(), same_seed.parameters())))
        restored = BoardCNNPolicy(**model.config)
        restored.load_state_dict(model.state_dict())
        features = torch.randn((2, 2163))
        mask = torch.ones((2, 1056), dtype=torch.bool)
        with torch.no_grad():
            a, av = model(features, mask)
            b, bv = restored(features, mask)
        self.assertTrue(torch.equal(a.probs, b.probs))
        self.assertTrue(torch.equal(av, bv))


if __name__ == "__main__":
    unittest.main()
