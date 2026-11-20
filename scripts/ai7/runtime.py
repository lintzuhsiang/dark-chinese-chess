"""Public-only bridge, small masked policy, complete-game collection, provenance."""
from __future__ import annotations

import shutil
import hashlib
import copy
import io
import json
import os
from pathlib import Path
import platform
import random
import subprocess
import time
from collections import defaultdict

import numpy as np
import torch
from torch import nn
from torch.distributions import Categorical

ROOT = Path(__file__).resolve().parents[2]
CORE_REVISION = "973bafe42f66e3414878afb3284e1f54216cbe4d"
ARCHITECTURE = "public-mlp128-v1"
OBSERVATION_VERSION = "public-v1"
ACTION_COUNT = 1056
HARD_ARTIFACT_BYTES = 5_000_000_000
ARCHITECTURES = {
    "baseline": ARCHITECTURE,
    "critic": "public-separate-critic-v1",
    "cnn": "public-board-cnn-v1",
    "e2a_g": "public-geometry-tied-mlp128-v1",
}
_EYES = {count: np.eye(count, dtype=np.float32) for count in [2, 3, 16, 33]}


class Bridge:
    """The sole process holding private game state is the Node child."""

    def __init__(self, output: Path):
        self.process = subprocess.Popen(
            ["node", "--import", "./scripts/ai-eval/register.mjs", "scripts/ai7/server.ts", str(output)],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
        )
        self.calls = 0
        self.elapsed = 0.0
        self.metadata = self.request(command="hello")
        if self.metadata["coreRevision"] != CORE_REVISION:
            raise RuntimeError("Core revision mismatch")

    def request(self, **request):
        started = time.perf_counter()
        self.process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError(f"GameCore server exited: {self.process.poll()}")
        response = json.loads(line)
        self.calls += 1
        self.elapsed += time.perf_counter() - started
        if not response["ok"]:
            raise RuntimeError(response["error"])
        return response["value"]

    def close(self):
        try:
            if self.process.poll() is None:
                self.request(command="close")
        finally:
            self.process.stdin.close()
            self.process.stdout.close()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                self.process.wait(timeout=5)


def encode(observation):
    """Byte-equivalent public-v1 encoding, without repeated eye/concatenate loops."""
    features = np.zeros(2163, dtype=np.float32)
    features[:512] = _EYES[16][observation["board"]].ravel()
    features[512:1568] = _EYES[33][observation["references"]].ravel()
    features[1568:1596] = np.asarray(observation["hiddenInventory"] + observation["remainingInventory"], dtype=np.float32) / 5
    features[1596:1598] = _EYES[2][observation["player"]]
    features[1598:1601] = _EYES[3][observation["color"]]
    features[1601:1603] = [observation["quiet"] / 60, observation["ply"] / 4096]
    if observation["history"]:
        events = np.asarray(observation["history"], dtype=np.int64)
        if len(events) > 20 or events.shape[1] != 10:
            raise ValueError("public-v1 expects at most 20 ten-field events")
        history = features[1603:].reshape(20, 28)
        rows = np.arange(len(events))
        history[rows, events[:, 0] - 1] = 1
        history[rows, 2 + events[:, 1] - 1] = 1
        history[:len(events), 4:8] = events[:, 2:6] / 32
        history[rows, 8 + events[:, 6] - 1] = 1
        history[rows, 15 + events[:, 7] - 1] = 1
        history[rows, 17 + events[:, 8]] = 1
        history[rows, 25 + events[:, 9]] = 1
    return features


