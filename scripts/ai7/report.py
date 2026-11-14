"""Export standalone learning curves and a compact machine-readable metrics CSV."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--evaluation", type=Path, required=True)
    args = parser.parse_args()
    rows = [json.loads(line) for line in (args.run / "metrics.jsonl").read_text().splitlines()]
    evaluation = json.loads((args.evaluation / "summary.json").read_text())
    steps = [row["env_steps"] for row in rows]
    fig, axes = plt.subplots(2, 3, figsize=(14, 8), constrained_layout=True)
    fig.suptitle("AI-7 terminal-only PPO pilot · seed 7 · one training run", fontsize=16)
    axes[0, 0].plot(steps, [row["normalized_entropy"] for row in rows], color="#375ccc")
    axes[0, 0].set(title="Exploration", ylabel="Entropy / log(legal actions)", ylim=(0, 1.05))
    axes[0, 1].plot(steps, [row["approx_kl"] for row in rows], label="Approx. KL")
    axes[0, 1].plot(steps, [row["clip_fraction"] for row in rows], label="Clip fraction")
    axes[0, 1].set(title="PPO updates")
    axes[0, 1].legend()
    axes[0, 2].plot(steps, [row["value_loss"] for row in rows], label="Value MSE")
    axes[0, 2].plot(steps, [row["explained_variance"] for row in rows], label="Explained variance")
    axes[0, 2].set(title="Value prediction (not playing strength)")
    axes[0, 2].legend()
    axes[1, 0].plot(steps, [row["training_games"]["no_progress_rate"] for row in rows], label="NO_PROGRESS")
    axes[1, 0].plot(steps, [row["training_games"]["chase_stalemate_rate"] for row in rows], label="CHASE_STALEMATE")
    axes[1, 0].set(title="Self-play draws · 16 games per point", ylabel="Draw rate", ylim=(0, 1.05))
    axes[1, 0].legend()
    axes[1, 1].plot(steps, [row["training_games"]["mean_reversals"] for row in rows], label="Own-move reversals")
    axes[1, 1].plot(steps, [row["training_games"]["mean_repetitions"] for row in rows], label="Repeated public positions")
    axes[1, 1].set(title="Self-play repetition", ylabel="Mean per game")
    axes[1, 1].legend()
    random_results = [row for row in evaluation["matchups"] if row["opponent"] == "random"]
    xs = [row["training_env_steps"] for row in random_results]
    ys = [row["paired_score"]["score"] for row in random_results]
    lowers = [value - row["paired_score"]["lower"] for value, row in zip(ys, random_results)]
    uppers = [row["paired_score"]["upper"] - value for value, row in zip(ys, random_results)]
    axes[1, 2].errorbar(xs, ys, yerr=[lowers, uppers], marker="o", capsize=5, color="#158361")
    axes[1, 2].axhline(.5, color="gray", linestyle="--", linewidth=1)
    axes[1, 2].set(title="Held-out strength vs Uniform Random", ylabel="Paired score · 95% Hoeffding CI", ylim=(0, 1))
    for axis in axes.flat:
        axis.set_xlabel("Environment transitions")
        axis.grid(alpha=.18)
        axis.ticklabel_format(axis="x", style="sci", scilimits=(0, 0))
    fig.savefig(args.run / "learning-curves.png", dpi=160)
    fig.savefig(args.run / "learning-curves.svg")
    columns = ["update", "env_steps", "training_seconds", "policy_loss", "value_loss", "explained_variance", "entropy", "normalized_entropy", "approx_kl", "clip_fraction", "parameter_delta_l2", "env_steps_per_second", "inference_ms_per_decision"]
    with (args.run / "learning-curves.csv").open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        writer.writerows({key: row[key] for key in columns} for row in rows)


if __name__ == "__main__":
    main()
