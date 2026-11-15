"""Portable source evidence and seed audit; never opens tactical bank files."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SEEDS = [6011, 6023, 6037]
TARGET = 3_640_000
TERMINAL_REASONS = ["NO_PIECES", "NO_LEGAL_ACTION", "NO_PROGRESS", "CHASE_STALEMATE"]


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def digest_json(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def write_new(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as stream:
        stream.write(json.dumps(value, indent=2, allow_nan=False) + "\n")


def command(args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def source_evidence(root=ROOT):
    def paths(folder):
        return sorted(p.relative_to(root).as_posix() for p in (root / folder).rglob("*")
                      if p.is_file() and p.suffix in {".py", ".ts", ".mjs", ".json", ".txt"}
                      and "__pycache__" not in p.parts)
    groups = {
        "game_core": paths("packages/game-core/src") + ["docs/game-rules.md", "docs/chase-v4-spec.md"],
        "public_observation": ["scripts/ai7/environment.ts", "scripts/ai7/runtime.py"],
        "action_encoding": ["scripts/ai7/environment.ts"],
        "model_definition": ["scripts/ai7/runtime.py"],
        "deck_generation": ["apps/web/src/game/deck.ts", "packages/ai-agents/src/seeded-random.ts"],
        "sampling_and_stopping": ["scripts/ai7/runtime.py", "scripts/ai7/evaluate.py"],
        "training": ["scripts/ai7/train.py", "scripts/ai7/learning_methods.py"],
    }
    runtime_paths = paths("scripts/ai7") + paths("scripts/ai-eval") + paths("packages/game-core") + paths("packages/ai-agents") + paths("apps/web/src/game")
    groups["evaluation_runtime"] = sorted(set(runtime_paths + ["package.json", "pnpm-lock.yaml"]))
    hashes = {name: sha256(root / name) for name in sorted(set(n for names in groups.values() for n in names)) if (root / name).is_file()}
    versions = {}
    for name in ["torch", "numpy", "matplotlib"]:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "unverified"
    return {
        "git_commit": command(["git", "rev-parse", "HEAD"], root),
        "git_branch": command(["git", "branch", "--show-current"], root),
        "git_status": command(["git", "status", "--short", "--untracked-files=all"], root),
        "components": {key: {"sha256": digest_json([[name, hashes.get(name)] for name in sorted(names)]), "files": sorted(names)} for key, names in groups.items()},
        "source_hashes": hashes,
        "observation": {"declared_version": "public-v1", "encoded_floats": 2163,
                        "verification": "source fingerprint above, not version label alone"},
        "actions": {"count": 1056, "flip": "position", "move": "32 + from * 32 + to"},
        "model": {"architecture": "public-mlp128-v1", "input_dim": 2163, "width": 128, "parameters": 429857},
        "dependencies": {"python": platform.python_version(), "python_executable": sys.executable,
                         "node": command(["node", "--version"], root), **versions,
                         "pip_freeze": command([sys.executable, "-m", "pip", "freeze"], root).splitlines(),
                         "pnpm_lock_sha256": hashes["pnpm-lock.yaml"]},
        "platform": platform.platform(), "machine": platform.machine(),
        "scope": "actual local runtime; this does not verify any inaccessible campaign's training source",
    }


def seed_ranges(value, location="$"):
    """Conservative seed usage from metadata: unknown seed schemas block sealing."""
    found, unknown = [], []
    if isinstance(value, dict):
        normalized = {re.sub(r"[^a-z0-9]", "", k.lower()): (k, v) for k, v in value.items()}
        for key, item in value.items():
            name = re.sub(r"[^a-z0-9]", "", key.lower())
            where = f"{location}.{key}"
            if "seed" in name:
                if name.endswith("seedstart") or name == "seedstart":
                    prefix = name[:-len("seedstart")]
                    count_names = [prefix + "pairs", prefix + "seedpairs", prefix + "count", "pairs", "seedcount"]
                    if prefix == "eval":
                        count_names.insert(0, "evaluationpairs")
                    if prefix == "historical":
                        count_names.insert(0, "historicalpairs")
                    count = next((normalized[n][1] for n in count_names if n in normalized), None)
                    if type(item) is int and type(count) is int and count >= 0:
                        if count:
                            found.append({"start": item, "end": item + count - 1, "field": where})
                    else:
                        unknown.append(where)
                elif type(item) is int:
                    found.append({"start": item, "end": item, "field": where})
                elif isinstance(item, list) and all(type(n) is int for n in item):
                    found.extend({"start": n, "end": n, "field": where} for n in item)
                elif isinstance(item, dict) and {"start", "end"} <= item.keys():
                    if type(item["start"]) is int and type(item["end"]) is int:
                        found.append({"start": item["start"], "end": item["end"], "field": where})
                    else:
                        unknown.append(where)
                elif not isinstance(item, (dict, list)) and item is not None:
                    # Text descriptions are evidence for manual review, not proof.
                    unknown.append(where)
            if isinstance(item, (dict, list)):
                ranges, pending = seed_ranges(item, where)
                found.extend(ranges)
                unknown.extend(pending)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            if isinstance(item, (dict, list)):
                ranges, pending = seed_ranges(item, f"{location}[{i}]")
                found.extend(ranges)
                unknown.extend(pending)
    return found, unknown


def audit_seeds(root=ROOT, excluded=None):
    base = root / "benchmark-results/ai7-selfplay"
    records, errors, ignored = [], [], []
    if base.exists():
        for path in sorted(base.rglob("*.json")):
            rel = path.relative_to(root).as_posix()
            if excluded and path.is_relative_to(excluded):
                continue
            if "source-snapshot" in path.parts or any(part in path.parts for part in ["training-replays", "replays"]):
                continue
            # Refuse bank/confirmation data before opening or hashing any file.
            if re.search(r"reserved|confirmation|bank|stage[12]", path.name, re.I):
                ignored.append(rel)
                continue
            if not re.search(r"manifest|config|summary|status|provenance|metadata|profile|validation", path.name, re.I):
                continue
            try:
                payload = json.loads(path.read_text())
                ranges, unknown = seed_ranges(payload)
                records.append({"path": rel, "sha256": sha256(path), "ranges": ranges, "manual_review_fields": unknown})
            except (OSError, ValueError) as error:
                errors.append({"path": rel, "error": str(error)})
    # Conservative document/source reservations, even when original metadata is absent.
    known = [
        (0, 899999, "training generator, scripts/ai7/train.py"),
        (1000000, 1000127, "original validation, scripts/ai7/train.py"),
        (1100000, 1100007, "architecture validation, docs/ai7-overnight.md"),
        (1300000, 1300031, "Exp2 validation, docs/ai7-p1p2.md"),
        (1500000, 1500015, "new Intel validation; reserved before pilots"),
        (2000000, 2000127, "original final test, docs/ai7-selfplay.md"),
        (3000000, 3000127, "architecture test, docs/ai7-overnight.md"),
        (6000000, 6000255, "Exp2 final test, docs/ai7-p1p2.md"),
        (6100000, 6100001, "Exp2 smoke, scripts/ai7/prepare_p1p2.py"),
        (7000000, 7000063, "Exp2 historical, docs/ai7-p1p2.md"),
        (11000000, 11011999, "symmetry stage1 max attempts, docs/ai7-symmetry.md"),
        (12000000, 12011999, "symmetry stage2 max attempts, docs/ai7-symmetry.md"),
        (13000000, 13011999, "untouched symmetry reserve max attempts, docs/ai7-symmetry.md"),
    ]
    return {"artifact_root_present": base.exists(), "records": records, "errors": errors,
            "protected_files_not_opened": ignored,
            "documented_reservations": [{"start": a, "end": b, "evidence": c} for a, b, c in known],
            "m1_seed_exclusivity": "unverified", "coverage": "accessible local metadata plus documented prior ranges; not a claim about M1 artifacts"}


def candidate_seeds(audit, start=14_000_000):
    usages = audit["documented_reservations"] + [r for entry in audit["records"] for r in entry["ranges"]]
    changes = []
    while True:
        conflicts = [r for r in usages if r["start"] <= start + 127 and r["end"] >= start]
        if not conflicts:
            return list(range(start, start + 128)), changes
        changes.append({"rejected_start": start, "conflicts": conflicts})
        start = ((max(r["end"] for r in conflicts) // 1_000_000) + 1) * 1_000_000


def make_manifest(evidence, audit):
    seeds, changes = candidate_seeds(audit)
    return {
        "schema_version": 1, "protocol_id": "ai7-intel-m1-shared-final-v1",
        "status": "fixed_for_Intel_local_evaluation; cross_machine_pending",
        "registration": "New shared final-test protocol on 2026-11-15 Asia/Taipei; not retrospectively preregistered by either training campaign",
        "seed_audit": {"artifact": "seed-audit.json", "sha256": digest_json(audit),
                       "local_overlap": "none_detected" if not audit["errors"] else "audit_errors_pending",
                       "m1_exclusivity": "unverified", "range_changes_before_results": changes,
                       "freeze_rule": "Never change seeds after observing results. Any later M1 conflict invalidates shared-test status; retain these results as Intel local evidence."},
        "deck_seeds": seeds, "seats": [0, 1], "pairs": 128, "games_per_checkpoint_opponent": 256,
        "training": {"seeds": SEEDS, "target_env_steps": TARGET, "model": "baseline MLP",
                     "learning_rate": .0003, "gamma": 1., "epochs": 4,
                     "opponent_mixture": "standard", "terminal_rewards_intel": [1, 0, -1]},
        "treatments": {
            "intel": ["baseline", "gae_lambda_095", "chain_lite"],
            "m1": [{"id": "baseline"}, {"id": "no_progress_penalty_02", "penalty": -.2},
                   {"id": "no_progress_penalty_005", "penalty": -.05},
                   {"id": "endgame_curriculum", "normal": .7, "legal_endgame": .3},
                   {"id": "symmetry_augmentation"}],
            "m1_definitions_status": "user_declared; actual config/source unverified; All Draw is not an arm"},
        "participants": {"intel": {"runtime_evidence": "intel-source-evidence.json", "sha256": digest_json(evidence)},
                         "m1": {"status": "unverified", "git_commit": None, "game_core_sha256": None,
                                "public_observation_sha256": None, "action_encoding_sha256": None,
                                "model_definition_sha256": None, "dependencies": None}},
        "runtime": {"components": evidence["components"], "dependencies": evidence["dependencies"],
                    "source_archive": "source-snapshot/", "device": "cpu", "threads": 2, "batch_games": 16,
                    "core_rule_changes": False, "training_source_may_differ": "report differences; match evaluation semantics under a common compatible runtime"},
        "sampling": {"policy": "stochastic masked categorical", "temperature": 1., "seed_all": 19,
                     "action_rng": "NumPy default_rng (PCG64)", "focal_seed": "deck_seed XOR 0x13579",
                     "opponent_seed": "(deck_seed XOR 0x13579) XOR 0x5A5A5A5A",
                     "reset": "fresh per game/seat/checkpoint/matchup; role streams stay focal/opponent under seat swap",
                     "policy_choice": "Categorical float32 probabilities; select ordered legal IDs; convert to float64; normalize; rng.choice(legal,p=weights)",
                     "random_choice": "opponent role rng.choice(observation.legal), no probability argument; same ordered legal IDs"},
        "opponents": [
            {"id": "random", "status": "available_local_runtime", "implementation": "scripts/ai7/runtime.py collect random branch", "sha256": evidence["source_hashes"]["scripts/ai7/runtime.py"]},
            {"id": "exp2_baseline_seed_4023_final", "status": "pending_missing_artifact", "path": None,
             "expected_origin": "benchmark-results/ai7-selfplay/p1p2-comparison/20261114-v1/runs/baseline-seed-4023/final.pt",
             "sha256": None, "architecture": "baseline MLP (must verify checkpoint metadata)", "source_version": "unverified",
             "observation_schema": "unverified", "sampling": "same stochastic masked categorical policy as focal",
             "substitution_allowed": False}],
        "checkpoint_selection": {"primary": "predetermined final at exactly 3640000 transitions",
                                 "controls": "initial at zero transitions", "intermediates": "learning curves and diagnostics only"},
        "stopping": {"terminal": "authoritative GameCore only; original Chase v4 priority",
                     "safety_plies": 4096, "safety_bound_handling": "error; never manufactured draw",
                     "unfinished": "count separately; never completed or draw", "evaluation_rewards": "derive W/D/L from Core result and focal seat, independent of training shaping"},
        "metrics": {"score": {"WIN": 1, "DRAW": .5, "LOSS": 0}, "terminal_reasons": TERMINAL_REASONS,
                    "required": ["planned", "attempted", "completed", "skipped", "incomplete", "errors", "wins", "draws", "losses", "terminal_reason_counts", "no_progress_rate", "chase_stalemate_rate", "per_seat", "pair_scores"],
                    "paired_score": "average two seat legs per deck; interval over complete independent deck pairs",
                    "uncertainty": "paired-deck bootstrap 10000 resamples seed19; training seed is replication unit, n=3; exploratory multiple comparisons",
                    "success": "winning conversion and tactical ability; increased draws alone do not establish improvement"},
        "head_to_head": {"separate_results": True, "match": "each Intel treatment final vs baseline final with same training seed; same 128 decks and both seats"},
        "tactical": {"existing_test_set": "preserve stage2 bank; evaluate identical bytes only if available; report fingerprint",
                     "missing_bank": "pending; fixed eight existing Core probes are diagnostic, not a replacement benchmark",
                     "reserved_confirmation": "100 wins + 100 defenses remains untouched; do not read, regenerate, tune on, or evaluate"},
        "transfer": {"bundle": ["shared-evaluation-manifest.json", "intel-source-evidence.json", "seed-audit.json", "config.json", "source-snapshot/", "checksums.json"],
                     "m1_return": ["m1-source-evidence.json", "m1-seed-audit.json", "original campaign config/provenance/source snapshot", "checkpoint-index.json", "raw games and metric summaries", "actual dependency freeze"],
                     "checkpoint_index_fields": ["machine", "campaign_id", "treatment", "training_seed", "endpoint", "env_steps", "relative_path", "sha256", "model_config", "core_revision", "observation_version", "training_source_manifest_sha256"],
                     "historical_opponent": "transfer identical trusted checkpoint bytes and original provenance before fixing opponent sha256; no local-latest substitution"},
    }


def compare_evidence(left, right):
    differences = {key: {"left": left["components"][key]["sha256"], "right": right.get("components", {}).get(key, {}).get("sha256", "unverified")}
                   for key in left["components"] if left["components"][key]["sha256"] != right.get("components", {}).get(key, {}).get("sha256")}
    dependencies_match = left["dependencies"] == right.get("dependencies")
    critical = {"game_core", "public_observation", "action_encoding", "model_definition", "deck_generation", "sampling_and_stopping"}
    return {"git_commits": [left["git_commit"], right.get("git_commit", "unverified")],
            "component_mismatches": differences, "dependencies_equal": dependencies_match,
            "classification": "common_compatible_runtime_required" if critical & differences.keys() or not dependencies_match else "runtime_components_match; verify opponent bytes and protocol before pooling",
            "valid_with_mismatch": "within-campaign matched-seed contrasts remain interpretable with disclosed training differences; do not pool machine baselines or attribute hardware/source effects to treatments",
            "training_definition": "learning-method training differences are expected; Core/observation/action semantic differences require a separate scientific qualification even after common-runtime evaluation"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--machine", choices=["intel", "m1"], default="intel")
    parser.add_argument("--compare", nargs=2, type=Path)
    args = parser.parse_args()
    if args.compare:
        print(json.dumps(compare_evidence(*(json.loads(p.read_text()) for p in args.compare)), indent=2))
        return
    if not args.output:
        parser.error("--output is required for export")
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    evidence = source_evidence()
    audit = audit_seeds(excluded=out)
    write_new(out / f"{args.machine}-source-evidence.json", evidence)
    write_new(out / "seed-audit.json", audit)
    if args.machine == "intel":
        write_new(out / "shared-evaluation-manifest.json", make_manifest(evidence, audit))
    print(json.dumps({"output": str(out), "records_audited": len(audit["records"]), "m1_exclusivity": "unverified"}))


if __name__ == "__main__":
    main()