class Policy(nn.Module):
    def __init__(self, input_dim=2163, width=128, architecture="baseline"):
        super().__init__()
        if architecture != "baseline":
            raise ValueError("Policy is the baseline MLP")
        self.config = {"architecture": architecture, "input_dim": input_dim, "width": width}
        self.body = nn.Sequential(nn.Linear(input_dim, width), nn.Tanh(), nn.Linear(width, width), nn.Tanh())
        self.actor = nn.Linear(width, ACTION_COUNT)
        self.critic = nn.Linear(width, 1)
        for layer in self.modules():
            if isinstance(layer, nn.Linear):
                nn.init.orthogonal_(layer.weight, gain=np.sqrt(2))
                nn.init.zeros_(layer.bias)
        nn.init.orthogonal_(self.actor.weight, gain=0.01)
        nn.init.orthogonal_(self.critic.weight, gain=1.0)

    def forward(self, features, masks):
        if not masks.any(dim=-1).all():
            raise ValueError("A policy decision must have at least one legal action")
        hidden = self.body(features)
        logits = self.actor(hidden).masked_fill(~masks, -torch.inf)
        return Categorical(logits=logits), self.critic(hidden).squeeze(-1)


def make_policy(config=None):
    config = dict(config or {})
    architecture = config.setdefault("architecture", "baseline")
    if architecture == "baseline":
        return Policy(**config)
    if architecture == "critic":
        from .critic import ImprovedCriticPolicy
        return ImprovedCriticPolicy(**config)
    if architecture == "cnn":
        from .cnn import BoardCNNPolicy
        return BoardCNNPolicy(**config)
    if architecture == "e2a_g":
        from .geometry_head import GeometryPolicy
        return GeometryPolicy(**config)
    raise ValueError(f"Unknown architecture: {architecture}")


def seed_all(seed, threads=2):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(threads)
    if torch.get_num_interop_threads() != 1:
        torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)


def mask_array(observations):
    masks = np.zeros((len(observations), ACTION_COUNT), dtype=np.bool_)
    for i, observation in enumerate(observations):
        masks[i, observation["legal"]] = True
    return masks


