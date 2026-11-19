"""Minimal on-policy masked PPO; run with python -m scripts.ai7.train."""
from __future__ import annotations

import argparse
import copy
import json
import os
import signal
from pathlib import Path
import time

import numpy as np
import torch

from .runtime import (
    Bridge, ROOT, advantages, collect, guard_artifacts, load_checkpoint, make_policy,
    provenance, save_checkpoint, seed_all, summarize, write_json, capture_rng, restore_rng,
    restore_training_checkpoint,
)


def optimize(model, optimizer, trajectories, config, device="cpu", deadline=float("inf"), stop_requested=None, diagnostics=None):
    rows = [row for trajectory in trajectories for row in trajectory]
    estimated = [advantages(trajectory, config["gamma"], config["gae_lambda"]) for trajectory in trajectories]
    advantage = np.concatenate([pair[0] for pair in estimated])
    returns = np.concatenate([pair[1] for pair in estimated])
    if diagnostics is not None:
        from .instrumentation import advantage_diagnostics
        diagnostics.record['advantages'] = advantage_diagnostics(trajectories, advantage.copy())
    outcome_tensor = torch.tensor([t[-1]['reward'] for t in trajectories for _ in t], device=device) if diagnostics is not None else None
    predicted = np.asarray([row["value"] for row in rows])
    explained_variance = float(1 - np.var(returns - predicted) / np.var(returns)) if np.var(returns) > 1e-8 else None
    features = torch.from_numpy(np.stack([row["features"] for row in rows])).to(device)
    masks = np.zeros((len(rows), 1056), dtype=np.bool_)
    for i, row in enumerate(rows):
        masks[i, row["legal"]] = True
    masks = torch.from_numpy(masks).to(device)
    actions = torch.tensor([row["action"] for row in rows], device=device)
    old_logp = torch.tensor([row["logp"] for row in rows], device=device)
    returns_tensor = torch.from_numpy(returns).to(device)
    normalized_advantage = (advantage - advantage.mean()) / (advantage.std() + 1e-8)
    if diagnostics is not None and config.get('audit_records') == 'full':
        diagnostics.record['decisions'] = []
        row_id = 0
        for game_index, trajectory in enumerate(trajectories):
            for decision, row in enumerate(trajectory):
                diagnostics.record['decisions'].append({'row': row_id, 'game_index': game_index,
                    'decision': decision, 'ply': row.get('ply'), 'quiet': row.get('quiet'),
                    'hidden': row.get('hidden'), 'legal_count': len(row['legal']),
                    'legal': row['legal'], 'old_legal_probabilities': row.get('old_legal_probabilities'), 'action': row['action'],
                    'old_log_probability': row['logp'], 'old_value': row['value'],
                    'reward': row['reward'], 'outcome': trajectory[-1]['reward'],
                    'return_target': float(returns[row_id]), 'raw_advantage': float(advantage[row_id]),
                    'normalized_advantage': float(normalized_advantage[row_id])})
                row_id += 1
    advantage = torch.from_numpy(normalized_advantage).to(device)
    reference = None
    chain_alpha = config.get("chain_alpha", 0.)
    if chain_alpha:
        from .learning_methods import freeze_reference
        reference = freeze_reference(model, features, masks, config["chain_reference_states"])
    before = torch.cat([parameter.detach().flatten().cpu() for parameter in model.parameters()])
    measurements = []
    started = time.perf_counter()
    stop = False
    for epoch in range(config["epochs"]):
        indices = torch.randperm(len(rows), device=device)
        for minibatch, subset in enumerate(indices.split(config["minibatch"])):
            if time.perf_counter() >= deadline or (stop_requested and stop_requested()):
                stop = True
                break
            distribution, values = model(features[subset], masks[subset])
            logp = distribution.log_prob(actions[subset])
            logratio = logp - old_logp[subset]
            ratio = logratio.exp()
            unclipped = ratio * advantage[subset]
            clipped = ratio.clamp(1 - config["clip"], 1 + config["clip"]) * advantage[subset]
            policy_loss = -torch.minimum(unclipped, clipped).mean()
            value_loss = (values - returns_tensor[subset]).square().mean()
            entropy = distribution.entropy().mean()
            normalized_entropy = (distribution.entropy() / masks[subset].sum(-1).float().log().clamp_min(1e-8)).mean()
            loss = policy_loss + config["value_coefficient"] * value_loss - config["entropy_coefficient"] * entropy
            if reference is not None:
                from .learning_methods import reference_kl
                churn_kl = reference_kl(model, reference)
                loss = loss + chain_alpha * churn_kl
            if not torch.isfinite(loss):
                raise RuntimeError("Nonfinite PPO loss")
            if diagnostics is not None:
                diagnostics.gradients(epoch, minibatch, policy_loss, value_loss, entropy, loss, -torch.minimum(unclipped, clipped), outcome_tensor[subset], config)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), config["max_grad_norm"])
            if not torch.isfinite(grad_norm):
                raise RuntimeError("Nonfinite PPO gradient")
            if diagnostics is not None and diagnostics.detailed:
                post_norm = float(torch.linalg.vector_norm(torch.cat([p.grad.detach().flatten() for p in model.parameters() if p.grad is not None])).item())
                diagnostics.clipping(float(grad_norm), post_norm)
            audit_before = torch.cat([p.detach().flatten().cpu() for p in model.parameters()]) if diagnostics is not None and getattr(diagnostics, 'all_minibatches', False) else None
            optimizer.step()
            if audit_before is not None:
                diagnostics.after_step(audit_before, subset.detach().cpu().tolist(),
                    logp.detach().cpu().tolist(), values.detach().cpu().tolist(),
                    ratio.detach().cpu().tolist(), (-torch.minimum(unclipped, clipped)).detach().cpu().tolist())
            with torch.no_grad():
                kl = ((ratio - 1) - logratio).mean().item()
                measurements.append({
                    "policy_loss": policy_loss.item(), "value_loss": value_loss.item(),
                    "entropy": entropy.item(), "normalized_entropy": normalized_entropy.item(),
                    "approx_kl": kl, "clip_fraction": ((ratio - 1).abs() > config["clip"]).float().mean().item(),
                    "gradient_norm": grad_norm.item(),
                    **({"chain_reference_kl": churn_kl.item(), "chain_penalty": chain_alpha * churn_kl.item()} if reference is not None else {}),
                })
            if kl > config["target_kl"]:
                stop = True
                break
        if stop:
            break
    after = torch.cat([parameter.detach().flatten().cpu() for parameter in model.parameters()])
    return {
        **({key: float(np.mean([row[key] for row in measurements])) for key in measurements[0]} if measurements else {}),
        "explained_variance": explained_variance,
        "parameter_delta_l2": torch.linalg.vector_norm(after - before).item(),
        "optimizer_steps": len(measurements), "optimization_seconds": time.perf_counter() - started,
        "learner_samples": len(rows), "kl_or_deadline_stop": stop,
        "interrupted": time.perf_counter() >= deadline or bool(stop_requested and stop_requested()),
        "return_mean": float(np.mean([trajectory[-1]["reward"] for trajectory in trajectories])),
        "return_std": float(np.std([trajectory[-1]["reward"] for trajectory in trajectories])),
    }


