"""E2a-G action contract and exact continuation tests."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import torch

from scripts.ai7.geometry_head import action_geometry
from scripts.ai7.runtime import (
    Bridge, ROOT, collect, make_policy, restore_training_checkpoint, save_checkpoint, seed_all,
)
from scripts.ai7.train import configuration, optimize, parse_args


class GeometryHeadTests(unittest.TestCase):
    def setUp(self):
        seed_all(91001, 2)

    def test_all_geometry_rows_match_typescript_action_contract(self):
        script = """
            import { ACTION_COUNT, decodeAction, actionId } from './scripts/ai7/environment.ts';
            const actions = Array.from({length:ACTION_COUNT}, (_, id) => {
                const action = decodeAction(id);
                if (actionId(action) !== id) throw Error('action ID roundtrip');
                return action;
            });
            process.stdout.write(JSON.stringify(actions));
        """
        actions = json.loads(subprocess.check_output(
            ["node", "--import", "./scripts/ai-eval/register.mjs", "--input-type=module", "-e", script],
            cwd=ROOT, text=True,
        ))
        expected = []
        for action in actions:
            if action["type"] == "FLIP":
                row, column = divmod(action["position"], 4)
                expected.append([0, -1, -1, row / 7, column / 3, 0, 0])
            else:
                row, column = divmod(action["from"], 4)
                end_row, end_column = divmod(action["to"], 4)
                expected.append([1, row / 7, column / 3, end_row / 7, end_column / 3,
                                 (end_row - row) / 7, (end_column - column) / 3])
        self.assertEqual(sum(action["type"] == "FLIP" for action in actions), 32)
        self.assertEqual(sum(action["type"] == "MOVE" for action in actions), 1024)
        torch.testing.assert_close(action_geometry(), torch.tensor(expected), rtol=0, atol=0)
        self.assertEqual(len(torch.unique(action_geometry(), dim=0)), 1056)

    def test_temperature_mask_and_original_value(self):
        baseline = make_policy()
        seed_all(91001, 2)
        model = make_policy({"architecture": "e2a_g"})
        features = torch.randn(3, 2163)
        masks = torch.zeros(3, 1056, dtype=torch.bool)
        masks[0, [0, 31, 106]] = True
        masks[1, [73, 1055]] = True
        masks[2, 17] = True
        dist, value = model(features, masks)
        _, original_value = baseline(features, masks)
        torch.testing.assert_close(value,original_value,rtol=0,atol=0)
        self.assertTrue(torch.equal(model.body(features),baseline.body(features)))
        hidden = model.body(features)
        generated = model.actor.generator(model.actor.geometry)
        reference = (hidden @ generated[:,:-1].T + generated[:,-1]).masked_fill(~masks,-torch.inf)
        torch.testing.assert_close(dist.probs, reference.softmax(-1))
        repeated_hidden = hidden.repeat(32, 1)
        torch.testing.assert_close(
            model.actor(repeated_hidden), (hidden @ generated[:,:-1].T + generated[:,-1]).repeat(32, 1),
        )
        self.assertTrue(torch.isfinite(dist.probs).all())
        self.assertTrue((dist.probs[~masks] == 0).all())
        torch.testing.assert_close(dist.probs.sum(-1), torch.ones(3))
        self.assertTrue(masks.gather(1, dist.sample((64,)).T).all())
        for bad in (torch.zeros_like(masks), masks.float(), masks[:, :-1]):
            with self.assertRaises((RuntimeError, TypeError, ValueError)):
                model(features,bad)

    def test_distinct_actions_use_same_generator_parameters(self):
        actor = make_policy({"architecture": "e2a_g"}).actor
        hidden = torch.randn(1,128)
        # Moves 0→1 and 4→5 differ in position and have identical displacement.
        ids = (33, 165)
        self.assertTrue(torch.equal(actor.geometry[ids[0],-2:],actor.geometry[ids[1],-2:]))
        gradients = [torch.autograd.grad(actor(hidden)[0,id], tuple(actor.parameters())) for id in ids]
        for left,right in zip(*gradients):
            self.assertTrue(torch.isfinite(left).all() and torch.isfinite(right).all())
            self.assertTrue(((left != 0) & (right != 0)).any())
        self.assertNotIn("geometry", actor.state_dict())

    def test_real_collection_ppo_and_checkpoint_resume(self):
        model = make_policy({"architecture": "e2a_g"})
        config = configuration(parse_args([
            "--output", "/tmp/unused-e2a-config", "--architecture", "e2a_g",
            "--seed", "91001", "--learning-method", "gae_lambda_095",
        ]))
        optimizer = torch.optim.Adam(model.parameters(),lr=config["learning_rate"],eps=1e-5)
        specs = [{"seed":i+701_100,"seat":i%2,"action_seed":i+220,"opponent":"random"} for i in range(4)]
        with tempfile.TemporaryDirectory() as temporary:
            bridge = Bridge(ROOT / "benchmark-results/ai7-selfplay/e2a-g-test-no-replays")
            try:
                partial = collect(bridge, model, specs, {}, training=True, max_env_steps=3)
                full = collect(bridge, model, specs, {}, training=True)
            finally:
                bridge.close()
            self.assertEqual(partial["env_steps"], 3)
            self.assertEqual(partial["incomplete"], 4)
            self.assertEqual(partial["trajectories"], [])
            self.assertEqual(len(full["trajectories"]), 4)
            for game,trajectory in zip(full["games"],full["trajectories"]):
                self.assertEqual(trajectory[-1]["reward"],game["return"])
                self.assertTrue(all(r["reward"]==0 and r["action"] in r["legal"] for r in trajectory[:-1]))
                self.assertIn(trajectory[-1]["action"],trajectory[-1]["legal"])
            before = {name: p.detach().clone() for name,p in model.actor.named_parameters()}
            first = optimize(model,optimizer,full["trajectories"],config)
            self.assertEqual(first["learner_samples"],sum(map(len,full["trajectories"])))
            self.assertGreater(first["optimizer_steps"],0)
            for name,parameter in model.actor.named_parameters():
                self.assertFalse(torch.equal(parameter,before[name]),name)
                self.assertTrue(torch.isfinite(parameter.grad).all(),name)
            rng = np.random.default_rng(91001)
            path = Path(temporary)/"resume.pt"
            with patch.dict("os.environ", {"AI7_ARTIFACT_ROOT": temporary}):
                save_checkpoint(
                    path, model, optimizer, config, 1, full["env_steps"], rng, [],
                    training_state={"steps": full["env_steps"]},
                )
            optimize(model,optimizer,full["trajectories"],config)
            resumed,adam,_,_,_,_,_ = restore_training_checkpoint(path)
            optimize(resumed,adam,full["trajectories"],config)
            for key,value in model.state_dict().items():
                torch.testing.assert_close(value,resumed.state_dict()[key],atol=0,rtol=0)
            for key,state in optimizer.state_dict()["state"].items():
                for field,value in state.items():
                    torch.testing.assert_close(value,adam.state_dict()["state"][key][field],atol=0,rtol=0)


if __name__ == "__main__":
    unittest.main()