def collect(bridge, learner, specifications, opponents, device="cpu", training=False, deadline=float("inf"), max_env_steps=None, stop_requested=None):
    """Full games; each learner trajectory belongs to one fixed seat.

    Opponent actions are never PPO samples. Frozen historical policies and current
    policy opponents remain unchanged until every game in the batch finishes.
    Terminal rewards, including an opponent's last action, go to the final learner
    decision. No artificial draw/zero reward is assigned to interrupted games.
    """
    if not training and any("restartId" in spec for spec in specifications):
        raise ValueError("Restart starts are training-only; evaluation requires normal full games")
    reset_started = time.perf_counter()
    states = bridge.request(command="reset", games=[{
        "id": i, "seed": spec["seed"],
        **({"prefix": spec["prefix"]} if spec.get("prefix") else {}),
        **({"archive": spec["archive"]} if spec.get("archive") else {}),
        **({"restartId": spec["restartId"]} if "restartId" in spec else {}),
    } for i, spec in enumerate(specifications)])
    reset_seconds = time.perf_counter() - reset_started
    active = {state["id"]: state["observation"] for state in states}
    start_plies = {i: observation["ply"] for i, observation in active.items()}
    trajectories = [[] for _ in specifications]
    streams = [(np.random.default_rng(spec["action_seed"]), np.random.default_rng(spec["action_seed"] ^ 0x5A5A5A5A)) for spec in specifications]
    completed = []
    env_steps = 0
    transitions_by_start = {"normal": 0, "restart": 0}
    inference_seconds = 0.0
    inference_decisions = 0
    started = time.perf_counter()
    while active:
        if time.perf_counter() >= deadline or (stop_requested and stop_requested()):
            break
        if max_env_steps is not None and env_steps >= max_env_steps:
            break
        groups = defaultdict(list)
        baseline_groups = defaultdict(list)
        actions = []
        pending = list(active.items())
        if max_env_steps is not None:
            pending = pending[:max_env_steps - env_steps]
        for i, observation in pending:
            if observation["ply"] >= 4096:
                raise RuntimeError("Exceeded safety bound; refusing to manufacture a draw")
            spec = specifications[i]
            is_learner = observation["player"] == spec["seat"]
            key = "learner" if is_learner else spec["opponent"]
            if key == "random":
                legal = observation["legal"]
                actions.append({"id": i, "action": int(streams[i][1].choice(legal))})
            elif key in ("ev", "ai6a"):
                if training:
                    raise ValueError("Heuristic opponents are forbidden in training")
                baseline_groups[key].append(i)
            else:
                groups[key].append((i, observation, is_learner))
        for key, ids in baseline_groups.items():
            actions.extend(bridge.request(command="baseline", ids=ids, opponent=key))
        for key, entries in groups.items():
            model = learner if key in ("learner", "current") else opponents[key]
            from .exp3_support import rotate_observation, rotate_id
            observations = [rotate_observation(entry[1]) if entry[2] and specifications[entry[0]].get('rotation') else entry[1] for entry in entries]
            features = np.stack([encode(obs) for obs in observations])
            masks = mask_array(observations)
            infer_start = time.perf_counter()
            with torch.no_grad():
                distribution, values = model(torch.from_numpy(features).to(device), torch.from_numpy(masks).to(device))
                probabilities = distribution.probs.cpu().numpy()
                log_probabilities = distribution.logits.cpu().numpy()
                values = values.cpu().numpy()
            inference_seconds += time.perf_counter() - infer_start
            inference_decisions += len(entries)
            for j, (i, observation, is_learner) in enumerate(entries):
                public_observation = observations[j]
                legal = public_observation["legal"]
                weights = probabilities[j, legal].astype(np.float64)
                weights /= weights.sum()
                action = int(streams[i][0 if is_learner else 1].choice(legal, p=weights))
                actions.append({"id": i, "action": rotate_id(action) if is_learner and specifications[i].get("rotation") else action})
                if training and is_learner:
                    trajectories[i].append({"ply": observation["ply"], "quiet": observation["quiet"], "hidden": observation["board"].count(1), "features": features[j], "legal": legal, "old_legal_probabilities": probabilities[j, legal].tolist(), "action": action, "logp": float(log_probabilities[j, action]), "value": float(values[j]), "reward": 0.0})
        results = bridge.request(command="step", actions=actions)
        env_steps += len(results)
        for result in results:
            i = result["id"]
            transitions_by_start["restart" if "restartId" in specifications[i] else "normal"] += 1
            if result["terminated"]:
                spec = specifications[i]
                reward = result["rewards"]["P1" if spec["seat"] == 0 else "P2"]
                from .exp3_support import reward_for
                objective_reward=reward_for(result['summary']['result'],reward,spec.get('draw_penalty',0.)) if training else reward
                if training:
                    if not trajectories[i]:
                        if "restartId" not in spec:
                            raise RuntimeError("Terminal game without a learner decision")
                    else:
                        trajectories[i][-1]["reward"] = objective_reward
                        for row in trajectories[i]:
                            row["outcome"] = reward
                completed.append({
                    **{key: value for key, value in spec.items() if key != "prefix"},
                    "prefix_plies": len(spec.get("prefix", [])),
                    **result["summary"], "return": reward, "objective_return": objective_reward, "id": i,
                    **({"start_ply": start_plies[i],
                        "continuation_plies": result["summary"]["plies"] - start_plies[i],
                        "learner_decisions": len(trajectories[i])} if "restartId" in spec else {}),
                })
                del active[i]
            else:
                active[i] = result["observation"]
    done_ids = {record["id"] for record in completed}
    return {
        "trajectories": [trajectory for i, trajectory in enumerate(trajectories) if i in done_ids and (trajectory or not training)],
        "trajectory_game_ids": [i for i, trajectory in enumerate(trajectories) if i in done_ids and (trajectory or not training)],
        "games": sorted(completed, key=lambda record: record["id"]),
        "attempted": len(specifications), "incomplete": len(active), "env_steps": env_steps,
        "seconds": time.perf_counter() - started,
        "inference_seconds": inference_seconds, "inference_decisions": inference_decisions,
        "zero_decision_games": sum(not trajectories[i] for i in done_ids) if training else 0,
        "reset_seconds": reset_seconds,
        "transitions_by_start": transitions_by_start,
    }