def sample_opponent(rng, update, history, mixture="standard"):
    if update <= 4:
        return "current" if rng.random() < 0.8 else "random"
    bucket = rng.random()
    current, random_cutoff, recent_cutoff = (.3, .7, .9) if mixture == "random_rich" else (.5, .6, .85)
    if bucket < current:
        return "current"
    if bucket < random_cutoff:
        return "random"
    if bucket < recent_cutoff:
        return str(rng.choice(history[-3:]))
    return str(rng.choice(history[:-3] or history[:1]))


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--gae-lambda", type=float)
    parser.add_argument("--restart-probability", type=float)
    parser.add_argument("--restart-treatment", choices=["B0", "B1", "B2"])
    parser.add_argument("--restart-archive", type=Path)
    parser.add_argument("--restart-archive-sha256")
    parser.add_argument("--learning-rate", type=float)
    parser.add_argument("--learning-method", choices=["baseline", "gae_lambda_095", "chain_lite"])
    parser.add_argument("--chain-alpha", type=float)
    parser.add_argument("--until-step-target", action="store_true", default=None,
                        help="No wall-clock cutoff; retain exact max-env-steps target")
    parser.add_argument("--opponent-mixture", choices=["standard", "random_rich"])
    parser.add_argument("--audit-records", choices=["off", "full"])
    parser.add_argument("--replay-sample-denominator", type=int)
    parser.add_argument("--audit-max-bytes", type=int)
    parser.add_argument("--instrumentation", choices=["off", "basic", "detailed"])
    parser.add_argument("--gradient-sample-every-updates", type=int)
    parser.add_argument("--architecture", choices=["baseline", "critic", "cnn"])
    parser.add_argument("--seed", type=int)
    parser.add_argument("--training-seconds", type=float)
    parser.add_argument("--deadline-epoch", type=float, help="Absolute campaign deadline; cannot be extended on resume")
    parser.add_argument("--max-env-steps", type=int)
    parser.add_argument("--max-updates", type=int)
    parser.add_argument("--batch-games", type=int)
    parser.add_argument("--checkpoint-every", type=int)
    parser.add_argument("--checkpoint-every-steps", type=int)
    parser.add_argument("--max-replays", type=int)
    parser.add_argument("--threads", type=int)
    parser.add_argument("--device", choices=["cpu", "mps"])
    parser.add_argument("--validation-seed-start", type=int)
    parser.add_argument("--validation-pairs", type=int)
    parser.add_argument("--skip-initial-validation", action="store_true")
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--status", type=Path)
    parser.add_argument("--stop-after-updates", type=int, help="Graceful boundary stop for resume verification")
    return parser.parse_args(argv)


