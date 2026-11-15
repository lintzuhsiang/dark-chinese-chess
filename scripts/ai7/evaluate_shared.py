"""Evaluation-only runner bound to the portable shared protocol; no optimizer."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import time

from .shared_protocol import ROOT, SEEDS, TARGET, TERMINAL_REASONS, digest_json, sha256, source_evidence, write_new


def outcome(game):
    result = game["result"]
    if result["type"] == "DRAW":
        return "draws"
    if result["type"] != "WIN":
        raise ValueError("Only authoritative terminal outcomes can be scored")
    return "wins" if result["winner"] == ("P1" if game["seat"] == 0 else "P2") else "losses"


def result_metrics(games):
    counts = Counter(outcome(game) for game in games)
    reasons = Counter(game["result"]["reason"] for game in games)
    unknown = set(reasons) - set(TERMINAL_REASONS)
    if unknown:
        raise ValueError(f"Unexpected terminal reasons: {unknown}")
    n = len(games)
    return {"completed": n, **{key: counts[key] for key in ["wins", "draws", "losses"]},
            "score": (counts["wins"] + .5 * counts["draws"]) / n if n else None,
            "terminal_reason_counts": {key: reasons[key] for key in TERMINAL_REASONS},
            "no_progress_rate": reasons["NO_PROGRESS"] / n if n else None,
            "chase_stalemate_rate": reasons["CHASE_STALEMATE"] / n if n else None}


def validate_manifest(manifest):
    seeds = manifest["deck_seeds"]
    if len(seeds) != 128 or len(set(seeds)) != 128 or manifest["seats"] != [0, 1]:
        raise ValueError("Expected 128 unique paired decks and both seats")
    if manifest["metrics"]["score"] != {"WIN": 1, "DRAW": .5, "LOSS": 0}:
        raise ValueError("Scoring mismatch")
    if manifest["seed_audit"]["local_overlap"] != "none_detected":
        raise ValueError("Local overlap audit is unresolved")
    evidence = source_evidence()
    expected = manifest["runtime"]
    for key, component in expected["components"].items():
        if component["sha256"] != evidence["components"][key]["sha256"]:
            raise ValueError(f"Frozen runtime source mismatch: {key}")
    for name in ["python", "node", "torch", "numpy", "matplotlib", "pnpm_lock_sha256"]:
        if evidence["dependencies"][name] != expected["dependencies"][name]:
            raise ValueError(f"Frozen dependency mismatch: {name}")
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--checkpoints", nargs="+", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--kind", choices=["external", "head_to_head"], default="external")
    parser.add_argument("--opponent-checkpoint", type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    evidence = validate_manifest(manifest)
    if args.kind == "head_to_head" and not args.opponent_checkpoint:
        raise ValueError("Head-to-head requires the matched training-seed baseline")
    if args.kind == "external" and args.opponent_checkpoint:
        historical = manifest["opponents"][1]
        if not historical.get("sha256") or sha256(args.opponent_checkpoint) != historical["sha256"]:
            raise ValueError("Shared historical opponent is not established; no substitution")
    from .runtime import Bridge, load_checkpoint, seed_all
    from .evaluate import evaluate_checkpoint, paired_difference
    seed_all(19)
    models = []
    for path in args.checkpoints:
        model, checkpoint = load_checkpoint(path)
        if checkpoint["env_steps"] not in [0, TARGET] or checkpoint["config"]["seed"] not in SEEDS:
            raise ValueError("Expected initial or predetermined final at exactly 3640000 steps for an authorized seed")
        if checkpoint["model_config"] != {"architecture": "baseline", "input_dim": 2163, "width": 128}:
            raise ValueError("Expected the baseline MLP architecture")
        models.append((path, model, checkpoint))
    opponent, opponent_meta = (None, None)
    if args.opponent_checkpoint:
        opponent, opponent_meta = load_checkpoint(args.opponent_checkpoint)
        if opponent_meta["architecture"] != "public-mlp128-v1" or opponent_meta["env_steps"] != TARGET:
            raise ValueError("Opponent must be a completed baseline MLP endpoint")
        if args.kind == "head_to_head":
            if opponent_meta["config"].get("learning_method", "baseline") != "baseline":
                raise ValueError("Matched opponent must be baseline")
            if any(c["config"]["seed"] != opponent_meta["config"]["seed"] or c["env_steps"] != TARGET for _, _, c in models):
                raise ValueError("Head-to-head requires matched training seeds and final endpoints")
    out = args.output.resolve()
    if not out.is_relative_to(ROOT / "benchmark-results/ai7-selfplay"):
        raise ValueError("Use the experiment artifact tree")
    out.mkdir(parents=True, exist_ok=False)
    write_new(out / "manifest.json", {"shared_manifest_sha256": sha256(args.manifest), "kind": args.kind,
              "runtime_evidence_sha256": digest_json(evidence), "deck_seeds": manifest["deck_seeds"],
              "checkpoint_sha256": {str(p.resolve()): sha256(p) for p in args.checkpoints},
              "opponent_sha256": sha256(args.opponent_checkpoint) if args.opponent_checkpoint else None,
              "opponent_path": str(args.opponent_checkpoint.resolve()) if args.opponent_checkpoint else "random",
              "cross_machine_comparison": "pending_M1_source_seed_and_opponent_verification"})
    reports = []
    bridge = Bridge(out / "replays")
    try:
        for path, model, checkpoint in models:
            name = "matched_baseline" if args.kind == "head_to_head" else "historical" if opponent is not None else "random"
            before = sha256(path)
            report = evaluate_checkpoint(bridge, model, path.stem, manifest["deck_seeds"], name,
                                         opponent_model=opponent, archive_count=2, batch_games=16)
            report.update(result_metrics(report["games"]))
            report["per_seat"] = {str(seat): result_metrics([g for g in report["games"] if g["seat"] == seat]) for seat in [0, 1]}
            report.update({"errors": 0, "checkpoint_sha256": before, "env_steps": checkpoint["env_steps"],
                           "training_seed": checkpoint["config"]["seed"], "learning_method": checkpoint["config"].get("learning_method", "baseline")})
            if sha256(path) != before:
                raise ValueError("Checkpoint bytes changed during evaluation")
            write_new(out / f"{path.stem}-vs-{name}.json", report)
            reports.append(report)
        comparisons = []
        for later in reports[1:]:
            comparisons.append(paired_difference(reports[0]["pair_scores"], later["pair_scores"]))
        write_new(out / "summary.json", {"kind": args.kind, "reports": [{k: v for k, v in r.items() if k not in ["games", "pair_scores"]} for r in reports], "initial_final_paired_comparisons": comparisons})
    except BaseException as error:
        write_new(out / "failure.json", {"error": repr(error), "at_epoch": time.time(),
                  "completed_matchups": len(reports), "errors": 1,
                  "qualification": "failed matchup is incomplete; do not count as draw or infer a completed W/D/L denominator"})
        raise
    finally:
        bridge.close()


if __name__ == "__main__":
    main()
