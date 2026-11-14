"""Evaluation-only probes and replication-level overnight research reports.

This module is never imported by PPO. Probe classifications cannot become training
labels, rewards, or model features: inference receives only each public observation.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np
import torch

from .runtime import Bridge, ROOT, encode, load_checkpoint, mask_array, seed_all, write_json


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {} if default is None else default


def metric_rows(path):
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return []
    rows = []
    for line in lines:
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            # A final incomplete line from a failed writer is not a completed update.
            continue
    return rows


def last_metric(rows, name):
    return next((row[name] for row in reversed(rows) if row.get(name) is not None), None)


def seed_statistics(values, low=-1.0, high=1.0):
    """Training seeds, not individual games, are independent replications.

    The Student t interval is explicitly exploratory with three seeds; a bounded
    Hoeffding interval is also given and is usually wide. No pooled-game shortcut.
    """
    values = [float(value) for value in values if value is not None]
    n = len(values)
    if not n:
        return {"replications": 0, "mean": None, "t95": None, "hoeffding95": None}
    mean = float(np.mean(values))
    if n < 2:
        t_interval = None
    else:
        critical = {2: 12.7062047364, 3: 4.30265272975, 4: 3.18244630528}.get(n, 2.7764451052 if n == 5 else 1.96)
        radius = critical * float(np.std(values, ddof=1)) / math.sqrt(n)
        t_interval = [mean - radius, mean + radius]
        if low is not None and high is not None:
            t_interval = [max(low, t_interval[0]), min(high, t_interval[1])]
    radius = None if low is None or high is None else (high - low) * math.sqrt(math.log(40) / (2 * n))
    return {
        "replications": n, "mean": mean, "values": values,
        "t95": t_interval, "hoeffding95": None if radius is None else [max(low, mean - radius), min(high, mean + radius)],
        "assumptions": "Student t uses independent training seeds and approximate normality; n=3 is fragile. Hoeffding uses only bounded independent seed-level observations.",
    }


def probe_policy(model, suite, device="cpu", deadline=float("inf")):
    results = []
    for probe in suite["probes"]:
        if time.time() >= deadline:
            break
        observation = probe["observation"]
        features = torch.from_numpy(encode(observation)).unsqueeze(0).to(device)
        masks = torch.from_numpy(mask_array([observation])).to(device)
        with torch.no_grad():
            distribution, value = model(features, masks)
            probabilities = distribution.probs[0].cpu().numpy()
        groups = {}
        for name, actions in probe["groups"].items():
            groups[name] = {
                "applicable": bool(actions), "actions": actions,
                "mass": float(probabilities[actions].sum()) if actions else None,
                "uniform_mass": len(actions) / len(observation["legal"]) if actions else None,
            }
        risks = {int(action): risk for action, risk in probe["immediateLossRisk"].items()}
        results.append({
            "id": probe["id"], "category": probe["category"], "legal_actions": len(observation["legal"]),
            "groups": groups, "value": float(value.item()),
            "expected_immediate_loss_risk": float(sum(probabilities[action] * risk for action, risk in risks.items())),
            "uniform_immediate_loss_risk": float(np.mean(list(risks.values()))),
            "interpretation": probe["interpretation"],
        })
    names = sorted({name for probe in results for name in probe["groups"]})
    summary = {}
    for name in names:
        applicable = [probe["groups"][name] for probe in results if probe["groups"][name]["applicable"]]
        summary[name] = {
            "positions": len(applicable),
            "mean_mass": float(np.mean([group["mass"] for group in applicable])) if applicable else None,
            "mean_uniform_mass": float(np.mean([group["uniform_mass"] for group in applicable])) if applicable else None,
        }
    return {"completed": len(results), "planned": len(suite["probes"]), "summary": summary, "positions": results}


def run_probes(checkpoint, initial_checkpoint, output, deadline_epoch=None, device="cpu"):
    output = output.resolve()
    if not output.is_relative_to(ROOT / "benchmark-results/ai7-selfplay"):
        raise ValueError("Probe artifacts must be inside the AI-7 experiment tree")
    if output.exists():
        raise FileExistsError(output)
    seed_all(19)
    deadline = float("inf") if deadline_epoch is None else deadline_epoch
    bridge = Bridge(output.parent / (output.stem + "-bridge"))
    try:
        suite = bridge.request(command="probes")
        report = {"evaluation_only": True, "version": suite["version"], "setup": suite["setup"], "metadata": bridge.metadata, "deadline_epoch": deadline_epoch}
        for label, path in [("initial", initial_checkpoint), ("final", checkpoint)]:
            if path is None or time.time() >= deadline:
                continue
            model, metadata = load_checkpoint(path, device)
            report[label] = {
                **probe_policy(model, suite, device, deadline), "checkpoint": str(path.resolve()),
                "checkpoint_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "architecture": metadata.get("model_config", {}).get("architecture", "baseline"),
                "training_env_steps": metadata["env_steps"],
            }
        if "initial" in report and "final" in report:
            report["delta"] = {
                name: report["final"]["summary"][name]["mean_mass"] - initial["mean_mass"]
                for name, initial in report["initial"]["summary"].items()
                if initial["mean_mass"] is not None and report["final"]["summary"].get(name, {}).get("mean_mass") is not None
            }
        report["deadline_reached"] = time.time() >= deadline
        write_json(output, report)
        return report
    finally:
        bridge.close()


def comparison_rows(campaign, config, status):
    statuses = {run["id"]: run for run in status.get("runs", [])}
    rows = []
    for job in config.get("jobs", []):
        run_id = job["id"]
        run = campaign / "runs" / run_id
        state = statuses.get(run_id, {})
        manifest = read_json(run / "manifest.json")
        training = read_json(run / "summary.json")
        metrics = metric_rows(run / "metrics.jsonl")
        evaluation = read_json(campaign / "evaluations" / run_id / "summary.json")
        probes = read_json(campaign / "probes" / f"{run_id}.json")
        matchups = [entry for entry in evaluation.get("matchups", []) if entry.get("opponent") == "random"]
        initial = next((entry for entry in matchups if entry["checkpoint"] == "initial"), {})
        final = next((entry for entry in matchups if entry["checkpoint"] == "final"), {})
        delta = next((entry for entry in evaluation.get("comparisons", []) if entry.get("opponent") == "random" and entry.get("trained") == "final"), {})
        interval = delta.get("bootstrap95") or [None, None]
        row = {
            "run_id": run_id, "architecture": job["architecture"], "training_seed": job["seed"],
            "training_state": state.get("training", {}).get("state", "pending"),
            "evaluation_state": state.get("evaluation", {}).get("state", "pending"),
            "probes_state": state.get("probes", {}).get("state", "pending"),
            "parameter_count": training.get("parameter_count", training.get("parameters", manifest.get("parameter_count", manifest.get("parameters")))),
            "model_config": training.get("model_config", manifest.get("model_config")),
            "training_steps": training.get("env_steps", last_metric(metrics, "env_steps")),
            "training_games": training.get("completed_games"),
            "training_attempted_games": training.get("attempted_games"),
            "ppo_updates": training.get("updates", last_metric(metrics, "update")),
            "training_wall_seconds": training.get("training_wall_seconds"),
            "actual_training_seconds": training.get("actual_training_seconds"),
            "final_explained_variance": last_metric(metrics, "explained_variance"),
            "final_normalized_entropy": last_metric(metrics, "normalized_entropy"),
            "final_value_loss": last_metric(metrics, "value_loss"),
            "final_approx_kl": last_metric(metrics, "approx_kl"),
            "final_clip_fraction": last_metric(metrics, "clip_fraction"),
            "self_play_no_progress_rate": next((entry["training_games"]["no_progress_rate"] for entry in reversed(metrics) if entry.get("training_games", {}).get("no_progress_rate") is not None), None),
            "self_play_repeated_positions": next((entry["training_games"]["mean_repetitions"] for entry in reversed(metrics) if entry.get("training_games", {}).get("mean_repetitions") is not None), None),
            "self_play_own_move_reversals": next((entry["training_games"]["mean_reversals"] for entry in reversed(metrics) if entry.get("training_games", {}).get("mean_reversals") is not None), None),
            "training_steps_per_second": mean_metric(metrics, "env_steps_per_second"),
            "inference_ms_per_decision": training.get("inference_ms_per_decision", last_metric(metrics, "inference_ms_per_decision")),
            "initial_paired_score": initial.get("paired_score", {}).get("score"),
            "final_paired_score": final.get("paired_score", {}).get("score"),
            "score_improvement": delta.get("difference"),
            "improvement_ci_low": interval[0], "improvement_ci_high": interval[1],
            "improvement_hoeffding95": delta.get("hoeffding95"),
            "initial_completed": initial.get("completed"), "initial_attempted": initial.get("attempted"),
            "final_completed": final.get("completed"), "final_attempted": final.get("attempted"),
            "initial_wins": initial.get("wins"), "initial_draws": initial.get("draws"), "initial_losses": initial.get("losses"),
            "initial_planned": initial.get("planned"), "initial_skipped": initial.get("skipped"),
            "final_planned": final.get("planned"), "final_skipped": final.get("skipped"),
            "final_wins": final.get("wins"), "final_draws": final.get("draws"), "final_losses": final.get("losses"),
            "no_progress_rate": final.get("no_progress_rate"), "initial_no_progress_rate": initial.get("no_progress_rate"),
            "chase_stalemate_rate": final.get("chase_stalemate_rate"),
            "repeated_positions": final.get("mean_repetitions"), "initial_repeated_positions": initial.get("mean_repetitions"),
            "own_move_reversals": final.get("mean_reversals"), "initial_own_move_reversals": initial.get("mean_reversals"),
            "hidden_at_termination": final.get("mean_hidden"),
        }
        for name, result in probes.get("final", {}).get("summary", {}).items():
            row[f"probe_{name}_mass"] = result.get("mean_mass")
            row[f"probe_{name}_delta"] = probes.get("delta", {}).get(name)
        rows.append(row)
    return rows


def mean_metric(rows, key):
    values = [row[key] for row in rows if row.get(key) is not None]
    return float(np.mean(values)) if values else None


def aggregate_rows(rows, config):
    aggregates = {}
    planned = config.get("target_env_steps")
    pairs = config.get("evaluation_pairs", 128)
    for architecture in config.get("architectures", ["baseline", "critic", "cnn"]):
        candidates = [row for row in rows if row["architecture"] == architecture]
        qualified = [row for row in candidates if row.get("training_steps") == planned and row.get("initial_completed") == 2 * pairs and row.get("final_completed") == 2 * pairs and row.get("score_improvement") is not None]
        aggregates[architecture] = {
            "planned_replications": len(candidates), "complete_comparable_replications": len(qualified),
            "training_seeds": [row["training_seed"] for row in qualified],
            "initial_score": seed_statistics([row["initial_paired_score"] for row in qualified], 0, 1),
            "final_score": seed_statistics([row["final_paired_score"] for row in qualified], 0, 1),
            "improvement": seed_statistics([row["score_improvement"] for row in qualified]),
            "seeds_with_positive_point_estimate": sum(row.get("score_improvement", 0) > 0 for row in qualified),
            "seeds_with_bootstrap_ci_above_zero": sum(row.get("improvement_ci_low") is not None and row["improvement_ci_low"] > 0 for row in qualified),
            "final_explained_variance": seed_statistics([row["final_explained_variance"] for row in qualified], None, None),
            "no_progress_rate": seed_statistics([row["no_progress_rate"] for row in qualified], 0, 1),
            "interpretation": "Training seeds are the independent replication unit. Three seeds provide limited precision; no winner is selected by the highest point estimate.",
        }
        aggregate = aggregates[architecture]
        estimate = aggregate["improvement"]
        if len(qualified) < len(candidates):
            assessment = "Incomplete independent-seed comparison; reliable improvement is not established."
        elif qualified and aggregate["seeds_with_bootstrap_ci_above_zero"] == len(qualified) and estimate["t95"] and estimate["t95"][0] > 0:
            assessment = "Preliminary replicated improvement: every seed's paired interval and the exploratory seed-level t interval are positive. Intervals are unadjusted for multiple comparisons; this is not a familywise confirmatory claim."
        elif qualified and aggregate["seeds_with_positive_point_estimate"] == len(qualified):
            assessment = "Consistent positive point estimates, but improvement remains statistically inconclusive across the required evidence checks."
        else:
            assessment = "No consistent positive learning effect established across independent training seeds."
        aggregate["evidence_assessment"] = assessment
        for name, final_key, initial_key in [
            ("no_progress_change", "no_progress_rate", "initial_no_progress_rate"),
            ("repetition_change", "repeated_positions", "initial_repeated_positions"),
            ("reversal_change", "own_move_reversals", "initial_own_move_reversals"),
        ]:
            changes = [row[final_key] - row[initial_key] for row in qualified if row.get(final_key) is not None and row.get(initial_key) is not None]
            aggregate[name] = seed_statistics(changes, None, None)
        probe_keys = sorted({key for row in qualified for key in row if key.startswith("probe_") and key.endswith("_delta")})
        aggregate["probe_probability_changes"] = {key: seed_statistics([row.get(key) for row in qualified]) for key in probe_keys}
    differences = {}
    for architecture in ["critic", "cnn"]:
        values = []
        variance = []
        for seed in config.get("seeds", [11, 23, 37]):
            baseline = next((row for row in rows if row["architecture"] == "baseline" and row["training_seed"] == seed), {})
            candidate = next((row for row in rows if row["architecture"] == architecture and row["training_seed"] == seed), {})
            if baseline.get("training_steps") != planned or candidate.get("training_steps") != planned:
                continue
            if any(row.get("initial_completed") != 2 * pairs or row.get("final_completed") != 2 * pairs for row in [baseline, candidate]):
                continue
            if baseline.get("final_paired_score") is not None and candidate.get("final_paired_score") is not None:
                values.append(candidate["final_paired_score"] - baseline["final_paired_score"])
            if baseline.get("final_explained_variance") is not None and candidate.get("final_explained_variance") is not None:
                variance.append(candidate["final_explained_variance"] - baseline["final_explained_variance"])
        differences[f"{architecture}_minus_baseline"] = {
            "final_score": seed_statistics(values),
            "explained_variance": seed_statistics(variance, None, None),
        }
    return aggregates, differences


def format_value(value, percent=False):
    if value is None:
        return "pending"
    return f"{100 * value:.2f}%" if percent else f"{value:.3f}"


def format_delta(value):
    return "pending" if value is None else f"{100 * value:.2f} pp"


def plot_curves(campaign, config, rows):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    colors = {"baseline": "#375ccc", "critic": "#cf7133", "cnn": "#168569"}
    fig, axes = plt.subplots(2, 4, figsize=(17, 8), constrained_layout=True)
    fig.suptitle("AI-7 controlled architecture comparison · training seeds 11, 23, 37")
    panels = [("explained_variance", "Value explained variance"), ("normalized_entropy", "Normalized policy entropy"), ("env_steps_per_second", "Collection throughput (steps/s)"), ("validation_score", "Independent validation score (8 pairs)"), ("no_progress_rate", "Self-play NO_PROGRESS rate"), ("mean_repetitions", "Self-play repeated public positions"), ("mean_reversals", "Self-play own-move reversals")]
    for row in rows:
        metrics = metric_rows(campaign / "runs" / row["run_id"] / "metrics.jsonl")
        for axis, (key, title) in zip(axes.flat, panels):
            if key == "validation_score":
                validations = [read_json(path) for path in (campaign / "runs" / row["run_id"]).glob("validation-*.json")]
                points = sorted((entry.get("env_steps", 0), (entry["wins"] + .5 * entry["draws"]) / entry["completed"]) for entry in validations if entry.get("completed"))
            else:
                points = [(entry["env_steps"], entry.get(key, entry.get("training_games", {}).get(key))) for entry in metrics]
            points = [(x, y) for x, y in points if y is not None]
            if points:
                axis.plot([x for x, _ in points], [y for _, y in points], color=colors[row["architecture"]], alpha=.45, linewidth=.9)
            axis.set(title=title, xlabel="Environment transitions")
            axis.grid(alpha=.15)
    final_axis = axes[1, 3]
    for index, row in enumerate(rows):
        value = row.get("final_paired_score")
        if value is not None:
            architecture_index = config.get("architectures", ["baseline", "critic", "cnn"]).index(row["architecture"])
            jitter = (config.get("seeds", [11, 23, 37]).index(row["training_seed"]) - 1) * .08
            final_axis.scatter(architecture_index + jitter, value, color=colors[row["architecture"]], s=35)
            if row.get("initial_paired_score") is not None:
                final_axis.scatter(architecture_index + jitter, row["initial_paired_score"], facecolors="none", edgecolors=colors[row["architecture"]], s=35)
    final_axis.set(title="Random score per independent seed", ylabel="Filled=final; open=initial", ylim=(0, 1), xticks=[0, 1, 2], xticklabels=["MLP", "Critic", "CNN"])
    final_axis.axhline(.5, color="gray", linestyle="--", linewidth=1)
    final_axis.grid(alpha=.15)
    for architecture, color in colors.items():
        axes[0, 0].plot([], [], color=color, label=architecture)
    axes[0, 0].legend()
    fig.savefig(campaign / "learning-curves.png", dpi=150)
    plt.close(fig)


def build_report(campaign):
    campaign = campaign.resolve()
    config = read_json(campaign / "config.json")
    status = read_json(campaign / "run-status.json")
    rows = comparison_rows(campaign, config, status)
    aggregates, differences = aggregate_rows(rows, config)
    phase = status.get("state", status.get("phase", "pending"))
    result = {"schema_version": 1, "generated_epoch": time.time(), "phase": phase, "target_env_steps": config.get("target_env_steps"), "rows": rows, "aggregates": aggregates, "matched_training_seed_architecture_differences": differences, "statistical_unit": "independent training seed; paired deck games quantify each fixed policy only"}
    write_json(campaign / "comparison.json", result)
    columns = list(dict.fromkeys(key for row in rows for key in row))
    with (campaign / "comparison.csv").open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        writer.writerows({key: json.dumps(value, sort_keys=True) if isinstance(value, (dict, list)) else value for key, value in row.items()} for row in rows)
    lines = ["# AI-7 overnight architecture comparison", "", f"Campaign phase: **{phase}**. Common training target: **{config.get('target_env_steps', 'pending')} environment transitions per run**.", "", "Terminal rewards remain +1/0/−1. Core, observations, action masks, PPO hyperparameters and opponent mixture are shared; only model architecture differs. Results below distinguish incomplete work from completed evidence.", "", "| Architecture | Seed | Train state | Steps | Initial score | Final score | Difference | Paired bootstrap 95% CI |", "| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |"]
    for row in rows:
        interval = "pending" if row["improvement_ci_low"] is None else f"[{100 * row['improvement_ci_low']:.2f}, {100 * row['improvement_ci_high']:.2f}] pp"
        lines.append(f"| {row['architecture']} | {row['training_seed']} | {row['training_state']} | {row['training_steps'] if row['training_steps'] is not None else 'pending'} | {format_value(row['initial_paired_score'], True)} | {format_value(row['final_paired_score'], True)} | {format_delta(row['score_improvement'])} | {interval} |")
    lines += ["", "## Independent training-seed replication", "", "| Architecture | Comparable completed seeds | Mean improvement | Exploratory seed-level t 95% CI | Positive individual CIs |", "| --- | ---: | ---: | --- | ---: |"]
    for architecture, summary in aggregates.items():
        estimate = summary["improvement"]
        interval = estimate.get("t95")
        ci = "unavailable" if interval is None else f"[{100*interval[0]:.2f}, {100*interval[1]:.2f}] pp"
        lines.append(f"| {architecture} | {summary['complete_comparable_replications']}/{summary['planned_replications']} | {format_delta(estimate['mean'])} | {ci} | {summary['seeds_with_bootstrap_ci_above_zero']} |")
    lines += ["", "Training seed, not individual game, is the replication unit. With only three seeds, t intervals depend strongly on approximate normality; conservative bounded-seed intervals are also in comparison.json. Individual 128-pair policy confidence intervals do not turn thousands of games into thousands of independent learning experiments. No architecture winner is declared from the highest observed score.", "", "## Direct research answers", ""]
    completed = sum(value["complete_comparable_replications"] for value in aggregates.values())
    if completed < len(config.get("jobs", [])):
        lines.append(f"Only {completed}/{len(config.get('jobs', []))} runs currently have a complete equal-budget initial/final Random comparison. Conclusions remain provisional; pending/failed/skipped runs are retained in run-status.json.")
    for architecture, summary in aggregates.items():
        n = summary["complete_comparable_replications"]
        lines.append(f"- **{architecture} learning:** {summary['seeds_with_positive_point_estimate']}/{n} completed seeds have a positive improvement point estimate; {summary['seeds_with_bootstrap_ci_above_zero']}/{n} have an individual paired bootstrap interval above zero. This is reported alongside replication-level intervals, not a claim based on loss reduction.")
        lines.append(f"  {summary['evidence_assessment']}")
    for architecture in ["critic", "cnn"]:
        matched = differences[f"{architecture}_minus_baseline"]
        lines.append(f"- **{architecture} versus MLP:** matched-seed final score difference mean {format_delta(matched['final_score']['mean'])}; explained-variance difference {format_value(matched['explained_variance']['mean'])}. Compare their intervals in comparison.json. Better value fit alone does not establish stronger play. CNN efficiency is compared at the same transition endpoint; curves show optimization and cost, not unobserved between-checkpoint playing strength.")
    lines += ["- **Tactical/endgame evidence:** probe results measure categorical action probability on eight frozen Core-validated positions. Compare initial/final masses in comparison.csv/json. Immediate captures are not necessarily good captures; endgame/repetition probes test one-move terminal conversion, not general coordination or multi-move endgames.", "- **FLIP risk:** labels use publicly remaining inventory and all possible reveals, then check an opponent's immediate terminal winning MOVE. They never use actual hidden identities. This narrow risk metric cannot judge long-horizon FLIP quality.", "- **Repetition/draw-seeking:** initial/final NO_PROGRESS, repeated public positions, and own-move reversals are recorded per run. Higher repetition alone is not evidence of intent. High score through draws must be separated from improved winning conversion.", "", "## Limits and next experiment", "", "No probe, validation, or held-out result feeds training or selects a replacement architecture. No reward shaping or baseline promotion is performed. A reliable advantage requires consistent independent seeds, positive paired evidence, and compatible replication-level uncertainty; all inconclusive cases remain inconclusive. Next prioritize a preregistered replication of any consistent effect on fresh deck seeds, or an unchanged-reward failure analysis of exploration, critic predictions and conversion if no effect is supported.", "", "## Replay examples", ""]
    examples = sorted((campaign / "evaluations").glob("*/replays/final-*.json"))[:6]
    if not examples:
        lines.append("No final-policy replay archives are available yet.")
    for path in examples:
        archive = read_json(path)
        description = archive.get("summary", {})
        lines.append(f"- `{path.relative_to(campaign)}` — {description.get('plies', '?')} plies, result {json.dumps(description.get('result'))}; deterministic Core replay verified by the archive writer.")
    lines += ["", "Full configurations and source hashes are in config.json/source fingerprints and each run manifest. comparison.csv/json include completed/attempted denominators, cost, entropy, value diagnostics, draw/repetition metrics and evaluation-only probe masses. Missing values remain empty/pending.", ""]
    (campaign / "overnight-summary.md").write_text("\n".join(lines))
    plot_curves(campaign, config, rows)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign", type=Path)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--initial-checkpoint", type=Path)
    parser.add_argument("--probe-output", type=Path)
    parser.add_argument("--deadline-epoch", type=float)
    parser.add_argument("--device", choices=["cpu", "mps"], default="cpu")
    args = parser.parse_args()
    if args.campaign:
        build_report(args.campaign)
    elif args.checkpoint and args.probe_output:
        run_probes(args.checkpoint, args.initial_checkpoint, args.probe_output, args.deadline_epoch, args.device)
    else:
        parser.error("Use --campaign PATH or --checkpoint PATH --probe-output PATH")


if __name__ == "__main__":
    main()