def configuration(args, previous=None):
    defaults = {
        "audit_records": "off", "replay_sample_denominator": 32, "audit_max_bytes": 250_000_000, "opponent_mixture": "standard", "instrumentation": "off", "gradient_sample_every_updates": 10, "architecture": "baseline", "seed": 7, "training_seconds": 7200.,
        "max_env_steps": 262144, "max_updates": 100000, "batch_games": 16,
        "checkpoint_every": 8, "checkpoint_every_steps": 0, "max_replays": 8,
        "threads": 2, "device": "cpu", "validation_seed_start": 1_000_000,
        "validation_pairs": 8, "resume_every_steps": 50_000,
        "deadline_epoch": None,
        "max_saved_milestones": 3,
        "gamma": 1.0, "gae_lambda": 1.0, "learning_rate": .0003,
        "learning_method": "baseline", "chain_alpha": 0., "chain_reference_states": 256,
        "until_step_target": False,
        "restart_treatment": None, "restart_archive": None, "restart_archive_sha256": None,
        "epochs": 4, "minibatch": 256, "clip": .2, "target_kl": .03,
        "value_coefficient": .5, "entropy_coefficient": .01, "max_grad_norm": .5,
        "rewards": {"win": 1, "draw": 0, "loss": -1, "intermediate": 0},
        "opponent_sampling": "updates 1-4: current .8/random .2; later current .5/random .1/recent .25/old .15",
        "checkpoint_selection": "final predetermined step, never final-evaluation results",
        "step_limit_semantics": "exact transition cap; unfinished games are counted and excluded from PPO",
    }
    config = {**defaults, **(previous or {})}
    if args.deadline_epoch is not None:
        prior_deadline = config.get("deadline_epoch")
        if prior_deadline is not None and args.deadline_epoch > prior_deadline:
            raise ValueError("Resume cannot extend the absolute campaign deadline")
        config["deadline_epoch"] = args.deadline_epoch
    for key in ["learning_method", "chain_alpha", "until_step_target", "audit_records", "replay_sample_denominator", "audit_max_bytes", "learning_rate", "opponent_mixture", "instrumentation", "gradient_sample_every_updates", "architecture", "seed", "training_seconds", "max_env_steps", "max_updates", "batch_games", "checkpoint_every", "checkpoint_every_steps", "max_replays", "threads", "device", "validation_seed_start", "validation_pairs"]:
        value = getattr(args, key)
        if value is not None:
            if previous and key in ["learning_method", "chain_alpha", "until_step_target", "audit_records", "replay_sample_denominator", "audit_max_bytes", "learning_rate", "opponent_mixture", "instrumentation", "gradient_sample_every_updates", "architecture", "seed", "batch_games", "checkpoint_every", "checkpoint_every_steps", "threads", "device", "validation_seed_start", "validation_pairs"] and value != config[key]:
                raise ValueError(f"Exact resume cannot change {key}")
            config[key] = value
    method = config["learning_method"]
    for key in ["restart_treatment", "restart_archive", "restart_archive_sha256"]:
        value = getattr(args, key)
        if isinstance(value, Path):
            value = str(value.resolve())
        if value is not None:
            if previous and value != config[key]:
                raise ValueError(f"Exact resume cannot change {key}")
            config[key] = value
    if config["restart_treatment"] is not None:
        if method != "gae_lambda_095" or config["architecture"] != "baseline" or config["opponent_mixture"] != "standard":
            raise ValueError("Restart campaign requires reference GAE095 Baseline and standard opponents")
        if config["restart_treatment"] != "B0" and (not config["restart_archive"] or not config["restart_archive_sha256"]):
            raise ValueError("Restart treatment requires a frozen archive and checksum")
    config["gae_lambda"] = .95 if method == "gae_lambda_095" else 1.
    if previous:
        config["gae_lambda"] = previous["gae_lambda"]
    if args.gae_lambda is not None:
        if args.gae_lambda not in [.85, .90, .95] or method != "gae_lambda_095":
            raise ValueError("Campaign lambda override requires GAE095 method and .85/.90/.95")
        if previous and args.gae_lambda != previous["gae_lambda"]:
            raise ValueError("Exact resume cannot change lambda")
        config["gae_lambda"] = args.gae_lambda
    if args.restart_probability is not None:
        if config["restart_treatment"] != "B2" or args.restart_probability not in [.3, .5, .7]:
            raise ValueError("Density override requires B2 and .3/.5/.7")
        if previous and args.restart_probability != previous.get("restart_probability", .3):
            raise ValueError("Exact resume cannot change restart probability")
        config["restart_probability"] = args.restart_probability
    if method == "chain_lite" and not previous and args.chain_alpha is None:
        from .learning_methods import CHAIN_ALPHA
        config["chain_alpha"] = CHAIN_ALPHA
    if not np.isfinite(config["chain_alpha"]) or config["chain_alpha"] < 0:
        raise ValueError("CHAIN alpha must be finite and nonnegative")
    if method != "chain_lite" and config["chain_alpha"] != 0:
        raise ValueError("Only CHAIN-lite may use policy-churn regularization")
    if config['replay_sample_denominator'] < 1 or config['audit_max_bytes'] < 1:
        raise ValueError('Audit limits must be positive')
    if config['audit_records'] == 'full':
        if not previous and args.max_replays is None: config['max_replays'] = 512
        if config['instrumentation'] != 'detailed':
            raise ValueError('Full audit requires --instrumentation detailed')
    if not 0 < config["learning_rate"] <= .01:
        raise ValueError("Invalid learning rate")
    if config["opponent_mixture"] == "random_rich":
        config["opponent_sampling"] = "updates1-4 current.8/random.2; then current.3/random.4/recent.2/old.1"
    if config["gradient_sample_every_updates"] < 1:
        raise ValueError("Gradient sampling interval must be positive")
    if not 0 < config["training_seconds"] <= 25200:
        raise ValueError("Training time budget must be in (0, 25200] seconds")
    if not 1 <= config["batch_games"] <= 32 or not 1 <= config["threads"] <= 2:
        raise ValueError("Use 1-32 games and at most two Torch threads")
    if not 1 <= config["max_updates"] <= 100000 or not 1 <= config["max_env_steps"] <= 100_000_000:
        raise ValueError("Invalid bounded update/step target")
    if config["checkpoint_every"] < 1 or config["checkpoint_every_steps"] < 0 or not 0 <= config["max_replays"] <= (2048 if config["audit_records"] == "full" else 32):
        raise ValueError("Invalid checkpoint/replay limits")
    if not 0 <= config["validation_pairs"] <= 128 or config["validation_seed_start"] < 1_000_000:
        raise ValueError("Validation decks must be independent of training")
    config["output"] = str(args.output.resolve())
    config["held_out_validation_seeds"] = list(range(config["validation_seed_start"], config["validation_seed_start"] + config["validation_pairs"]))
    return config


