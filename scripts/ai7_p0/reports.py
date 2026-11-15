"""Reports from evaluation outputs and existing logs; never runs training."""
import argparse
from collections import Counter
import json
from pathlib import Path
import statistics

from .common import INTEL, METHODS, SEEDS, ENDPOINTS, bundle, read, sha256, write

LABELS = {"baseline": "Baseline", "gae_lambda_095": "GAE-0.95", "chain_lite": "CHAIN-lite"}


def aggregate(reports):
    counts = {key: sum(r[key] for r in reports) for key in ["wins", "draws", "losses", "completed"]}
    n = counts["completed"]
    reasons = sum((Counter(r["terminal_reason_counts"]) for r in reports), Counter())
    lengths = [g["plies"] for r in reports for g in r["games"]]
    return {**counts, "win_rate": counts["wins"] / n, "draw_rate": counts["draws"] / n,
            "loss_rate": counts["losses"] / n, "score": (counts["wins"] + .5*counts["draws"]) / n,
            "no_progress_rate": reasons["NO_PROGRESS"] / n, "terminal_reasons": dict(reasons),
            "mean_plies": statistics.mean(lengths), "median_plies": statistics.median(lengths),
            "mean_repetitions": statistics.mean(g["repetitions"] for r in reports for g in r["games"]),
            "mean_reversals": statistics.mean(g["reversals"] for r in reports for g in r["games"])}


def interval(value, scale=100):
    return f"{scale*value['mean']:+.2f} [{scale*value['percentile95'][0]:+.2f}, {scale*value['percentile95'][1]:+.2f}]"


