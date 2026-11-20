"""Restart boundary, public transport, sampling and checkpoint correctness gates."""
from __future__ import annotations

import copy
import os
import sys
import hashlib
import json
import subprocess
import time
import types
import unittest

import numpy as np
import torch
from torch.distributions import Categorical

from scripts.ai7.runtime import (Bridge, Policy, ROOT, advantages, collect,
    restore_training_checkpoint, save_checkpoint, seed_all)
from scripts.ai7.restart_sampling import RestartSampler, fingerprint, value_error_priorities
from scripts.ai7.tests import test_resume
from scripts.ai7.train import optimize


def catalog_fixture():
    return [{"id": str(i), "stage": "endgame" if i % 2 else "middle",
        "endgameEligible": bool(i % 2), "hidden": 0, "publicSha256": str(i) * 64} for i in range(4)]


class SamplingTests(unittest.TestCase):
    def test_uniform_endgame_and_disabled_sampling(self):
        catalog = catalog_fixture()
        for treatment in ["B0", "B1", "B2"]:
            sampler = RestartSampler(catalog, "archive", treatment, 11)
            rng_before = copy.deepcopy(sampler.rng.bit_generator.state)
            draws = [sampler.sample() for _ in range(20000)]
            if treatment == "B0":
                self.assertEqual(draws, [{}] * len(draws))
                self.assertEqual(sampler.rng.bit_generator.state, rng_before)
            else:
                self.assertAlmostEqual(sampler.restart_starts / len(draws), .3, delta=.015)
                eligible = 2 if treatment == "B2" else 4
                self.assertEqual(len(sampler.frequencies), eligible)
                for count in sampler.frequencies.values():
                    self.assertAlmostEqual(count / sampler.restart_starts, 1 / eligible, delta=.025)
                if treatment == "B2":
                    self.assertEqual(set(sampler.frequencies), {"1", "3"})
            self.assertEqual(sampler.normal_starts + sampler.restart_starts, len(draws))

    def test_priority_replication_perspective_noise_and_clipped_uniform_mixing(self):
        catalog = catalog_fixture()
        evidence = {"archive_sha256": "archive", "training_only": True,
            "perspective": "snapshot_acting_player", "predictor_sha256": "a" * 64,
            "continuation_protocol_sha256": "b" * 64, "equivalence_verification_sha256": "c" * 64,
            "records": {record["id"]: {"prediction": 3 if i == 0 else 0,
                "outcomes": [{"action_seed": j, "layout_sha256": "same-layout",
                    "public_sha256": record["publicSha256"], "return": 0} for j in range(8)]}
                for i, record in enumerate(catalog)}}
        table = value_error_priorities(catalog, evidence, "archive")
        self.assertEqual(table["scores"], {"0": 2, "1": 0, "2": 0, "3": 0})
        sampler = RestartSampler(catalog, "archive", "B3", 11, table)
        np.testing.assert_allclose(sampler.probabilities, [.85, .05, .05, .05])
        for _ in range(20000):
            sampler.sample()
        self.assertAlmostEqual(sampler.frequencies["0"] / sampler.restart_starts, .85, delta=.02)
        for changed in [dict(evidence, training_only=False), dict(evidence, perspective="terminal_next_player")]:
            with self.assertRaises(ValueError):
                value_error_priorities(catalog, changed, "archive")
        hidden = copy.deepcopy(catalog)
        hidden[0]["hidden"] = 1
        with self.assertRaisesRegex(ValueError, "hidden layout"):
            value_error_priorities(hidden, evidence, "archive")
        single = copy.deepcopy(evidence)
        single["records"]["0"]["outcomes"] = single["records"]["0"]["outcomes"][:1]
        with self.assertRaisesRegex(ValueError, "eight"):
            value_error_priorities(catalog, single, "archive")
        zeros = dict(table, scores={record["id"]: 0 for record in catalog})
        np.testing.assert_allclose(RestartSampler(catalog, "archive", "B3", 11, zeros).probabilities, [.25] * 4)
        with self.assertRaises(ValueError):
            RestartSampler(catalog, "archive", "B3", 11)

    def test_exact_sampler_resume_and_configuration_binding(self):
        catalog = catalog_fixture()
        for treatment in ["B0", "B1", "B2", "B3"]:
            table = {"archive_sha256": "archive", "scores": {str(i): i / 2 for i in range(4)},
                "uniform_mixture": .2, "clip": [0, 2], "exponent": 1} if treatment == "B3" else None
            a = RestartSampler(catalog, "archive", treatment, 123, table)
            for _ in range(101):
                a.sample()
            state = a.state_dict()
            b = RestartSampler(catalog, "archive", treatment, 123, table)
            b.load_state_dict(state)
            self.assertEqual([a.sample() for _ in range(1000)], [b.sample() for _ in range(1000)])
            self.assertEqual(a.frequencies, b.frequencies)
            self.assertEqual(a.rng.bit_generator.state, b.rng.bit_generator.state)
            with self.assertRaises(ValueError):
                RestartSampler(catalog, "different", treatment, 123, table).load_state_dict(state)


class RestartCollectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        seed_all(93)
        cls.output = ROOT / f"benchmark-results/ai7-selfplay/correctness-restart-{time.time_ns()}"
        cls.output.mkdir(parents=True)
        # Actual seeded Core source game, stopped one move before a terminal WIN.
        # This is a correctness fixture, never an archive-selection policy.
        source = r'''
import {writeFileSync} from 'node:fs';
import {createEnvironment} from './scripts/ai7/environment.ts';
import {describeSnapshot, snapshotEnvironment, sha256} from './scripts/ai7/restart.ts';
import {createSeededRandom} from './packages/ai-agents/src/seeded-random.ts';
import {CORE_REVISION} from './scripts/ai-eval/baseline.ts';
let found = false;
for (let seed = 800000; seed < 800200 && !found; seed++) {
 const env = createEnvironment(seed), rng = createSeededRandom(seed + 99);
 while (!env.summary().result) {
  const o=env.observe(); env.step(o.legal[Math.floor(rng()*o.legal.length)]);
 }
 if (env.summary().result.type !== 'WIN') continue;
 const actions=env.archive().actions, before=createEnvironment(seed);
 let endgame = null;
 for (const entry of actions.slice(0,-1)) {
  const a=entry.action; before.step(a.type === 'FLIP' ? a.position : 32+a.from*32+a.to);
  if (!endgame && describeSnapshot(snapshotEnvironment(before)).endgameEligible) endgame=snapshotEnvironment(before);
 }
 const snapshot=snapshotEnvironment(before), descriptor=describeSnapshot(snapshot);
 if (descriptor.quiet>50 || descriptor.ply<16) continue;
 const archive={version:1,coreRevision:CORE_REVISION,observationVersion:'public-v1',
  records:[{descriptor,snapshot,source:{game:0,seed,ply:descriptor.ply}}]};
 if (!endgame) continue;
 const eg=describeSnapshot(endgame);
 writeFileSync(process.argv[1]+'/endgame-archive.json',JSON.stringify({...archive,records:[{descriptor:eg,snapshot:endgame,source:{game:0,seed,ply:eg.ply}}]}));
 const text=JSON.stringify(archive), a=actions.at(-1).action;
 writeFileSync(process.argv[1]+'/archive.json',text);
 console.log(JSON.stringify({sha256:sha256(text),descriptor,seed,
  terminalAction:a.type==='FLIP'?a.position:32+a.from*32+a.to,player:snapshot.observation.player}));
 found=true;
}
if (!found) throw new Error('No legal terminal-boundary fixture');
'''
        completed = subprocess.run(["node", "--import", "./scripts/ai-eval/register.mjs", "--input-type=module", "-e", source, str(cls.output)],
            cwd=ROOT, text=True, capture_output=True, check=True, timeout=60)
        cls.fixture = json.loads(completed.stdout)
        cls.bridge = Bridge(cls.output / "replays")
        cls.catalog = cls.bridge.request(command="load-restarts", path=str(cls.output / "archive.json"), sha256=cls.fixture["sha256"])

    @classmethod
    def tearDownClass(cls):
        cls.bridge.close()

    def test_opponent_can_end_before_first_learner_decision_without_fake_samples(self):
        fixture = self.fixture
        class TerminalPolicy:
            def __call__(self, features, masks):
                logits = torch.full_like(masks, -float("inf"), dtype=torch.float32)
                logits[:, fixture["terminalAction"]] = 0
                return Categorical(logits=logits), torch.zeros(len(features))
        spec = {"seed": 1, "seat": 1 - fixture["player"], "action_seed": 3, "opponent": "terminal",
            "restartId": fixture["descriptor"]["id"]}
        result = collect(self.bridge, Policy(), [spec], {"terminal": TerminalPolicy()}, training=True)
        self.assertEqual(result["env_steps"], 1)
        self.assertEqual(result["zero_decision_games"], 1)
        self.assertEqual(result["trajectories"], [])
        self.assertEqual(result["games"][0]["return"], -1)
        self.assertEqual(result["games"][0]["continuation_plies"], 1)
        self.assertEqual(result["incomplete"], 0)
        mixed = collect(self.bridge, TerminalPolicy(), [spec, dict(spec, seat=fixture["player"])],
            {"terminal": TerminalPolicy()}, training=True)
        self.assertEqual(mixed["trajectory_game_ids"], [1])
        self.assertEqual([game["return"] for game in mixed["games"]], [-1, 1])
        self.assertEqual(len(mixed["trajectories"]), 1)
        self.assertEqual(mixed["trajectories"][0][-1]["reward"], 1)

    def test_public_transport_current_policy_continuations_and_reward_ownership(self):
        self.assertEqual(self.catalog, [self.fixture["descriptor"]])
        for forbidden in ["initialDeck", "snapshot", "source", "chase", "finalState"]:
            self.assertNotIn(forbidden, json.dumps(self.catalog))
        model = Policy()
        specs = [{"seed": 7, "seat": self.fixture["player"], "action_seed": 81 + i,
            "opponent": "random", "restartId": self.catalog[0]["id"], "archive": f"restart-{i}.json"} for i in range(4)]
        result = collect(self.bridge, model, specs, {}, training=True)
        self.assertEqual(result["incomplete"], 0)
        self.assertEqual(len(result["trajectories"]), 4)
        archived = json.loads((self.output / "replays/restart-0.json").read_text())
        self.assertEqual(archived["metadata"]["deckSeed"], self.fixture["seed"])
        self.assertEqual(archived["metadata"]["restart"], {"id": self.catalog[0]["id"], "ply": self.catalog[0]["ply"]})
        for trajectory, game in zip(result["trajectories"], result["games"]):
            self.assertEqual(trajectory[0]["ply"], self.catalog[0]["ply"])
            self.assertEqual(trajectory[-1]["reward"], game["return"])
            self.assertTrue(all(row["reward"] == 0 for row in trajectory[:-1]))
            for row in trajectory:
                mask = torch.zeros((1, 1056), dtype=torch.bool)
                mask[0, row["legal"]] = True
                with torch.no_grad():
                    distribution, values = model(torch.from_numpy(row["features"]).unsqueeze(0), mask)
                self.assertAlmostEqual(row["logp"], distribution.log_prob(torch.tensor(row["action"])).item(), places=5)
                self.assertAlmostEqual(row["value"], values.item(), places=5)
        with self.assertRaisesRegex(ValueError, "training-only"):
            collect(self.bridge, model, specs, {})
        with self.assertRaises(RuntimeError):
            self.bridge.request(command="load-restarts", path=str(self.output / "archive.json"), sha256="wrong")

    def test_disabled_restart_matches_original_collector(self):
        old_source = subprocess.check_output(["git", "show", "HEAD:scripts/ai7/runtime.py"], cwd=ROOT, text=True)
        original = types.ModuleType("scripts.ai7._original_runtime")
        original.__file__ = str(ROOT / "scripts/ai7/runtime.py")
        exec(compile(old_source, original.__file__, "exec"), original.__dict__)
        model = Policy()
        specs = [{"seed": 100 + i, "seat": i % 2, "action_seed": 800 + i, "opponent": "random"} for i in range(2)]
        a = original.collect(self.bridge, model, specs, {}, training=True)
        b = collect(self.bridge, model, specs, {}, training=True)
        check = test_resume.ResumeTests()
        for key in ["games", "trajectories", "env_steps", "incomplete", "attempted", "inference_decisions"]:
            check.assert_nested_equal(a[key], b[key])

    def test_sampler_and_optimizer_checkpoint_resume_are_exact(self):
        seed_all(81)
        model = Policy()
        optimizer = torch.optim.Adam(model.parameters(), lr=.0003, eps=1e-5)
        config = {"gamma": 1., "gae_lambda": 1., "epochs": 1, "minibatch": 256, "clip": .2,
            "value_coefficient": .5, "entropy_coefficient": .01, "max_grad_norm": .5,
            "target_kl": .03, "learning_rate": .0003}
        sampler = RestartSampler(self.catalog, self.fixture["sha256"], "B1", 87)
        rng = np.random.default_rng(123)
        state = {"restart_sampler": sampler.state_dict()}
        checkpoint = self.output / "sampler-resume.pt"
        save_checkpoint(checkpoint, model, optimizer, config, 0, 0, rng, [], {}, state)
        def advance(policy, adam, stream, restart):
            specs = [{"seed": int(stream.integers(0, 900000)), "seat": int(stream.integers(0, 2)),
                "action_seed": int(stream.integers(0, 2**32)), "opponent": "random", **restart.sample()} for _ in range(8)]
            rollout = collect(self.bridge, policy, specs, {}, training=True)
            optimize(policy, adam, rollout["trajectories"], config)
            return rollout
        a = advance(model, optimizer, rng, sampler)
        resumed, adam, stream, _, _, saved, _ = restore_training_checkpoint(checkpoint)
        other = RestartSampler(self.catalog, self.fixture["sha256"], "B1", 87)
        other.load_state_dict(saved["restart_sampler"])
        b = advance(resumed, adam, stream, other)
        check = test_resume.ResumeTests()
        for key in ["games", "trajectories", "env_steps"]:
            check.assert_nested_equal(a[key], b[key])
        check.assert_nested_equal(model.state_dict(), resumed.state_dict())
        check.assert_nested_equal(optimizer.state_dict(), adam.state_dict())
        self.assertEqual(sampler.frequencies, other.frequencies)
        self.assertEqual(sampler.rng.bit_generator.state, other.rng.bit_generator.state)
        self.assertEqual(fingerprint(saved["restart_sampler"]), fingerprint(state["restart_sampler"]))

    def test_gae095_cli_resume_all_valid_treatments(self):
        from scripts.ai7.runtime import load_checkpoint
        archive = self.output / "endgame-archive.json"
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        check = test_resume.ResumeTests()
        for label, treatment, extra in [("B0","B0",[]),("B1","B1",[]),("B2","B2",[]),("L90","B0",["--gae-lambda",".9"]),("L85","B0",["--gae-lambda",".85"]),("R50","B2",["--restart-probability",".5"]),("R70","B2",["--restart-probability",".7"])]:
            common = ["--learning-method", "gae_lambda_095", "--until-step-target", "--restart-treatment", treatment,
                "--restart-archive", str(archive), "--restart-archive-sha256", digest,
                "--seed", "87019", "--max-env-steps", "6000", "--checkpoint-every-steps", "2000",
                "--batch-games", "4", "--threads", "1", "--validation-pairs", "0", "--max-replays", "0", *extra]
            def run(name, extra):
                dest = self.output / (label + name)
                env = dict(os.environ, AI7_ARTIFACT_ROOT=str(self.output))
                with (self.output / f"{treatment}-{name}-{time.time_ns()}.log").open("w") as log:
                    result = subprocess.run([sys.executable, "-m", "scripts.ai7.train", "--output", str(dest), *common, *extra],
                        cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=90)
                self.assertEqual(result.returncode, 0, str(dest))
                return dest
            full = run("full", [])
            split = run("split", ["--stop-after-updates", "2"])
            run("split", ["--resume", str(split / "latest.pt")])
            a = load_checkpoint(full / "final.pt")[1]
            b = load_checkpoint(split / "final.pt")[1]
            self.assertEqual(a["env_steps"], 6000)
            self.assertEqual(a["config"]["gae_lambda"], float(extra[1]) if label.startswith("L") else .95)
            for key in ["model", "optimizer", "sampling_rng", "torch_rng", "opponent_models", "opponent_pool"]:
                check.assert_nested_equal(a[key], b[key])
            sa = a["training_state"]["restart_sampler"]
            sb = b["training_state"]["restart_sampler"]
            for key in ["rng", "identity", "normal_starts", "restart_starts", "frequencies", "stages"]:
                check.assert_nested_equal(sa[key], sb[key])
            self.assertEqual((full / "training-games.jsonl").read_bytes(), (split / "training-games.jsonl").read_bytes())

    def test_advantages_stop_at_each_new_continuation(self):
        first = [{"reward": 0., "value": .2}, {"reward": 1., "value": .4}]
        second = [{"reward": -1., "value": -.3}]
        a, targets = advantages(first, 1., .95)
        np.testing.assert_allclose(a, [.77, .6], atol=1e-6)
        np.testing.assert_allclose(targets, [.97, 1.], atol=1e-6)
        b, targets = advantages(second, 1., .95)
        np.testing.assert_allclose(b, [-.7], atol=1e-6)
        np.testing.assert_allclose(targets, [-1.], atol=1e-6)


if __name__ == "__main__":
    unittest.main()