def empty_training_state():
    return {
        "updates": 0, "rollouts": 0, "env_steps": 0,
        "attempted_games": 0, "completed_games": 0, "incomplete_games": 0,
        "training_wall_seconds": 0., "validation_seconds": 0., "optimization_seconds": 0.,
        "inference_seconds": 0., "inference_decisions": 0, "optimizer_steps": 0,
        "next_milestone": 0, "last_resume_steps": 0, "replay_count": 0,
        "discarded_env_steps_after_interrupt": 0,
        "metrics_offset": 0, "games_offset": 0,
    }


def restore_log_boundary(path, offset):
    if not path.exists():
        if offset:
            raise ValueError(f"Resume log missing: {path}")
        return
    data = path.read_bytes()
    if len(data) < offset:
        raise ValueError(f"Resume log shorter than checkpoint boundary: {path}")
    if len(data) > offset:
        # Preserve orphaned log records separately rather than mixing them into
        # a replayed continuation or deleting potentially useful failure evidence.
        recovered = path.with_name(path.name + f".orphan-{time.time_ns()}")
        recovered.write_bytes(data[offset:])
        with path.open("r+b") as file:
            file.truncate(offset)


def saved_milestones(config):
    interval = config["checkpoint_every_steps"]
    if not interval:
        return set()
    candidates = list(range(interval, config["max_env_steps"], interval))
    if len(candidates) <= config["max_saved_milestones"]:
        return set(candidates)
    return {candidates[min(len(candidates) - 1, max(0, int(round(fraction * len(candidates))) - 1))] for fraction in [.25, .5, .75]}


