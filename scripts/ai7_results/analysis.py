"""Analyze validated historical results without loading checkpoints."""
from collections import defaultdict
import statistics

from .records import metrics, outcome


def score_pairs(rows, opponent):
    values = defaultdict(list)
    for row in rows:
        if row["opponent"] == opponent:
            game = row["game"]
            values[game["seed"]].append({"wins": 1, "draws": .5, "losses": 0}[outcome(game)])
    return {deck: sum(legs) / 2 for deck, legs in values.items()}


def analyze(study, study_runs, events, findings):
    from scripts.ai7.evaluate import paired_difference

    grouped = defaultdict(list)
    summaries = []
    for manifest, rows, status in study_runs:
        derived = metrics(rows)
        summaries.append({"run": manifest, "validation": status, "metrics": derived})
        if not status["aggregation_eligible"]:
            findings.append({"run_id": manifest["run_id"], "reason": "partial_or_unpaired_excluded"})
            continue
        grouped[manifest["cohort_id"], manifest["pair_id"], manifest["treatment"]].append((manifest, rows, derived))

    contrasts = []
    for cohort_id, cohort in study["cohorts"].items():
        baseline = cohort["baseline"]
        for pair_id, assignment in cohort["pairs"].items():
            found = {m: grouped[cohort_id, pair_id, m] for m in cohort["treatments"]}
            for treatment, runs in found.items():
                if len(runs) != 1:
                    findings.append({"cohort_id": cohort_id, "pair_id": pair_id, "treatment": treatment,
                                     "reason": "missing_pair_member" if not runs else "ambiguous_pair_member"})
            if len(found[baseline]) != 1:
                continue
            base, base_rows, base_metrics = found[baseline][0]
            for treatment, runs in found.items():
                if treatment == baseline or len(runs) != 1:
                    continue
                candidate, rows, derived = runs[0]
                for opponent, values in derived.items():
                    comparison = paired_difference(score_pairs(base_rows, opponent), score_pairs(rows, opponent))
                    old = base_metrics[opponent]
                    contrasts.append({"cohort_id": cohort_id, "pair_id": pair_id, **assignment,
                                      "treatment": treatment, "baseline": baseline, "opponent": opponent,
                                      "baseline_run_id": base["run_id"], "run_id": candidate["run_id"],
                                      "paired_deck": comparison,
                                      "rate_differences": {
                                          key: values[key]/values["completed"] - old[key]/old["completed"]
                                          for key in ("wins", "draws", "losses")
                                      } | {"no_progress": values["no_progress_rate"] - old["no_progress_rate"]}})
    seed_groups = defaultdict(list)
    for row in contrasts:
        seed_groups[row["cohort_id"], row["treatment"], row["opponent"]].append(row)
    seed_effects = []
    for (cohort, treatment, opponent), rows in sorted(seed_groups.items()):
        effects = [row["paired_deck"]["difference"] for row in rows]
        mean = statistics.mean(effects)
        sd = statistics.stdev(effects) if len(effects) > 1 else None
        interval = None
        boot = None
        if len(effects) > 1:
            seed_values = dict(enumerate(effects))
            boot = paired_difference(dict.fromkeys(seed_values, 0.0), seed_values)["bootstrap95"]
        # Exact small-sample t critical values for the usual research cohorts.
        critical = {2: 12.706204736, 3: 4.302652730, 4: 3.182446305, 5: 2.776445105}
        if len(effects) in critical:
            radius = critical[len(effects)] * sd / len(effects)**.5
            interval = [mean - radius, mean + radius]
        seed_effects.append({"cohort_id": cohort, "treatment": treatment, "opponent": opponent,
                             "n": len(effects), "effects": effects,
                             "training_seeds": [row["training_seed"] for row in rows],
                             "mean": mean, "sample_sd": sd, "paired_training_seed_t95": interval, "paired_training_seed_bootstrap95": boot,
                             "planned_pairs": len(study["cohorts"][cohort]["pairs"]),
                             "qualification": "Available matched training seeds; exploratory t interval for n=2–5, normal effect assumption"})
    return {"study_id": study["study_id"], "protocol_sha256": study["protocol_sha256"],
            "dataset_id": study["dataset_id"], "dataset_role": study["dataset_role"],
            "dataset_usage": [e for e in events if e["dataset_id"] == study["dataset_id"]],
            "runs": summaries, "findings": findings, "contrasts": contrasts, "training_seed_effects": seed_effects}


def markdown(report):
    lines = [f"# {report['study_id']}", "",
             f"Dataset role **{report['dataset_role']}**. The analysis uses recorded paired games.",
             "Deck intervals are conditional on a fixed trained model pair. Training-seed effects use independent trained seeds (t95 for 2–5 pairs, bootstrap for larger cohorts).",
             "", "| Cohort | Treatment | Seed | Opponent | W/D/L | Score | NO_PROGRESS |",
             "| --- | --- | ---: | --- | --- | ---: | ---: |"]
    for row in report["runs"]:
        if not row["validation"]["aggregation_eligible"]:
            continue
        run = row["run"]
        for opponent, values in row["metrics"].items():
            lines.append(f"| {run['cohort_id']} | {run['treatment']} | {run['training_seed']} | {opponent} | "
                         f"{values['wins']}/{values['draws']}/{values['losses']} | {values['score']:.2%} | "
                         f"{values['no_progress_rate']:.2%} |")
    lines.extend(["", "| Cohort | Contrast | Opponent | Matched pairs | Mean score Δ (pp) | Seed 95% (pp) |",
                  "| --- | --- | --- | ---: | ---: | --- |"])
    for row in report["training_seed_effects"]:
        interval = row["paired_training_seed_t95"] or row["paired_training_seed_bootstrap95"]
        bound = f"[{interval[0]*100:+.2f}, {interval[1]*100:+.2f}]" if interval else "—"
        lines.append(f"| {row['cohort_id']} | {row['treatment']} − baseline | {row['opponent']} | "
                     f"{row['n']}/{row['planned_pairs']} | {row['mean']*100:+.2f} | {bound} |")
    if report["findings"]:
        lines.extend(["", "## Exclusions and findings", ""])
        for finding in report["findings"]:
            lines.append("- " + ", ".join(f"{k}={v}" for k, v in finding.items()))
    return "\n".join(lines) + "\n"
