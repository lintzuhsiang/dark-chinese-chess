"""E2b policy contract, independent dense oracle, and production PPO continuation."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch
from torch.distributions import Categorical

from scripts.ai7.exp3_support import rotate_id
from scripts.ai7.runtime import (
    ARCHITECTURES, Bridge, ROOT, collect, encode, make_policy, mask_array,
    restore_training_checkpoint, save_checkpoint, seed_all,
)
from scripts.ai7.train import configuration, optimize, parse_args


ARMS = ("e2b_g", "e2b_l")


def dense_forward(model, features, mask):
    # Independent construction: FLIP targets in board order, then a 32x32
    # source-major Cartesian product for MOVEs, including every illegal slot.
    batch = len(features)
    board = features[:, :512].reshape(batch, 32, 16)
    source = board[:, :, None].expand(-1, -1, 32, -1).reshape(batch, 1024, 16)
    target = board[:, None, :].expand(-1, 32, -1, -1).reshape(batch, 1024, 16)
    flips = torch.cat((torch.zeros_like(board), board), dim=-1)
    local = torch.cat((flips, torch.cat((source, target), dim=-1)), dim=1)
    if model.config["architecture"] == "e2b_g":
        local = torch.zeros_like(local)
    hidden = model.body(features)
    inputs = torch.cat((hidden[:, None].expand(-1, 1056, -1),
                        model.actor.geometry.expand(batch, -1, -1), local), dim=-1)
    raw = model.actor.output(model.actor.input(inputs).tanh()).squeeze(-1)
    return raw.masked_fill(~mask, -torch.inf), model.critic(hidden).squeeze(-1)


def public_fixtures():
    script = """
        import { actionId, createEnvironment, createPublicMemory } from './scripts/ai7/environment.ts';
        import { rotateInput } from './scripts/ai7/symmetry.ts';
        import { getLegalActions, getObservation } from './packages/game-core/src/index.ts';
        import { supportOpening, chaseOpening, decodeActions } from './packages/game-core/tests/chase-v3-fixtures.ts';
        import { tacticalSnapshot } from './packages/game-core/tests/public-projection-fixtures.ts';
        const initial = supportOpening().state.board.map(square => square.piece);
        const a = createEnvironment(0, initial);
        const other = initial.map((piece, i) => ({...piece, id:'other'+i}));
        [other[5], other[25]] = [other[25], other[5]];
        const b = createEnvironment(0, other);
        for (const id of [0,1,2,3]) { a.step(id); b.step(id); }
        const chase = createEnvironment(0, initial);
        for (const act of decodeActions(chaseOpening+' 5>4 1>0 4>5 0>1 5>4 1>0 4>5'))
            chase.step(actionId(act));
        function cannon(screens) {
            const pieces = [[0,'RED','CANNON'],[12,'BLACK','GENERAL'],
                            ...screens.map(i => [i,'RED','SOLDIER'])];
            const f = tacticalSnapshot(pieces);
            const memory = createPublicMemory();
            for (const e of f.history) memory.accept(e);
            return memory.encode(getObservation(f.state), getLegalActions(f.state,f.state.currentPlayer));
        }
        const observations = [a.observe(),b.observe(),chase.observe(),cannon([]),cannon([4]),cannon([4,8])];
        console.log(JSON.stringify([observations,observations.map(rotateInput)]));
    """
    return json.loads(subprocess.check_output(
        ["node", "--import", "./scripts/ai-eval/register.mjs", "--input-type=module", "-e", script],
        cwd=ROOT, text=True))


class RelationalHeadTests(unittest.TestCase):
    def setUp(self):
        seed_all(700101)

    def test_all_action_endpoints_rotation_privacy_and_core_masks(self):
        obs, rotated = public_fixtures()
        self.assertEqual(obs[0], obs[1])
        self.assertNotIn(33, obs[2]["legal"])  # Chase-rejected 0 -> 1.
        self.assertEqual([44 in state["legal"] for state in obs[3:]], [False, True, False])
        x = torch.tensor(np.stack([encode(o) for o in obs]))
        xr = torch.tensor(np.stack([encode(o) for o in rotated]))
        ids = torch.arange(1056)
        rotated_ids = torch.tensor([rotate_id(i) for i in range(1056)])
        mask = torch.from_numpy(mask_array(obs))
        rotated_mask = torch.from_numpy(mask_array(rotated))
        self.assertTrue(torch.equal(mask, rotated_mask[:, rotated_ids]))
        for arm in ARMS:
            model = make_policy({"architecture": arm})
            with torch.no_grad():
                model.actor.input.weight[:, -32:].normal_()
                dist, values = model(x, mask)
                self.assertTrue(torch.equal(dist.probs > 0, mask))
                self.assertTrue(torch.equal(dist.probs[0], dist.probs[1]))
                self.assertEqual(values[0], values[1])
                for i, state in enumerate(obs):
                    rows = torch.full_like(ids, i)
                    local = model.actor.local_features(x, rows, ids)
                    self.assertTrue(torch.equal(local, model.actor.local_features(xr, rows, rotated_ids)))
                    expected = torch.zeros(1056, 32)
                    if arm == "e2b_l":
                        for action in range(1056):
                            if action >= 32:
                                expected[action, state["board"][(action-32)//32]] = 1
                            expected[action, 16+state["board"][action%32]] = 1
                    self.assertTrue(torch.equal(local, expected))
                for invalid in [mask.float(), mask[:, :-1], torch.zeros_like(mask)]:
                    with self.assertRaises(ValueError):
                        model(x, invalid)

    def test_initialized_pair_matches_and_shares_e0_trunk(self):
        def fresh(arm):
            seed_all(700101)
            return make_policy({"architecture": arm})
        g, l, e0 = map(fresh, (*ARMS, "baseline"))
        x = torch.randn(5, 2163)
        m = torch.rand(5, 1056) < .03
        for a,b in zip(g.parameters(), l.parameters()):
            self.assertTrue(torch.equal(a,b))
        for model in [g,l]:
            self.assertEqual(sum(p.numel() for p in model.parameters()), 315266)
            self.assertEqual(sum(p.numel() for p in model.actor.parameters()), 21633)
            self.assertEqual(model.actor.input.weight[:, -32:].count_nonzero(), 0)
            self.assertTrue(torch.equal(model.body(x), e0.body(x)))
            self.assertTrue(torch.equal(model(x,m)[1], e0(x,m)[1]))
        self.assertTrue(torch.equal(g.actor(g.body(x), x, m), l.actor(l.body(x), x, m)))
        self.assertTrue(torch.equal(g(x,m)[0].logits, l(x,m)[0].logits))

    def test_dense_packed_ppo_gradients_and_adam(self):
        obs, _ = public_fixtures()
        x = torch.tensor(np.stack([encode(o) for o in obs]))
        mask = torch.from_numpy(mask_array(obs))
        mask[0] = False
        mask[0, 2] = True
        mask[1] = True  # Stress the full action domain as well as singleton masks.
        advantage = torch.tensor([1., -.5, .2, -1.3, .8, -.6])
        for arm in ARMS:
            packed = make_policy({"architecture": arm})
            with torch.no_grad():
                packed.actor.input.weight[:, -32:].normal_(std=.08)
            dense = copy.deepcopy(packed)
            dist, v = packed(x, mask)
            raw = packed.actor(packed.body(x), x, mask)
            reference, ref_v = dense_forward(dense, x, mask)
            ref = Categorical(logits=reference)
            actions = dist.sample()
            old_logp = dist.log_prob(actions).detach() + torch.linspace(-.45,.45,len(x))
            for a,b in [(raw, reference), (v,ref_v), (dist.logits,ref.logits),
                        (dist.probs, ref.probs), (dist.entropy(),ref.entropy())]:
                torch.testing.assert_close(a,b,rtol=0,atol=1e-5)
            for model, d, value in [(dense, ref, ref_v), (packed, dist, v)]:
                ratio = (d.log_prob(actions) - old_logp).exp()
                surrogate = torch.minimum(ratio*advantage, ratio.clamp(.8,1.2)*advantage)
                loss = -surrogate.mean() + .5*(value-advantage).square().mean() - .01*d.entropy().mean()
                loss.backward()
                torch.optim.Adam(model.parameters(), lr=.0003, eps=1e-5).step()
            for (name,p),q in zip(packed.named_parameters(),dense.parameters()):
                torch.testing.assert_close(p.grad,q.grad,rtol=0,atol=1e-5,msg=name)
                torch.testing.assert_close(p,q,rtol=0,atol=1e-5,msg=name)

    def test_real_ppo_and_exact_checkpoint_continuation(self):
        for arm in ARMS:
            seed_all(700101)
            model = make_policy({"architecture": arm})
            root = ROOT / "benchmark-results/ai7-selfplay"
            root.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=root) as tmp, patch.dict("os.environ", {"AI7_ARTIFACT_ROOT": tmp}):
                args = ["--output", tmp, "--architecture", arm, "--learning-method", "gae_lambda_095"]
                config = configuration(parse_args(args))
                other = "e2b_l" if arm == "e2b_g" else "e2b_g"
                with self.assertRaisesRegex(ValueError, "architecture"):
                    configuration(parse_args(["--output", tmp, "--architecture", other]),config)
                opt = torch.optim.Adam(model.parameters(), lr=config["learning_rate"], eps=1e-5)
                bridge = Bridge(Path(tmp) / "fixtures")
                specs = [dict(seed=701101+i, seat=i%2, action_seed=540+i, opponent="random") for i in range(4)]
                try:
                    rollout = collect(bridge, model, specs, {}, training=True)
                finally:
                    bridge.close()
                traj = rollout["trajectories"]
                self.assertEqual(len(traj),4)
                for game, t in zip(rollout["games"],traj):
                    self.assertEqual(t[-1]["reward"],game["return"])
                    self.assertTrue(all(r["reward"] == 0 for r in t[:-1]))
                metrics = optimize(model,opt,traj,config)
                self.assertGreater(metrics["optimizer_steps"],0)
                local = model.actor.input.weight
                self.assertEqual(bool(local[:, -32:].any()),arm == "e2b_l")
                self.assertEqual(bool(local.grad[:, -32:].any()),arm == "e2b_l")
                path = Path(tmp)/"resume.pt"
                rng = np.random.default_rng(700101)
                state = {"env_steps": rollout["env_steps"]}
                save_checkpoint(path, model,opt,config,1,state["env_steps"],rng,
                                ["frozen"],{"frozen":model},state)
                expected_draw = rng.random()
                optimize(model,opt,traj,config)
                resumed,adam,rng,pool,opponents,restored,ckpt = restore_training_checkpoint(path)
                self.assertEqual(ckpt["architecture"],ARCHITECTURES[arm])
                self.assertEqual(rng.random(), expected_draw)
                self.assertEqual(restored,state)
                self.assertEqual(pool,["frozen"])
                self.assertEqual(opponents["frozen"].config,resumed.config)
                optimize(resumed,adam,traj,config)
                for a,b in zip(model.parameters(),resumed.parameters()):
                    self.assertTrue(torch.equal(a,b))
                for key,val in opt.state_dict()["state"].items():
                    for field,tensor in val.items():
                        self.assertTrue(torch.equal(tensor,adam.state_dict()["state"][key][field]))


if __name__ == "__main__":
    unittest.main()