def performance(output, games=None):
    rows = []
    for method in METHODS:
        for seed in SEEDS:
            run = INTEL / "runs" / f"{method}-seed-{seed}"
            summary = read(run / "summary.json")
            metrics = [json.loads(line) for line in (run / "metrics.jsonl").read_text().splitlines()]
            rows.append({"method": method, "training_seed": seed, "env_steps": summary["env_steps"],
                         "wall_seconds_including_validation": summary["training_wall_seconds"],
                         "training_seconds_excluding_validation": summary["actual_training_seconds"],
                         "validation_seconds": summary["validation_seconds"], "rollout_seconds": sum(m["rollout_seconds"] for m in metrics),
                         "optimization_seconds": summary["optimization_seconds"], "updates": summary["updates"],
                         "optimizer_minibatch_steps": summary["optimizer_steps"],
                         "transitions_per_wall_second": summary["env_steps"] / summary["training_wall_seconds"],
                         "transitions_per_training_second": summary["env_steps"] / summary["actual_training_seconds"],
                         "PPO_updates_per_training_second": summary["updates"] / summary["actual_training_seconds"],
                         "optimizer_minibatch_steps_per_optimizer_second": summary["optimizer_steps"] / summary["optimization_seconds"],
                         "source_summary_sha256": sha256(run / "summary.json"), "source_metrics_sha256": sha256(run / "metrics.jsonl")})
    status = read(INTEL / "run-status.json")
    old_eval = []
    for pattern in ["evaluations/*/*-vs-*.json", "head-to-head/*/*-vs-*.json"]:
        old_eval.extend(read(p) for p in INTEL.glob(pattern))
    evaluations = {"original_Intel_evaluation": {"games": sum(r["completed"] for r in old_eval),
                   "collection_seconds": sum(r["seconds"] for r in old_eval),
                   "games_per_collection_second": sum(r["completed"] for r in old_eval) / sum(r["seconds"] for r in old_eval)}}
    if games:
        for opponent in ["random", "m1_exp2_baseline_4023"]:
            selected = [r for r in games["reports"] if r["opponent"] == opponent]
            seconds = sum(r["seconds"] for r in selected)
            evaluations[opponent] = {"games": sum(r["completed"] for r in selected), "collection_seconds": seconds,
                                     "games_per_collection_second": sum(r["completed"] for r in selected) / seconds,
                                     "transitions_per_collection_second": sum(g["plies"] for r in selected for g in r["games"]) / seconds}
    historical = read(output / "historical-checkpoint-evidence.json")
    result = {"Intel_runs": rows, "Intel_entire_campaign_wall_seconds": status["finished_epoch"] - status["started_epoch"],
              "Intel_node_environment": read(INTEL / "runs/baseline-seed-6011/manifest.json")["node_environment"],
              "evaluation_throughput_separate_from_training": evaluations,
              "M1_one_historical_checkpoint": historical, "M1_campaign_three_hours": "user-reported approximate duration; full timing logs absent",
              "qualification": "Historical M1 baseline is seed4023 from Exp2 with detailed instrumentation, versus Intel seeds6011/6023/6037 basic instrumentation. Dependency versions differ. No hardware-only speedup is identifiable."}
    write(output / "performance-results.json", result)
    lines = ["# Cross-machine performance accounting", "", "No new training was run. All training numbers below come from existing Intel summary.json / metrics.jsonl. PPO update means one rollout optimization pass; optimizer minibatch steps are a separate quantity.", "",
             "| Method | Seed | Wall min incl validation | Env transitions / wall s | PPO updates / train s | Rollout s | Optimizer s | Validation s |",
             "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for row in rows:
        lines.append(f"| {LABELS[row['method']]} | {row['training_seed']} | {row['wall_seconds_including_validation']/60:.2f} | {row['transitions_per_wall_second']:.1f} | {row['PPO_updates_per_training_second']:.3f} | {row['rollout_seconds']:.1f} | {row['optimization_seconds']:.1f} | {row['validation_seconds']:.1f} |")
    wall = result["Intel_entire_campaign_wall_seconds"] / 3600
    lines += ["", f"Intel whole campaign: {wall:.3f} hours, including nine training runs, original evaluation/diagnostics and reporting. The M1 approximately-three-hour figure is user-reported, not recovered from a nine-run timing log. The descriptive ratio is {wall/3:.2f}× elapsed time; this is not a hardware speed ratio.", "",
              f"Actual Intel simulation environment: `{result['Intel_node_environment']}`. Both Torch threads=2 and one interop thread were fixed; GameCore uses its single Node process.", "",
              "## One actual historical M1 timing record", "", f"The supplied original checkpoint contains this cumulative timing state: `{historical['timing_state']}`. This is a single older Exp2 Baseline seed4023 endpoint, not the current M1 five-treatment campaign. Its configuration/dependencies/instrumentation differ from Intel, so even this baseline comparison cannot isolate hardware alone.", "",
              "## Evaluation throughput", ""]
    for name, values in evaluations.items():
        lines.append(f"- {name}: {values['games']} games / {values['collection_seconds']:.2f} collection seconds = {values['games_per_collection_second']:.2f} games/s" + (f"; {values['transitions_per_collection_second']:.1f} transitions/s." if 'transitions_per_collection_second' in values else "."))
    lines += ["", "These exclude checkpoint/process startup where labeled collection time; training throughput includes the separately specified validation convention. Different learned policies change game lengths and Core work, so games/s alone is not a fair hardware comparison.", "",
              "To finish a matched baseline timing comparison, import original M1 campaign config.json, run-status.json, per-baseline summary.json/metrics.jsonl/manifest.json, dependency freeze, source fingerprints, CPU/thread settings and instrumentation schedule. Keep seeds/config differences explicit. No reserved tactical data is needed."]
    (output / "cross-machine-performance.md").write_text("\n".join(lines) + "\n")


def report(output):
    tactical = read(output / "tactical-results.json")
    games = read(output / "shared-opponent-results.json")
    plan = read(output / "plan.json")
    validation = read(output / "compatibility-validation.json")
    performance(output, games)
    tactical_lookup = {(r["checkpoint"]["method"], r["checkpoint"]["training_seed"], r["checkpoint"]["endpoint"]): r for r in tactical["reports"]}
    lines = ["# Independent tactical generalization", "", "Exact original M1 Stage2: 200 independent immediate-win positions and 200 immediate-defense positions, fully revealed, at most six live pieces. Original/rotated orientations are paired. No reserved bank was read, regenerated or evaluated. All 45 initial/intermediate/final Intel checkpoints were evaluated without model selection.", "",
             f"Bank SHA-256: `{plan['bank_sha256']}`. Actual per-checkpoint SHA-256, public-only probabilities, action ranks, argmax choices and per-position metrics are preserved in tactical-results.json and tactical-probabilities/*.npz. Plan/source/test evidence are in plan.json and compatibility-validation.json.", "",
             "## Final checkpoint descriptive means across three training seeds", "",
             "Target probability is winning-action mass for win positions and safe-action mass for defense positions. Top1 uses the complete correct-action set, with lowest numeric legal ID to resolve exact ties; best target rank is 1 plus the number of strictly more probable legal actions. Lower rank/gap/TV is better. Uniform probability is position-specific; the ratio column averages each position's target mass divided by its own uniform mass.", "",
             "| Method | Category | Target mass % | Uniform % | Top1 % | Best target rank | Mass / uniform | Symmetry gap pp | TV % |",
             "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    final_means = {}
    for method in METHODS:
        final_means[method] = {}
        for category in ["win", "defense"]:
            selected = [tactical_lookup[method, seed, "final"]["summary"][category] for seed in SEEDS]
            averages = {key: statistics.mean(r[key] for r in selected) for key in selected[0] if key != "positions"}
            final_means[method][category] = averages
            lines.append(f"| {LABELS[method]} | {category} | {100*averages['target_probability']:.2f} | {100*averages['uniform_mass']:.2f} | {100*averages['top1_accuracy']:.2f} | {averages['best_target_rank']:.2f} | {averages['probability_over_uniform']:.2f} | {100*averages['symmetry_gap']:.2f} | {100*averages['equivariance_tv']:.2f} |")
    lines += ["", "## Final treatment minus same-seed Baseline", "", "Paired position bootstrap: 4,000 resamples, seed91023; average orientations before resampling. Intervals are conditional on these fixed trained models. They are not uncertainty over training replications. All comparisons are exploratory and multiplicity is unadjusted.", "",
              "| Method | Seed | Category | Mass difference pp [95%] | Top1 difference pp [95%] | Rank difference [95%] | TV difference pp [95%] |",
              "| --- | ---: | --- | --- | --- | --- | --- |"]
    for row in tactical["matched_seed_contrasts"]:
        if row["endpoint"] != "final":
            continue
        values = row["differences"]
        lines.append(f"| {LABELS[row['method']]} | {row['training_seed']} | {row['category']} | {interval(values['target_probability'])} | {interval(values['top1_accuracy'])} | {interval(values['best_target_rank'],1)} | {interval(values['equivariance_tv'])} |")
    lines += ["", "## Learning trajectories, all predetermined checkpoints", "",
              "These are diagnostic trajectories on the same bank, not five independent confirmations or permission to choose the best checkpoint. Each row is one training replication. Values are mean correct-action probability across both orientations, percent.", "",
              "| Method | Seed | Category | Initial | 0.91M | 1.82M | 2.73M | Final 3.64M |",
              "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |"]
    for method in METHODS:
        for seed in SEEDS:
            for category in ["win", "defense"]:
                values = [100*tactical_lookup[method,seed,endpoint]["summary"][category]["target_probability"] for endpoint in ENDPOINTS]
                lines.append(f"| {LABELS[method]} | {seed} | {category} | " + " | ".join(f"{value:.2f}" for value in values) + " |")
    lines += ["", "Per-position adjacent and initial-to-checkpoint change intervals, original/rotated results, full masked-policy total variation and all three training-seed effect vectors are in tactical-results.json. Training replication n=3 remains separate from 200 source positions/category. The selected Random-play endgames do not establish broad Banqi strategy or long forced-defense competence.", "",
              "Reproduce: `python -B -m scripts.ai7_p0.tactical --output " + str(output) + "` in a fresh evaluation directory using the frozen plan; completed output is protected against accidental overwrite."]
    (output / "tactical-generalization-report.md").write_text("\n".join(lines) + "\n")

    aggregated = {}
    lines = ["# Shared historical opponent and new deck evaluation", "",
             f"Manifest SHA-256: `{plan['shared_evaluation_manifest_sha256']}`. Exact original historical checkpoint SHA-256: `{plan['historical_checkpoint_sha256']}`. All nine final policies are frozen. Both opponents use the same 256 new seeded decks and both seats, 512 games/model/opponent. No previous direct Intel head-to-head matches were rerun.", "",
             f"Historical tensor identity: original .pt loaded via `{validation['historical_original_load_method']}`; all eight tensors exactly equal the verified NPZ export. Intel inference agrees with M1 reference to max absolute probability error {validation['reference_max_abs_probability_error']:.3g}. Encoder, model class, action/environment bytes, Core/rules, deck and RNG compatibility were checked. Git revisions/dependencies differ, so this certifies common-runtime inference compatibility, not bit-identical cross-machine trajectories.", "",
             "The old Intel 14M decks overlap M1's curriculum-generation namespace. Old results remain Intel-internal evidence; they are not a shared independent final test. The new 20M proposal was fixed only after both accessible local manifests and the supplied M1 inventory were checked. The M1 inventory is exporter evidence; no claim is made to have independently opened all M1 original manifests.", ""]
    for opponent in ["random", "m1_exp2_baseline_4023"]:
        aggregated[opponent] = {}
        lines += [f"## Opponent: {opponent}", "", "These totals describe three training seeds; the independent learning-replication unit remains training seed, not the 1,536 games.", "",
                  "| Method | W/D/L | Win % | Draw % | Loss % | Score % | NO_PROGRESS % | Mean/median plies | Repetitions | Reversals |",
                  "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |"]
        for method in METHODS:
            row = aggregate([r for r in games["reports"] if r["opponent"] == opponent and r["method"] == method])
            aggregated[opponent][method] = row
            lines.append(f"| {LABELS[method]} | {row['wins']}/{row['draws']}/{row['losses']} | {100*row['win_rate']:.2f} | {100*row['draw_rate']:.2f} | {100*row['loss_rate']:.2f} | {100*row['score']:.2f} | {100*row['no_progress_rate']:.2f} | {row['mean_plies']:.1f}/{row['median_plies']:.1f} | {row['mean_repetitions']:.2f} | {row['mean_reversals']:.2f} |")
        lines += ["", "Terminal reasons: " + "; ".join(f"{LABELS[method]} `{aggregated[opponent][method]['terminal_reasons']}`" for method in METHODS) + "."]
        lines += ["", "| Treatment | Seed | W/D/L | Score delta vs matched Baseline pp [paired 95%] | Win/draw/loss delta pp | NO_PROGRESS delta pp |",
                  "| --- | ---: | --- | --- | --- | ---: |"]
        for row in games["matched_seed_contrasts"]:
            if row["opponent"] != opponent:
                continue
            r = next(r for r in games["reports"] if r["method"] == row["method"] and r["training_seed"] == row["training_seed"] and r["opponent"] == opponent)
            interval_values = row["score_difference"]["bootstrap95"]
            score = f"{100*row['score_difference']['difference']:+.2f} [{100*interval_values[0]:+.2f}, {100*interval_values[1]:+.2f}]"
            delta = "/".join(f"{100*row['rate_differences'][k]:+.2f}" for k in ["wins", "draws", "losses"])
            lines.append(f"| {LABELS[row['method']]} | {row['training_seed']} | {r['wins']}/{r['draws']}/{r['losses']} | {score} | {delta} | {100*row['no_progress_rate_difference']:+.2f} |")
    lines += ["", "Per-model seats, all terminal reasons, raw games, pair scores and errors/incomplete accounting are in shared-opponent-results.json. Score is (wins+0.5*draws)/completed. Pair both seats before 10,000 deck-bootstrap resamples, seed19. These conditional intervals do not turn games into independent training replications; the three training-seed contrasts are reported separately. All new benchmarks are exploratory follow-up evaluation, not retroactive preregistration.", "",
              "Reproduce: `python -B -m scripts.ai7_p0.games --output " + str(output) + "` using identical imported artifacts and frozen manifest in a fresh output directory."]
    (output / "historical-opponent-report.md").write_text("\n".join(lines) + "\n")
    write(output / "combined-summary.json", {"tactical_final_means": final_means, "game_benchmarks": aggregated})
    conclusion = ["# Combined research conclusion", "", "This evaluation adds an exact independent tactical bank and one identical historical opponent to the earlier Intel result. It does not train, fine-tune, select a replacement checkpoint, or run EV/AI-6A.", "",
                  "## 1. Independent immediate tactics and 2. action ranking", ""]
    for category in ["win", "defense"]:
        for method in METHODS[1:]:
            rows = [r for r in tactical["matched_seed_contrasts"] if r["method"] == method and r["category"] == category and r["endpoint"] == "final"]
            mass = [r["differences"]["target_probability"]["mean"] for r in rows]
            top1 = [r["differences"]["top1_accuracy"]["mean"] for r in rows]
            ranks = [r["differences"]["best_target_rank"]["mean"] for r in rows]
            conclusion.append(f"- {LABELS[method]}, {category}: matched-seed probability-mass differences pp = {[round(100*v,2) for v in mass]}; top1 differences pp = {[round(100*v,2) for v in top1]}; rank differences = {[round(v,3) for v in ranks]} (negative rank difference is better). Assess each alongside conditional CIs in tactical-generalization-report.md; a sampling-mass change is distinct from a greedy-choice change.")
    conclusion += ["", "## 3. Ability across intermediate checkpoints", "", "All five predetermined endpoints were evaluated. The complete trajectory table and adjacent paired intervals are retained. An isolated highest intermediate value is not a selected model or evidence of a lasting final improvement. See tactical-generalization-report.md; source positions are paired across checkpoints.", "",
                   "## 4. Common historical opponent and 5. NO_PROGRESS", ""]
    for opponent, methods in aggregated.items():
        base = methods["baseline"]
        for method in METHODS[1:]:
            treated = methods[method]
            deltas = {metric: 100*(treated[metric]-base[metric]) for metric in ["win_rate", "draw_rate", "loss_rate", "score", "no_progress_rate"]}
            per_seed = [row["score_difference"]["difference"] for row in games["matched_seed_contrasts"] if row["opponent"] == opponent and row["method"] == method]
            conclusion.append(f"- {LABELS[method]} vs {opponent}: aggregate descriptive deltas pp = {deltas}; three separate training-seed score differences pp = {[round(100*v,2) for v in per_seed]}. Changes in wins, losses and NO_PROGRESS are separate outcomes; aggregate score alone does not establish opponent-general improvement.")
    conclusion += ["", "## 6. Timing", "", "Intel's original complete campaign duration is measured; the approximately-three-hour M1 campaign duration remains user-reported. One actual M1 historical baseline timing record is available from its original checkpoint, with configuration and instrumentation qualifications. Full baseline timing logs from comparable M1 runs are not supplied. A pure hardware speed ratio is not established. See cross-machine-performance.md.", "",
                   "## 7. Next controlled training experiment", "", "Use the observed game and tactical effects jointly to choose a single predeclared question. Replicate GAE-0.95 on additional fresh training seeds and fresh confirmation decks before adoption. If game gains coexist with tactical weakness, separate reward-credit/critic calibration from immediate action-ranking competence using new training-generated diagnostics and a fixed common terminal-return calibration set. Do not tune on this tactical bank or new final-test results and then call them independent confirmation. Keep the reserved 100+100 bank untouched until a separately fixed confirmation protocol. CHAIN-lite conclusions apply only to this alpha/reference design; no claim about the entire published CHAIN method follows.", "",
                   "Inputs are identified in import-validation.json, compatibility-validation.json, plan.json, and shared-evaluation-manifest.sha256. Exact per-checkpoint hashes are retained. No existing training artifacts were modified."]
    (output / "combined-research-conclusion.md").write_text("\n".join(conclusion) + "\n")
    contract = ["# Remaining M1 import contract", "", "Tactical Stage2 and the exact historical opponent are now present and evaluated. No reserved or confirmation bank is required or requested.", "",
                "For full timing and current-campaign comparisons, supply original M1 campaign config.json, source-provenance manifest/source snapshot, run-status.json, dependency freeze, and per-Baseline manifest.json/summary.json/metrics.jsonl. Preserve original paths and SHA-256. State actual training seeds, step targets, thread counts, instrumentation and validation/checkpoint schedule. The exported seed inventory references current M1 runs with 5011/5023/5037; this is different from the earlier intended 6011/6023/6037 and requires explicit disclosure, not relabeling.", "",
                "To run the common benchmark on M1, transfer shared-evaluation-manifest.json with its SHA-256, the verified historical opponent bytes/NPZ schema, and the frozen evaluation-source snapshot. Verify critical runtime hashes and reference outputs. Use exactly its 256 deck seeds and both seats. Return per-model SHA-256, raw per-game results keyed by deck/seat, metrics, runtime versions and source evidence. Do not substitute a local latest opponent or modify seeds after results."]
    (output / "m1-import-contract.md").write_text("\n".join(contract) + "\n")
    write(output / "output-checksums.json", {path.name: sha256(path) for path in sorted(output.glob("*")) if path.is_file() and path.name != "output-checksums.json"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report(args.output.resolve())


if __name__ == "__main__":
    main()
