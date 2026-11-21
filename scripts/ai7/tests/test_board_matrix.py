"""Real public Core oracles and bounded numerical tests. No training launcher or study decks."""
import copy
import json
import random
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import torch
from torch.distributions import Categorical

from scripts.ai7.exp3_support import rotate_id
from scripts.ai7.runtime import (
    ARCHITECTURES, BOARD_ARMS, ROOT, encode, load_checkpoint, make_policy, mask_array,
    restore_training_checkpoint, save_checkpoint, seed_all,
)
from scripts.ai7.tests.test_relational_head import public_fixtures
from scripts.ai7.train import configuration, optimize, parse_args


def fresh(arm):
    seed_all(2718)
    return make_policy({"architecture": arm})


def tensors(observations):
    return (torch.from_numpy(np.stack([encode(o) for o in observations])),
            torch.from_numpy(mask_array(observations)))


def dense_reference(model, x, mask):
    # Materialize the full 32x32 Cartesian product independently of the packed indexing.
    batch = len(x)
    device = x.device
    board = x[:, :512].reshape(batch, 32, 16)
    source = board[:, :, None].expand(-1, -1, 32, -1).reshape(batch, 1024, 16)
    target = board[:, None, :].expand(-1, 32, -1, -1).reshape(batch, 1024, 16)
    candidates = board[:, None].expand(-1, 1024, -1, -1).clone()
    if BOARD_ARMS[model.config["architecture"]][1] == "after":
        actions = torch.arange(1024, device=device)
        candidates[:, actions, actions // 32] = 0
        candidates[:, actions, actions // 32, 0] = 1
        candidates[:, actions, actions % 32] = source
    projected = model.actor.board_projection.linear(candidates.flatten(2)).tanh()
    zero = x.new_zeros(batch, 32, 32)
    hidden = model.body(x)
    parts = (hidden[:, None].expand(-1, 1056, -1), model.actor.geometry.expand(batch, -1, -1),
             torch.cat((torch.zeros_like(board), source), dim=1), torch.cat((board, target), dim=1),
             torch.cat((zero, projected), dim=1))
    raw = model.actor.output(model.actor.input(torch.cat(parts, dim=2)).tanh()).squeeze(-1)
    return Categorical(logits=raw.masked_fill(~mask, -torch.inf)), model.critic(hidden).squeeze(-1)


class BoardMatrixTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads(subprocess.check_output(
            ["node", "--import", "./scripts/ai-eval/register.mjs", "scripts/ai7/tests/board-oracle.ts"],
            text=True, cwd=ROOT))
        cls.public, _ = public_fixtures()

    def test_public_core_projection_and_rotation_every_coordinate(self):
        self.assertIn(44, [m["id"] for m in self.cases[0]["moves"]])  # screened Cannon 0 -> 12
        self.assertIn(495, [m["id"] for m in self.cases[2]["moves"]])  # Chariot 14 -> 15
        for original, rotated in zip(self.cases[::2], self.cases[1::2]):
            mapped = {m["id"]: m["board"] for m in rotated["moves"]}
            self.assertEqual(mapped, {rotate_id(m["id"]): m["board"][::-1] for m in original["moves"]})
        obs = [c["observation"] for c in self.cases] + self.public[:1]
        x, mask = tensors(obs)
        before = x.clone()
        rows, ids = mask.nonzero(as_tuple=True)
        for arm in ["e2b-mlp-preboard", "e2b-mlp-afterboard"]:
            head = fresh(arm).actor
            branch = head.board_projection
            expected = []
            for row, action in zip(rows.tolist(), ids.tolist()):
                if action < 32:
                    expected.append(torch.zeros(512))
                    continue
                if row < len(self.cases):
                    post = next(m["board"] for m in self.cases[row]["moves"] if m["id"] == action)
                else:
                    post = list(obs[row]["board"])
                    src, dst = divmod(action - 32, 32)
                    post[src], post[dst] = 0, post[src]
                board = post if branch.timing == "after" else obs[row]["board"]
                expected.append(torch.eye(16)[board].flatten())
            # Read all 512 output board indicators via 16 disjoint identity projections.
            with torch.no_grad():
                branch.linear.bias.zero_()
                outputs = []
                for start in range(0, 512, 32):
                    branch.linear.weight.copy_(torch.eye(512)[start:start+32])
                    outputs.append(branch(x, rows, ids, head.source[ids], head.target[ids]))
            torch.testing.assert_close(torch.cat(outputs, dim=1), torch.stack(expected).tanh(), rtol=0, atol=0)
            self.assertTrue(torch.equal(x, before))

    def test_matched_initialization_contract_privacy(self):
        self.assertEqual(self.public[0], self.public[1])  # private permutation and private IDs differ
        self.assertNotIn(33, self.public[2]["legal"])  # Chase v4 rejection
        x, mask = tensors(self.public)
        legacy = fresh("e2b_l")
        shared = fresh("e2b-mlp-preboard")
        for arm, (encoder, _) in BOARD_ARMS.items():
            model = fresh(arm)
            for key, tensor in shared.actor.state_dict().items():
                self.assertTrue(torch.equal(tensor, model.actor.state_dict()[key]), key)
            self.assertTrue(torch.equal(legacy.actor.input.weight, model.actor.input.weight[:, :167]))
            self.assertEqual(model.actor.input.weight[:, 167:].count_nonzero(), 0)
            dist, v = model(x, mask)
            paired = fresh(f"e2b-{encoder}-preboard")
            reference, reference_value = paired(x, mask)
            self.assertTrue(torch.equal(dist.logits, reference.logits))
            self.assertTrue(torch.equal(v, reference_value))
            self.assertEqual(dist.probs.shape, (len(x), 1056))
            self.assertEqual(v.shape, (len(x),))
            self.assertTrue(torch.isfinite(v).all())
            self.assertTrue(torch.isfinite(dist.logits[mask]).all())
            self.assertTrue(torch.equal(dist.probs > 0, mask))
            if encoder == "mlp":
                self.assertTrue(torch.equal(model.body(x), legacy.body(x)))
                torch.testing.assert_close(dist.probs, legacy(x, mask)[0].probs, atol=1e-7, rtol=0)
            # Activate the new inputs before testing privacy (initial residual is zero).
            with torch.no_grad():
                model.actor.input.weight[:, 135:].normal_(std=.1)
                d, v = model(x, mask)
            for tensor in (x, d.logits, d.probs, v):
                self.assertTrue(torch.equal(tensor[0], tensor[1]))
            for invalid in [mask.float(), mask[:, :-1], torch.zeros_like(mask)]:
                with self.assertRaises(ValueError):
                    model(x, invalid)
            with self.assertRaises(ValueError):
                make_policy({"architecture": arm, "width": 64})

    def test_dense_packed_logit_and_parameter_gradients(self):
        x, mask = tensors([self.cases[0]["observation"], self.public[0], self.public[2]])
        for arm in BOARD_ARMS:
            model = fresh(arm)
            with torch.no_grad():
                model.actor.input.weight[:, 135:].normal_(std=.1)
            reference = copy.deepcopy(model)
            d, v = model(x, mask)
            ref, rv = dense_reference(reference, x, mask)
            for left, right in [(d.logits, ref.logits), (d.probs, ref.probs), (v, rv)]:
                torch.testing.assert_close(left, right, rtol=0, atol=1e-6)
            actions = mask.long().argmax(dim=1)
            for dist, value in [(d, v), (ref, rv)]:
                (-dist.log_prob(actions).mean() + value.square().mean() - .01*dist.entropy().mean()).backward()
            for (name, p), q in zip(model.named_parameters(), reference.parameters()):
                self.assertTrue(torch.isfinite(p.grad).all(), name)
                torch.testing.assert_close(p.grad, q.grad, rtol=0, atol=1e-6, msg=name)
            self.assertGreater(model.actor.board_projection.linear.weight.grad.abs().sum(), 0)
            if BOARD_ARMS[arm][0] == "cnn":
                self.assertGreater(model.body.board_encoder[0].weight.grad.abs().sum(), 0)

    def test_roundtrip_resume_and_replay(self):
        x, mask = tensors([c["observation"] for c in self.cases])
        def step(model, optimizer, rng, config):
            # One synthetic terminal decision per fixture feeds the production PPO optimizer.
            with torch.no_grad():
                d, v = model(x, mask)
                actions = d.sample()
                logp = d.log_prob(actions)
            trajectories = [[{"features": x[i].numpy(), "legal": mask[i].nonzero().flatten().tolist(),
                              "action": int(actions[i]), "logp": float(logp[i]), "value": float(v[i]),
                              "reward": reward}] for i, reward in enumerate([1., -1., 0., 1.])]
            metrics = optimize(model, optimizer, trajectories, config)
            self.assertGreater(metrics["optimizer_steps"], 0)
            return actions, (random.random(), np.random.random(), rng.random())

        for arm in BOARD_ARMS:
            model = fresh(arm)
            with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"AI7_ARTIFACT_ROOT": tmp}):
                args = ["--output", tmp, "--architecture", arm, "--learning-method", "gae_lambda_095"]
                config = configuration(parse_args(args))
                with self.assertRaisesRegex(ValueError, "architecture"):
                    configuration(parse_args(["--output", tmp, "--architecture", "e2b_l"]), config)
                adam = torch.optim.Adam(model.parameters(), lr=config["learning_rate"], eps=1e-5)
                rng = np.random.default_rng(2718)
                step(model, adam, rng, config)
                path = Path(tmp) / "resume.pt"
                save_checkpoint(path, model, adam, config, 1, 0, rng, ["old"], {"old": model}, {"updates": 1})
                restored, meta = load_checkpoint(path)
                self.assertEqual(meta["architecture"], ARCHITECTURES[arm])
                self.assertTrue(torch.equal(model(x, mask)[0].probs, restored(x, mask)[0].probs))
                a, randoms = step(model, adam, rng, config)
                resumed, optimizer, stream, pool, opponents, state, _ = restore_training_checkpoint(path)
                self.assertEqual((pool, state), (["old"], {"updates": 1}))
                self.assertEqual(opponents["old"].config, model.config)
                b, restored_randoms = step(resumed, optimizer, stream, config)
                self.assertTrue(torch.equal(a, b))
                self.assertEqual(randoms, restored_randoms)
                for p, q in zip(model.parameters(), resumed.parameters()):
                    self.assertTrue(torch.equal(p, q))
                    for key, tensor in adam.state[p].items():
                        self.assertTrue(torch.equal(tensor, optimizer.state[q][key]))
                meta["architecture"] = ARCHITECTURES["e2b_l"]
                torch.save(meta, path)
                with self.assertRaisesRegex(ValueError, "architecture mismatch"):
                    load_checkpoint(path)