def advantages(trajectory, gamma=1.0, lam=1.0):
    result = np.zeros(len(trajectory), dtype=np.float32)
    advantage = 0.0
    next_value = 0.0  # complete authoritative terminal, never a truncated episode
    for i in range(len(trajectory) - 1, -1, -1):
        row = trajectory[i]
        delta = row["reward"] + gamma * next_value - row["value"]
        advantage = delta + gamma * lam * advantage
        result[i] = advantage
        next_value = row["value"]
    values = np.asarray([row["value"] for row in trajectory], dtype=np.float32)
    return result, result + values


def artifact_bytes(path):
    return sum(file.stat().st_size for file in path.rglob("*") if file.is_file()) if path.exists() else 0


def guard_artifacts(path, additional=20_000_000):
    configured = os.environ.get("AI7_ARTIFACT_ROOT")
    path = Path(configured).resolve() if configured else Path(path)
    if os.environ.get('AI7_DISK_HEADROOM'):
        required=int(os.environ['AI7_DISK_HEADROOM'])
        if shutil.disk_usage(ROOT).free < required + additional: raise RuntimeError('Disk headroom reached')
        return 0
    size = artifact_bytes(path)
    limit = int(os.environ.get("AI7_ARTIFACT_LIMIT_BYTES", HARD_ARTIFACT_BYTES))
    if limit <= 0:
        raise ValueError("Artifact byte limit must be positive")
    if size + additional > limit:
        raise RuntimeError(f"Artifact budget reached: {size} bytes")
    return size


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, indent=2, allow_nan=False) + "\n"
    guard_artifacts(ROOT / "benchmark-results/ai7-selfplay", additional=len(text.encode("utf-8")))
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text)
    temporary.replace(path)


def provenance(architecture="baseline"):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()
    paths = []
    for folder in ["scripts/ai7", "packages/game-core", "packages/ai-agents", "scripts/ai-eval", "apps/web/src/game"]:
        paths.extend(path for path in (ROOT / folder).rglob("*") if path.is_file() and "__pycache__" not in path.parts)
    paths.extend(ROOT / file for file in ["package.json", "pnpm-lock.yaml", "tsconfig.json", "vitest.config.ts"])
    return {
        "core_revision": CORE_REVISION, "source_revision": git("rev-parse", "HEAD"),
        "branch": git("branch", "--show-current"), "git_status": git("status", "--short"),
        "source_hashes": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(set(paths))},
        "architecture": ARCHITECTURES[architecture], "observation_version": OBSERVATION_VERSION,
        "python": platform.python_version(), "platform": platform.platform(), "torch": torch.__version__,
        "numpy": np.__version__, "mps_built": torch.backends.mps.is_built(), "mps_available": torch.backends.mps.is_available(),
        "cpu_count": os.cpu_count(),
        "dependencies": subprocess.check_output([str(Path(os.sys.executable)), "-m", "pip", "freeze"], text=True).splitlines(),
    }


def capture_rng(rng):
    return {
        "torch_rng": torch.get_rng_state().clone(),
        "numpy_rng": copy.deepcopy(np.random.get_state()), "python_rng": random.getstate(),
        "sampling_rng": copy.deepcopy(rng.bit_generator.state),
    }


def restore_rng(checkpoint, rng):
    torch.set_rng_state(checkpoint["torch_rng"])
    np.random.set_state(checkpoint["numpy_rng"])
    random.setstate(checkpoint["python_rng"])
    rng.bit_generator.state = checkpoint["sampling_rng"]