def main(argv=None):
    args = parse_args(argv)
    output = args.output.resolve()
    experiment_root = ROOT / "benchmark-results/ai7-selfplay"
    if not output.is_relative_to(experiment_root):
        raise ValueError("Experiment output must be inside benchmark-results/ai7-selfplay")
    resume_checkpoint = None
    if args.resume:
        _, resume_checkpoint = load_checkpoint(args.resume)
    config = configuration(args, resume_checkpoint["config"] if resume_checkpoint else None)
    seed_all(config["seed"], config["threads"])
    if args.resume:
        model, optimizer, rng, history, opponents, state, _ = restore_training_checkpoint(args.resume, config["device"])
        if not output.exists():
            output.mkdir(parents=True)
        restore_log_boundary(output / "metrics.jsonl", state["metrics_offset"])
        restore_log_boundary(output / "training-games.jsonl", state["games_offset"])
        # Account for time recorded after the last periodic checkpoint too.
        prior_status = args.status.resolve() if args.status else output / "status.json"
        if prior_status.exists():
            prior = json.loads(prior_status.read_text())
            state["training_wall_seconds"] = max(state["training_wall_seconds"], prior.get("training_wall_seconds", 0.))
    else:
        output.mkdir(parents=True, exist_ok=False)
        model = make_policy({"architecture": config["architecture"]}).to(config["device"])
        optimizer = torch.optim.Adam(model.parameters(), lr=config["learning_rate"], eps=1e-5)
        rng = np.random.default_rng(config["seed"])
        history = ["initial"]
        opponents = {"initial": copy.deepcopy(model).eval()}
        state = empty_training_state()
        state["next_milestone"] = config["checkpoint_every_steps"]
    status_path = args.status.resolve() if args.status else output / "status.json"
    stop = {"requested": False, "signal": None}
    def on_signal(number, _frame):
        stop.update(requested=True, signal=number)
    previous_handlers = {number: signal.signal(number, on_signal) for number in [signal.SIGTERM, signal.SIGINT]}
    stop_requested = lambda: stop["requested"]
    started = time.perf_counter()
    previous_seconds = state["training_wall_seconds"]
    deadline = float("inf") if config["until_step_target"] else started + max(0, config["training_seconds"] - previous_seconds)
    if config["deadline_epoch"] is not None:
        deadline = min(deadline, started + max(0, config["deadline_epoch"] - time.time()))
    status = "running"
    stop_reason = None
    bridge = Bridge(output / "training-replays")
    sampler = None
    if config["restart_treatment"] is not None:
        from .restart_sampling import RestartSampler
        catalog = [] if config["restart_treatment"] == "B0" else bridge.request(
            command="load-restarts", path=config["restart_archive"], sha256=config["restart_archive_sha256"])
        sampler = RestartSampler(catalog, config["restart_archive_sha256"], config["restart_treatment"], config["seed"] ^ 0x4B951, restart_probability=config.get("restart_probability"))
        if args.resume:
            sampler.load_state_dict(state["restart_sampler"])
    suite = None
    if config['instrumentation'] != 'off':
        from .instrumentation import UpdateDiagnostics, suite_fingerprint
        suite = bridge.request(command='probes')
        fingerprint = suite_fingerprint(suite)
        if state.get('probe_fingerprint', fingerprint) != fingerprint:
            raise ValueError('Diagnostic probe suite changed on resume')
        state['probe_fingerprint'] = fingerprint
        if 'probe_initial' not in state:
            observer = UpdateDiagnostics(model, suite, [], 0)
            state['probe_initial'] = observer.before.tolist()
        if not args.resume:
            write_json(output / 'instrumentation-probes.json', suite)
    saved = saved_milestones(config)
    def elapsed_total():
        return previous_seconds + time.perf_counter() - started
    def persist_status(phase, **extra):
        write_json(status_path, {
            **state, "status": phase, "architecture": config["architecture"],
            "seed": config["seed"], "pid": os.getpid(), "training_wall_seconds": elapsed_total(),
            "target_env_steps": config["max_env_steps"], "updated_at_unix": time.time(),
            "checkpoint": str(output / "latest.pt"), **extra,
        })
    def checkpoint(path):
        state["training_wall_seconds"] = elapsed_total()
        if sampler is not None:
            state["restart_sampler"] = sampler.state_dict()
        guard_artifacts(experiment_root, additional=100_000_000)
        save_checkpoint(path, model, optimizer, config, state["updates"], state["env_steps"], rng, history, opponents, state)
    def validate(label):
        validation_start = time.perf_counter()
        specs = [{"seed": seed, "seat": seat, "action_seed": seed ^ 0x13579, "opponent": "random"} for seed in config["held_out_validation_seeds"] for seat in [0, 1]]
        result = collect(bridge, model, specs, {}, config["device"], deadline=deadline, stop_requested=stop_requested)
        report = {"checkpoint": label, "env_steps": state["env_steps"], "attempted": result["attempted"], "incomplete": result["incomplete"], **summarize(result["games"]), "games": result["games"]}
        write_json(output / f"validation-{label}.json", report)
        state["validation_seconds"] += time.perf_counter() - validation_start
        return {key: value for key, value in report.items() if key != "games"}
    try:
        guard_artifacts(experiment_root, additional=100_000_000)
        manifest = output / (f"resume-manifest-{time.time_ns()}.json" if args.resume else "manifest.json")
        write_json(manifest, {"config": config, "provenance": provenance(config["architecture"]), "node_environment": bridge.metadata, "resume_from": str(args.resume) if args.resume else None, "parameters": sum(parameter.numel() for parameter in model.parameters()), "parameter_count": sum(parameter.numel() for parameter in model.parameters()), "model_config": model.config})
        if not args.resume:
            checkpoint(output / "initial.pt")
            checkpoint(output / "latest.pt")
            if config["validation_pairs"] and not args.skip_initial_validation:
                print(json.dumps({"initial_validation": validate("initial")}), flush=True)
        persist_status("running")
        while state["updates"] < config["max_updates"] and state["env_steps"] < config["max_env_steps"]:
            if stop_requested() or time.perf_counter() >= deadline:
                stop_reason = "signal" if stop_requested() else "time_budget"
                break
            guard_artifacts(experiment_root, additional=100_000_000)
            # All mutable learning/RNG state is recoverable at this exact boundary.
            boundary_rng = capture_rng(rng)
            boundary_sampler = sampler.state_dict() if sampler is not None else None
            boundary_model = copy.deepcopy(model.state_dict())
            boundary_optimizer = copy.deepcopy(optimizer.state_dict())
            update = state["updates"] + 1
            specs = []
            for i in range(config["batch_games"]):
                archive = i == 0 and state["replay_count"] < config["max_replays"] and (state["rollouts"] == 0 or state["env_steps"] // max(1, config["max_env_steps"] // max(1, config["max_replays"])) >= state["replay_count"])
                specs.append({
                    "seed": int(rng.integers(0, 900_000)), "seat": int(rng.integers(0, 2)),
                    "action_seed": int(rng.integers(0, 2**32)), "opponent": sample_opponent(rng, update, history, config["opponent_mixture"]),
                    **({"archive": f"rollout-{state['rollouts'] + 1:06d}-game-{i:02d}.json"} if archive else {}),
                })
                if sampler is not None:
                    specs[-1].update(sampler.sample())
            if config['audit_records'] == 'full':
                retained = 0
                for game_id, spec in enumerate(specs):
                    spec.pop('archive', None)
                    if spec['seed'] % config['replay_sample_denominator'] == 0 and state['replay_count'] + retained < config['max_replays']:
                        spec['archive'] = f"rollout-{state['rollouts'] + 1:06d}-game-{game_id:02d}.json"
                        retained += 1
            target = min(config["max_env_steps"], state["next_milestone"]) if config["checkpoint_every_steps"] else config["max_env_steps"]
            rollout = collect(bridge, model, specs, opponents, config["device"], training=True, deadline=deadline, max_env_steps=target - state["env_steps"], stop_requested=stop_requested)
            metrics = None
            interrupted = stop_requested() or time.perf_counter() >= deadline
            if rollout["trajectories"] and not interrupted:
                diagnostics = None
                if suite is not None:
                    diagnostics = UpdateDiagnostics(model, suite, state['probe_initial'], update, config['gradient_sample_every_updates'])
                    if config['audit_records'] == 'full':
                        diagnostics.detailed = True
                        diagnostics.all_minibatches = True
                        diagnostics.record['gradient_sampling'] = 'every optimizer minibatch; summary vectors only'
                    if config['instrumentation'] == 'basic':
                        diagnostics.detailed = False
                        diagnostics.record['gradient_sampling'] = 'none'
                metrics = optimize(model, optimizer, rollout["trajectories"], config, config["device"], deadline, stop_requested, diagnostics)
                if diagnostics is not None and 'decisions' in diagnostics.record:
                    for decision in diagnostics.record['decisions']:
                        decision['game_id'] = rollout['trajectory_game_ids'][decision['game_index']]
                if diagnostics is not None and not metrics['interrupted']:
                    metrics['diagnostics'] = diagnostics.finish()
                interrupted = metrics["interrupted"]
            if interrupted:
                model.load_state_dict(boundary_model)
                optimizer.load_state_dict(boundary_optimizer)
                restore_rng(boundary_rng, rng)
                if sampler is not None:
                    sampler.load_state_dict(boundary_sampler)
                state["discarded_env_steps_after_interrupt"] += rollout["env_steps"]
                stop_reason = "signal" if stop_requested() else "time_budget"
                break
            audit_size = 0
            if config['audit_records'] == 'full' and metrics and 'diagnostics' in metrics:
                metrics['diagnostics']['games'] = rollout['games']
                audit_size = len(json.dumps(metrics['diagnostics'], allow_nan=False).encode())
                if state.get('audit_bytes', 0) + audit_size > config['audit_max_bytes']:
                    model.load_state_dict(boundary_model)
                    optimizer.load_state_dict(boundary_optimizer)
                    restore_rng(boundary_rng, rng)
                    if sampler is not None:
                        sampler.load_state_dict(boundary_sampler)
                    state['discarded_env_steps_after_interrupt'] += rollout['env_steps']
                    stop_reason = 'audit_budget'
                    break
                state['audit_bytes'] = state.get('audit_bytes', 0) + audit_size
            state["env_steps"] += rollout["env_steps"]
            for key, value in rollout["transitions_by_start"].items():
                state[key + "_start_transitions"] = state.get(key + "_start_transitions", 0) + value
            if sampler is not None:
                state["restart_sampler"] = sampler.state_dict()
                state["zero_decision_games"] = state.get("zero_decision_games", 0) + rollout["zero_decision_games"]
                state["restart_reset_seconds"] = state.get("restart_reset_seconds", 0.) + rollout["reset_seconds"]
            state["rollouts"] += 1
            state["attempted_games"] += rollout["attempted"]
            state["completed_games"] += len(rollout["games"])
            state["incomplete_games"] += rollout["incomplete"]
            state["inference_seconds"] += rollout["inference_seconds"]
            state["inference_decisions"] += rollout["inference_decisions"]
            state["replay_count"] += sum("archive" in game for game in rollout["games"])
            if metrics:
                state["updates"] += 1
                state["optimization_seconds"] += metrics["optimization_seconds"]
                state["optimizer_steps"] += metrics["optimizer_steps"]
            else:
                metrics = {"optimizer_steps": 0, "learner_samples": 0, "parameter_delta_l2": 0., "explained_variance": None, "normalized_entropy": None, "entropy": None, "value_loss": None, "policy_loss": None, "approx_kl": None, "clip_fraction": None}
            metrics.update({
                "architecture": config["architecture"], "update": state["updates"], "rollout": state["rollouts"],
                "env_steps": state["env_steps"], "training_seconds": elapsed_total(),
                "rollout_seconds": rollout["seconds"], "env_steps_per_second": rollout["env_steps"] / max(1e-9, rollout["seconds"]),
                "inference_ms_per_decision": 1000 * rollout["inference_seconds"] / max(1, rollout["inference_decisions"]),
                "attempted": rollout["attempted"], "incomplete": rollout["incomplete"],
                **({"restart_sampler": sampler.state_dict(), "zero_decision_games": rollout["zero_decision_games"],
                    "reset_seconds": rollout["reset_seconds"],
                    "mean_continuation_plies": float(np.mean([g.get('continuation_plies',g['plies']) for g in rollout['games']])) if rollout['games'] else None} if sampler is not None else {}),
                "transitions_by_start": rollout["transitions_by_start"],
                "training_games": summarize(rollout["games"]),
                "opponents": {key: summarize([game for game in rollout["games"] if game["opponent"] == key]) for key in sorted({game["opponent"] for game in rollout["games"]})},
            })
            with (output / "metrics.jsonl").open("a") as file:
                file.write(json.dumps(metrics, allow_nan=False) + "\n")
            with (output / "training-games.jsonl").open("a") as file:
                for game in rollout["games"]:
                    file.write(json.dumps({**game, "update": state["updates"], "rollout": state["rollouts"]}, allow_nan=False) + "\n")
            state["metrics_offset"] = (output / "metrics.jsonl").stat().st_size
            state["games_offset"] = (output / "training-games.jsonl").stat().st_size
            print(json.dumps(metrics, allow_nan=False), flush=True)
            milestone = config["checkpoint_every_steps"] and state["env_steps"] == state["next_milestone"]
            legacy_snapshot = not config["checkpoint_every_steps"] and state["updates"] and state["updates"] % config["checkpoint_every"] == 0
            if milestone or legacy_snapshot:
                label = f"step-{state['env_steps']:09d}"
                history.append(label)
                opponents[label] = copy.deepcopy(model).eval()
                keep = set(history[-3:] + history[:2] + history[len(history)//2:len(history)//2 + 1])
                history = [key for key in history if key in keep]
                opponents = {key: value for key, value in opponents.items() if key in keep}
                if milestone:
                    state["next_milestone"] += config["checkpoint_every_steps"]
                if state["env_steps"] < config["max_env_steps"] and ((milestone and state["env_steps"] in saved) or (legacy_snapshot and len(list(output.glob("step-*.pt"))) < config["max_saved_milestones"])):
                    checkpoint(output / f"{label}.pt")
                if config["validation_pairs"] and not stop_requested() and time.perf_counter() < deadline:
                    print(json.dumps({"validation": validate(label)}), flush=True)
            if milestone or state["env_steps"] - state["last_resume_steps"] >= config["resume_every_steps"]:
                state["last_resume_steps"] = state["env_steps"]
                checkpoint(output / "latest.pt")
            persist_status("running")
            if args.stop_after_updates and state["updates"] >= args.stop_after_updates:
                stop_reason = "requested_boundary_stop"
                break
        stop_reason = stop_reason or ("step_target" if state["env_steps"] >= config["max_env_steps"] else "update_limit")
        status = "completed" if stop_reason == "step_target" else "partial"
        checkpoint(output / "latest.pt")
        checkpoint(output / "final.pt")
        reloaded, _ = load_checkpoint(output / "final.pt", config["device"])
        exact_reload = all(torch.equal(a, b) for a, b in zip(model.state_dict().values(), reloaded.state_dict().values()))
        games_path = output / "training-games.jsonl"
        games = [json.loads(line) for line in games_path.read_text().splitlines()] if games_path.exists() else []
        summary = {
            **state, "architecture": config["architecture"], "seed": config["seed"],
            "parameters": sum(parameter.numel() for parameter in model.parameters()),
            "parameter_count": sum(parameter.numel() for parameter in model.parameters()), "model_config": model.config,
            "actual_training_seconds": state["training_wall_seconds"] - state["validation_seconds"],
            "optimizer_steps_per_second": state["optimizer_steps"] / max(1e-9, state["optimization_seconds"]),
            "updates_per_second": state["updates"] / max(1e-9, state["training_wall_seconds"] - state["validation_seconds"]),
            "inference_ms_per_decision": 1000 * state["inference_seconds"] / max(1, state["inference_decisions"]),
            "checkpoint_exact_reload": exact_reload, "stop_reason": stop_reason, "status": status,
            "behavior": summarize(games), "artifact_bytes": guard_artifacts(experiment_root, additional=0),
        }
        write_json(output / "summary.json", summary)
        persist_status(status, stop_reason=stop_reason)
        print(json.dumps({"summary": summary}), flush=True)
    except BaseException as error:
        persist_status("failed", error=repr(error))
        raise
    finally:
        bridge.close()
        for number, handler in previous_handlers.items():
            signal.signal(number, handler)


if __name__ == "__main__":
    main()
