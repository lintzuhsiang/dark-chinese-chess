"""Campaign 4A adapter around the unchanged PPO trainer.

Extra value optimizer state is a separate entry inside the checkpoint optimizer
envelope; PPO's own state/parameter groups and update code are unchanged.
Extra passes use fixed rollout order and consume no policy/training RNG draws.
"""
import argparse
import copy
import sys
import time

import numpy as np
import torch

from scripts.ai7 import train as base
from scripts.ai7.runtime import advantages

TREATMENTS = {"A0": (.95, False), "A1": (.95, True), "A2": (.80, False), "A3": (.80, True)}


def extra_passes(model, optimizer, features, targets, stop_requested=None):
    flags = {name: p.requires_grad for name, p in model.named_parameters()}
    started = time.perf_counter()
    losses, norms = [], []
    try:
        for name, parameter in model.named_parameters():
            parameter.requires_grad_(name.startswith("critic."))
        # Trunk stays fixed for both passes: detached features cannot backpropagate.
        with torch.no_grad():
            hidden = torch.cat([model.body(batch) for batch in features.split(256)]).detach()
        for _ in range(2):
            for offset in range(0, len(targets), 256):
                if stop_requested and stop_requested():
                    return {"interrupted": True}
                predicted = model.critic(hidden[offset:offset+256]).squeeze(-1)
                mse = (predicted - targets[offset:offset+256]).square().mean()
                loss = .5 * mse
                if not torch.isfinite(loss):
                    raise RuntimeError("Nonfinite extra value loss")
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                norm = torch.nn.utils.clip_grad_norm_(model.critic.parameters(), .5)
                if not torch.isfinite(norm):
                    raise RuntimeError("Nonfinite extra value gradient")
                optimizer.step()
                losses.append(mse.item())
                norms.append(norm.item())
    finally:
        for name, parameter in model.named_parameters():
            parameter.requires_grad_(flags[name])
    return {"extra_critic_steps": len(losses), "extra_critic_seconds": time.perf_counter()-started,
            "extra_critic_mse": float(np.mean(losses)), "extra_critic_gradient_norm": float(np.mean(norms)),
            "extra_critic_passes": 2, "interrupted": False}


def install(treatment):
    lam, enabled = TREATMENTS[treatment]
    original_configuration = base.configuration
    original_optimize = base.optimize
    original_save = base.save_checkpoint
    original_restore = base.restore_training_checkpoint
    value_optimizer = None

    def get_optimizer(model):
        nonlocal value_optimizer
        if enabled and value_optimizer is None:
            value_optimizer = torch.optim.Adam(model.critic.parameters(), lr=3e-4, eps=1e-5)
        return value_optimizer

    def configuration(args, previous=None):
        if previous and previous.get("campaign4a_treatment") != treatment:
            raise ValueError("Exact resume cannot change Campaign 4A treatment")
        config = original_configuration(args, previous)
        if config["learning_method"] != "gae_lambda_095" or config["chain_alpha"] or config["architecture"] != "baseline":
            raise ValueError("Campaign 4A requires unchanged GAE baseline MLP")
        if (config['draw_penalty'] or config['rotation'] or config['curriculum_rate']
                or config['audit_records'] != 'off' or config.get('restart_treatment') is not None
                or config['opponent_mixture'] != 'standard' or config['learning_rate'] != 3e-4
                or getattr(args, 'gae_lambda', None) is not None):
            raise ValueError("Campaign 4A forbids additional treatments")
        config.update(gae_lambda=lam, campaign4a_treatment=treatment, extra_critic=enabled,
                      extra_critic_passes=2 if enabled else 0,
                      extra_critic_optimizer={"name":"Adam", "lr":3e-4, "eps":1e-5, "betas":[.9,.999],
                                              "minibatch":256, "value_coefficient":.5, "max_grad_norm":.5,
                                              "order":"fixed rollout order; no extra RNG consumption"})
        return config

    def optimize(model, optimizer, trajectories, config, device="cpu", deadline=float("inf"), stop_requested=None, diagnostics=None):
        rows = [row for trajectory in trajectories for row in trajectory]
        calculated = [advantages(t, config["gamma"], config["gae_lambda"]) for t in trajectories]
        raw = np.concatenate([pair[0] for pair in calculated])
        frozen_targets = torch.from_numpy(np.concatenate([pair[1] for pair in calculated])).to(device).detach()
        # Targets are fixed BEFORE the standard PPO optimization.
        features = torch.from_numpy(np.stack([r["features"] for r in rows])).to(device) if enabled else None
        values = np.array([r['value'] for r in rows])
        terminal = np.array([t[-1]['reward'] for t in trajectories for _ in t])
        extra = get_optimizer(model)
        boundary = copy.deepcopy(extra.state_dict()) if enabled else None
        result = original_optimize(model, optimizer, trajectories, config, device, deadline, stop_requested, diagnostics)
        result.update(advantage_mean=float(raw.mean()), advantage_variance=float(raw.var()),
                      advantage_quantiles=np.quantile(raw,[0,.05,.25,.5,.75,.95,1]).tolist(),
                      sampled_terminal_return_mse=float(np.mean((values-terminal)**2)),
                      terminal_return_target_qualification="policy-dependent sampled returns; not common-state ground truth",
                      extra_critic_steps=0, extra_critic_seconds=0.)
        if enabled and not result['interrupted']:
            extra_result = extra_passes(model, extra, features, frozen_targets,
                                       lambda: time.perf_counter() >= deadline or bool(stop_requested and stop_requested()))
            if extra_result['interrupted']:
                extra.load_state_dict(boundary)
                result['interrupted'] = True  # base trainer restores model/PPO/RNG boundary
            else:
                result.update(extra_result)
                result['optimization_seconds'] += extra_result['extra_critic_seconds']
        return result

    def save(path, model, optimizer, config, update, steps, rng, pool, opponents=None, training_state=None):
        if not enabled:
            return original_save(path, model, optimizer, config, update, steps, rng, pool, opponents, training_state)
        extra = get_optimizer(model)
        class Envelope:
            def state_dict(self):
                return {**optimizer.state_dict(), "extra_value_optimizer": extra.state_dict()}
        original_save(path, model, Envelope(), config, update, steps, rng, pool, opponents, training_state)

    def restore(path, device="cpu"):
        restored = original_restore(path, device)
        if enabled:
            state = restored[-1]["optimizer"].get("extra_value_optimizer")
            if state is None:
                raise ValueError("Missing extra value-head optimizer state")
            get_optimizer(restored[0]).load_state_dict(state)
        return restored

    base.configuration, base.optimize = configuration, optimize
    base.save_checkpoint, base.restore_training_checkpoint = save, restore


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--treatment', choices=TREATMENTS, required=True)
    args, remaining = parser.parse_known_args()
    install(args.treatment)
    base.main(remaining)


if __name__ == '__main__':
    main()