def save_checkpoint(path, model, optimizer, config, update, steps, rng, pool, opponents=None, training_state=None):
    architecture = model.config.get("architecture", "baseline")
    checkpoint = {
        "checkpoint_version": 2,
        "architecture": ARCHITECTURES[architecture], "observation_version": OBSERVATION_VERSION, "core_revision": CORE_REVISION,
        "model_config": model.config, "model": model.state_dict(), "optimizer": optimizer.state_dict(),
        "config": config, "update": update, "env_steps": steps, **capture_rng(rng),
        "opponent_pool": list(pool), "training_state": training_state,
        "opponent_models": {key: {"config": value.config, "model": value.state_dict()} for key, value in (opponents or {}).items()},
    }
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    payload = io.BytesIO()
    torch.save(checkpoint, payload)
    # The old checkpoint and complete temporary replacement coexist until the
    # atomic rename. Charge that peak, including embedded historical policies.
    guard_artifacts(ROOT / "benchmark-results/ai7-selfplay", additional=payload.getbuffer().nbytes)
    with temporary.open("wb") as file:
        file.write(payload.getbuffer())
    temporary.replace(path)


def load_checkpoint(path, device="cpu"):
    # Local experiment artifacts only. Torch's pickle loader must not read an untrusted checkpoint.
    checkpoint = torch.load(path, map_location="cpu", weights_only=False)
    architecture = checkpoint["model_config"].get("architecture", "baseline")
    if (checkpoint["core_revision"], checkpoint["architecture"], checkpoint["observation_version"]) != (CORE_REVISION, ARCHITECTURES.get(architecture), OBSERVATION_VERSION):
        raise ValueError("Checkpoint rules/architecture mismatch")
    # Inference loading must not perturb a trainer's RNG streams.
    before_rng = torch.get_rng_state()
    model = make_policy(checkpoint["model_config"]).to(device)
    model.load_state_dict(checkpoint["model"])
    model.eval()
    torch.set_rng_state(before_rng)
    return model, checkpoint


def restore_training_checkpoint(path, device="cpu"):
    model, checkpoint = load_checkpoint(path, device)
    if checkpoint.get("checkpoint_version", 1) < 2 or checkpoint.get("training_state") is None:
        raise ValueError("This checkpoint predates exact resume state")
    optimizer = torch.optim.Adam(model.parameters(), lr=checkpoint["config"]["learning_rate"], eps=1e-5)
    optimizer.load_state_dict(checkpoint["optimizer"])
    opponents = {}
    for key, data in checkpoint["opponent_models"].items():
        opponent = make_policy(data["config"]).to(device)
        opponent.load_state_dict(data["model"])
        opponents[key] = opponent.eval()
    if set(opponents) != set(checkpoint["opponent_pool"]):
        raise ValueError("Checkpoint historical pool is incomplete")
    rng = np.random.default_rng()
    restore_rng(checkpoint, rng)
    return model, optimizer, rng, list(checkpoint["opponent_pool"]), opponents, copy.deepcopy(checkpoint["training_state"]), checkpoint


def summarize(games):
    n = len(games)
    return {
        "completed": n,
        "wins": sum(game["return"] == 1 for game in games),
        "draws": sum(game["return"] == 0 for game in games),
        "losses": sum(game["return"] == -1 for game in games),
        "no_progress_rate": sum(game["result"]["reason"] == "NO_PROGRESS" for game in games) / n if n else None,
        "chase_stalemate_rate": sum(game["result"]["reason"] == "CHASE_STALEMATE" for game in games) / n if n else None,
        **{f"mean_{key}": float(np.mean([game[key] for game in games])) if n else None for key in ["plies", "captures", "flips", "hidden", "reversals", "repetitions"]},
        "ever_public_count_lead": {label: sum(game["everPublicCountLead"]["P1" if game["seat"] == 0 else "P2"] and game["return"] == value for game in games) for label, value in [("wins", 1), ("draws", 0), ("losses", -1)]},
    }
