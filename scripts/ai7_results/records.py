"""Validation and normalization of shared AI-7 result files."""
from collections import defaultdict
import gzip
import hashlib
import io
import json
from pathlib import Path
import re

from scripts.ai7.evaluate_shared import result_metrics, outcome

JSON_LIMIT = 1024 * 1024
GAMES_LIMIT = 4 * 1024 * 1024
RAW_LIMIT = 32 * 1024 * 1024
RUN_FILES = {"manifest.json", "games.jsonl.gz", "conformance.json"}
KNOWN_USAGE = Path(__file__).resolve().parents[2] / "docs/ai7-shared-evaluation/known-dataset-usage.json"
EVENTS = {"proposed", "reserved", "generated", "executed", "inspected", "selected", "tuned", "retired"}
GAME_FIELDS = {"seed", "seat", "action_seed", "opponent", "prefix_plies", "result",
               "plies", "captures", "flips", "hidden", "reversals", "repetitions",
               "everPublicCountLead", "return", "objective_return", "id"}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}", value),
            f"Invalid identifier: {value!r}")
    return value


def digest(value, length=64):
    require(isinstance(value, str) and re.fullmatch(f"[a-f0-9]{{{length}}}", value), "Invalid digest")
    return value


def integer(value, minimum=0):
    require(type(value) is int and value >= minimum, "Invalid integer")
    return value


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def bounded(path, limit):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= limit,
            f"Missing, nonregular or oversized file: {path}")
    return path.read_bytes()


def parse(raw):
    def unique(pairs):
        data = dict(pairs)
        require(len(data) == len(pairs), "Duplicate JSON key")
        return data

    def invalid(value):
        raise ValueError(f"Non-finite JSON number: {value}")

    return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid)


def load(path, limit=JSON_LIMIT):
    return parse(bounded(path, limit))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fingerprint(value):
    return sha(encode(value))


def dataset_id(decks):
    return "decks-" + fingerprint(sorted(decks))


def study_and_protocol(study_bytes, protocol_bytes):
    study, protocol = parse(study_bytes), parse(protocol_bytes)
    require(study["schema_version"] == 1, "Unsupported study schema")
    identifier(study["study_id"])
    require(study["study_id"] != "dataset-usage", "Study ID is reserved")
    require(study["protocol_sha256"] == sha(protocol_bytes), "Study protocol digest mismatch")
    require(study["protocol_id"] == protocol["protocol_id"], "Study protocol ID mismatch")
    identifier(study["protocol_version"])
    require(bool(study["frozen_at"]), "Study freeze time required")
    require(protocol["score"] == {"WIN": 1, "DRAW": .5, "LOSS": 0}, "Unsupported official metric")
    decks = protocol["deck_seeds"]
    require(bool(decks) and len(decks) == len(set(decks)), "Empty or duplicate deck IDs")
    for seed in decks:
        integer(seed, 1)
    require(protocol["seats"] == [0, 1], "Both seats required")
    require(protocol["games_per_model_opponent"] == len(decks) * 2, "Wrong per-opponent denominator")
    require(study["dataset_id"] == dataset_id(decks), "Dataset ID must identify the exact deck set")
    require(study["dataset_role"] in ("historical", "confirmation"), "Unknown dataset role")
    structural = study["structural"]
    require(set(structural) == {"core_revision", "public_observation", "action_mask_sha256",
                                 "terminal_rules_sha256", "sampling_sha256"}, "Incomplete structural identity")
    digest(structural["core_revision"], 40)
    identifier(structural["public_observation"])
    for k in ("action_mask_sha256", "terminal_rules_sha256", "sampling_sha256"):
        digest(structural[k])
    require(structural["sampling_sha256"] == fingerprint(protocol["sampling"]), "Sampling fingerprint differs")
    require(protocol["sampling"].get("action_seed", protocol["sampling"].get("focal_seed")) == "deck_seed XOR 0x13579",
            "Unsupported action seed convention")
    approved = study["evaluator_source_sha256"]
    require(isinstance(approved, dict) and approved, "Approved evaluator source map required")
    for value in approved.values():
        digest(value)
    require(approved == protocol["evaluator"]["source_sha256"],
            "Study evaluator hashes differ from the protocol")
    require(bool(study["cohorts"]), "Study requires a cohort")
    for name, cohort in study["cohorts"].items():
        identifier(name)
        treatments = cohort["treatments"]
        require(len(treatments) == len(set(treatments)) and cohort["baseline"] in treatments,
                "Invalid cohort treatments/baseline")
        for name in treatments:
            identifier(name)
        integer(cohort["endpoint_transitions"], 1)
        used_seeds = set()
        require(bool(cohort["pairs"]), "Declare the matched pair assignments")
        for pair_id, pair in cohort["pairs"].items():
            identifier(pair_id)
            identifier(pair["machine_id"])
            seed = integer(pair["training_seed"])
            require(seed not in used_seeds, "Duplicate training seed in cohort pair plan")
            used_seeds.add(seed)
    opponents = {}
    for opponent in protocol["opponents"]:
        name = identifier(opponent["name"])
        require(name not in opponents, "Duplicate opponent")
        opponents[name] = digest(opponent.get("checkpoint_sha256") or opponent.get("implementation_sha256")
                                 or opponent.get("source_sha256"))
    require(bool(opponents), "No opponents")
    return study, protocol, opponents


def game_key(row):
    return row["opponent"], row["game"]["seed"], row["game"]["seat"]


def validate_rows(rows, protocol, opponents):
    expected = {(opponent, seed, seat) for opponent in opponents
                for seed in protocol["deck_seeds"] for seat in protocol["seats"]}
    seen = set()
    for row in rows:
        require(set(row) == {"opponent", "opponent_identity_sha256", "game"}, "Unknown per-game wrapper fields")
        opponent, seed, seat = game_key(row)
        require(type(seed) is int and type(seat) is int, "Invalid deck or seat")
        require((opponent, seed, seat) in expected and (opponent, seed, seat) not in seen,
                "Unexpected or duplicate opponent/deck/seat")
        seen.add((opponent, seed, seat))
        require(row["opponent_identity_sha256"] == opponents[opponent], "Frozen opponent digest mismatch")
        game = row["game"]
        require(set(game) <= GAME_FIELDS, "Unknown game fields (training/replay payloads unsupported)")
        require(game["opponent"] == opponent and game["prefix_plies"] == 0, "Opponent or normal-start mismatch")
        require(game["action_seed"] == seed ^ 0x13579, "Game action seed mismatch")
        require(integer(game["plies"], 1) <= 4096, "Ply limit exceeded")
        for key in set(game) - {"result", "opponent", "everPublicCountLead"}:
            require(type(game[key]) is int, f"Unexpected non-integer game field: {key}")
        if "everPublicCountLead" in game:
            lead = game["everPublicCountLead"]
            require(isinstance(lead, dict) and set(lead) == {"P1", "P2"} and all(type(value) is bool for value in lead.values()),
                    "Invalid public lead flags")
        result = game["result"]
        terminal = result["type"]
        if terminal == "WIN":
            require(set(result) == {"type", "reason", "winner"} and result["winner"] in ("P1", "P2")
                    and result["reason"] in ("NO_PIECES", "NO_LEGAL_ACTION"), "Invalid decisive outcome")
        else:
            require(terminal == "DRAW" and set(result) == {"type", "reason"}
                    and result["reason"] in ("NO_PROGRESS", "CHASE_STALEMATE"), "Invalid draw outcome")
        score = {"wins": 1, "draws": 0, "losses": -1}[outcome(game)]
        require(game["return"] == score and game.get("objective_return", score) == score,
                "Learner-perspective reward/outcome mismatch")
    return len(expected), len(seen)


def validate_run(manifest, rows, proof, study, protocol, opponents):
    require(manifest["schema_version"] == 1 and manifest["study_id"] == study["study_id"],
            "Unknown run schema or study")
    for key in ("run_id", "treatment", "cohort_id", "machine_id"):
        identifier(manifest[key])
    digest(manifest["source_commit"], 40)
    digest(manifest["configuration_sha256"])
    for source_hash in manifest.get("training_source_sha256", {}).values():
        digest(source_hash)
    checkpoint = manifest["checkpoint"]
    digest(checkpoint["sha256"])
    require(bool(checkpoint["architecture"]), "Checkpoint architecture required")
    integer(checkpoint["env_steps"])
    identifier(checkpoint["endpoint"])
    require(isinstance(checkpoint["locator"], str) and bool(checkpoint["locator"]), "Checkpoint locator required")
    if "filename" in checkpoint:
        require(Path(checkpoint["filename"]).name == checkpoint["filename"] and checkpoint["filename"] not in (".", ".."),
                "Unsafe checkpoint filename")
    evaluation = manifest["evaluation"]
    identifier(evaluation["evaluation_id"])
    require(len(evaluation["evaluation_id"]) <= 119 and bool(evaluation["at"]), "Missing evaluation time or long ID")
    identifier(evaluation["machine_id"])
    require(evaluation["checkpoint_sha256"] == checkpoint["sha256"], "Evaluated checkpoint mismatch")
    require(evaluation["protocol_sha256"] == study["protocol_sha256"], "Incompatible evaluation protocol")
    require(evaluation["dataset_id"] == study["dataset_id"], "Mismatched evaluation dataset")
    require(evaluation["structural"] == study["structural"], "Structural compatibility mismatch")
    require(evaluation["source_sha256"] == study["evaluator_source_sha256"], "Evaluator source mismatch")
    runtime = evaluation["runtime"]
    for name in ("python", "torch", "numpy", "node", "device"):
        require(isinstance(runtime[name], str) and bool(runtime[name]), f"Missing runtime {name}")
    require(bool(manifest["training_runtime"]) and isinstance(manifest["training_runtime"], dict),
            "Training runtime required")
    require((proof.get("passed") is True or proof.get("status") == "passed")
            and proof.get("manifest_sha256", proof.get("shared_manifest_sha256")) == study["protocol_sha256"],
            "Missing passing conformance evidence for this protocol")
    proof_versions = proof.get("current_versions", proof.get("versions", {}))
    for name in ("python", "torch", "numpy", "node"):
        if name in proof_versions:
            require(proof_versions[name] == runtime[name], f"Conformance runtime differs: {name}")
    if "source_sha256" in proof:
        require(proof["source_sha256"] == evaluation["source_sha256"], "Conformance source differs")
    cohort = study["cohorts"][manifest["cohort_id"]]
    require(manifest["treatment"] in cohort["treatments"], "Treatment outside cohort")
    integer(manifest["training_seed"])
    if manifest["pair_id"] is not None:
        assignment = cohort["pairs"][identifier(manifest["pair_id"])]
        require(assignment["machine_id"] == manifest["machine_id"]
                and assignment["training_seed"] == manifest["training_seed"], "Wrong matched pair assignment")
    expected, completed = validate_rows(rows, protocol, opponents)
    require(evaluation["expected_games"] == expected and evaluation["completed_games"] == completed,
            "Game accounting differs from manifest")
    require(manifest["status"] in ("complete", "partial") and evaluation["status"] == manifest["status"],
            "Invalid run/evaluation status")
    if manifest["status"] == "complete":
        require(checkpoint["endpoint"] == "final" and checkpoint["env_steps"] == cohort["endpoint_transitions"],
                "Unexpected completed checkpoint endpoint")
        require(completed == expected, "Incomplete game output cannot be marked complete")
    return {"artifact": "valid", "import": "compatible", "protocol": "compatible",
            "study": "matched_plan" if manifest["pair_id"] is not None else "unpaired",
            "aggregation_eligible": manifest["status"] == "complete" and manifest["pair_id"] is not None,
            "conformance_scope": "producer evidence and registered source identity, no inference rerun"}


def read_rows(data):
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
        raw = stream.read(RAW_LIMIT + 1)
    require(len(raw) <= RAW_LIMIT, "Decompressed game output exceeds limit")
    return [parse(line) for line in raw.splitlines()]


def game_bytes(rows):
    raw = b"".join(map(encode, sorted(rows, key=game_key)))
    require(len(raw) <= RAW_LIMIT, "Game payload exceeds limit")
    packed = gzip.compress(raw, mtime=0)
    # Python/zlib versions emit different OS bytes. Canonicalize the gzip header.
    packed = packed[:9] + b"\xff" + packed[10:]
    require(len(packed) <= GAMES_LIMIT, "Compressed game payload exceeds limit")
    return packed


def read_run(path, study, protocol, opponents):
    require(not path.is_symlink() and {p.name for p in path.iterdir()} == RUN_FILES,
            f"Unexpected run files: {path}")
    manifest = load(path / "manifest.json")
    require((manifest["treatment"], manifest["run_id"]) == (path.parent.name, path.name),
            "Run directory does not match identity")
    entries = {"games.jsonl.gz": bounded(path / "games.jsonl.gz", GAMES_LIMIT),
               "conformance.json": bounded(path / "conformance.json", JSON_LIMIT)}
    require(manifest["artifacts"] == {name: sha(data) for name, data in entries.items()},
            "Run artifact checksum mismatch")
    rows = read_rows(entries["games.jsonl.gz"])
    checks = validate_run(manifest, rows, parse(entries["conformance.json"]), study, protocol, opponents)
    return manifest, rows, checks


def write_run(study, protocol, opponents, input_manifest, proof_data, rows):
    manifest = dict(input_manifest)
    expected, completed = validate_rows(rows, protocol, opponents)
    evaluation = dict(manifest["evaluation"])
    # Count from source rows. Explicit completion still has to pass validation.
    for key, value in {"expected_games": expected, "completed_games": completed,
                       "status": manifest["status"]}.items():
        require(evaluation.get(key, value) == value, "Run metadata contradicts derived accounting")
        evaluation[key] = value
    manifest["evaluation"] = evaluation
    validate_run(manifest, rows, parse(proof_data), study, protocol, opponents)
    root = Path("results") / study["study_id"] / manifest["treatment"] / manifest["run_id"]
    files = {"games.jsonl.gz": game_bytes(rows), "conformance.json": proof_data}
    manifest["artifacts"] = {name: sha(data) for name, data in files.items()}
    files["manifest.json"] = encode(manifest)
    require(len(files["manifest.json"]) <= JSON_LIMIT, "Run manifest exceeds limit")
    return {str(root / name): data for name, data in files.items()}, manifest


def rows_from_reports(paths, manifest, opponents):
    """Read the existing evaluator's report JSON with its authoritative raw games."""
    rows = []
    for path in paths:
        report = load(path, RAW_LIMIT)
        identity = report.get("checkpoint_identity") or report["identity"]
        require(identity.get("sha256", identity.get("checkpoint_sha256")) == manifest["checkpoint"]["sha256"]
                and identity.get("seed", identity.get("training_seed")) == manifest["training_seed"]
                and identity["treatment"] == manifest["treatment"], "Source report has another model identity")
        protocol_hash = report.get("manifest_sha256", identity.get("shared_manifest_sha256"))
        require(protocol_hash == manifest["evaluation"]["protocol_sha256"], "Source report protocol mismatch")
        source_name = report["opponent"]
        # 21M M1 records call the same frozen checkpoint historical4023.
        opponent = "m1_exp2_baseline_4023" if source_name == "historical4023" else source_name
        proof = report.get("opponent_identity", {})
        opponent_hash = report.get("opponent_identity_sha256") or proof.get("checkpoint_sha256") or proof.get("implementation_sha256")
        require(opponent_hash == opponents[opponent], "Source report opponent mismatch")
        require(report["completed"] == len(report["games"]), "Report game count mismatch")
        require(manifest["status"] == "partial" or not any(report.get(k, 0) for k in ("errors", "skipped", "incomplete")),
                "Report contains incomplete or failed games")
        for game in report["games"]:
            require(game["opponent"] == source_name, "Source game opponent differs from source report")
            rows.append({"opponent": opponent, "opponent_identity_sha256": opponent_hash,
                         "game": {**game, "opponent": opponent}})
    return rows


def event_files(events):
    files = {}
    for event in events:
        validate_event(event)
        path = "results/dataset-usage/" + event["dataset_id"] + "/" + event["event_id"] + ".json"
        payload = encode(event)
        require(len(payload) <= JSON_LIMIT, "Dataset event exceeds limit")
        require(path not in files or files[path] == payload, "Conflicting dataset events")
        files[path] = payload
    return files


def validate_event(event):
    identifier(event["event_id"])
    require(event["dataset_id"].startswith("decks-"), "Dataset event must identify exact decks")
    digest(event["dataset_id"][6:])
    require(event["state"] in EVENTS and bool(event["at"]) and bool(event["evidence"]), "Invalid dataset event")
    identifier(event["machine_id"])
    if isinstance(event["evidence"], dict) and "deck_seeds" in event["evidence"]:
        decks = event["evidence"]["deck_seeds"]
        require(isinstance(decks, list) and bool(decks), "Invalid event deck list")
        for seed in decks:
            integer(seed, 1)
        require(len(decks) == len(set(decks)) and dataset_id(decks) == event["dataset_id"],
                "Event deck list differs from dataset identity")


def scan(root, selected_study=None):
    """Validate the managed tree. All data are read as records, never executed."""
    if not root.exists():
        return [], []
    require(root.is_dir() and not root.is_symlink(), "Unsafe results root")
    runs, events = [], []
    ids, eval_ids = set(), set()
    for path in sorted(root.iterdir()):
        require(path.is_dir() and not path.is_symlink(), f"Unexpected results entry: {path}")
        if path.name == "dataset-usage":
            for dataset in sorted(path.iterdir()):
                require(dataset.is_dir() and not dataset.is_symlink(), "Unsafe dataset path")
                for item in sorted(dataset.iterdir()):
                    event = load(item)
                    validate_event(event)
                    require((dataset.name, item.name) == (event["dataset_id"], event["event_id"] + ".json"),
                            "Dataset event identity mismatch")
                    events.append(event)
            continue
        study, protocol, opponents = study_and_protocol(
            bounded(path / "study.json", JSON_LIMIT), bounded(path / "protocol.json", JSON_LIMIT))
        require(study["study_id"] == path.name, "Study directory identity mismatch")
        for treatment in sorted(path.iterdir()):
            if treatment.name in ("study.json", "protocol.json"):
                continue
            require(treatment.is_dir() and not treatment.is_symlink(), "Unsafe treatment directory")
            for run in sorted(treatment.iterdir()):
                manifest, rows, status = read_run(run, study, protocol, opponents)
                require(manifest["run_id"] not in ids and manifest["evaluation"]["evaluation_id"] not in eval_ids,
                        "Duplicate global run or evaluation ID")
                ids.add(manifest["run_id"])
                eval_ids.add(manifest["evaluation"]["evaluation_id"])
                if selected_study is None or path.name == selected_study:
                    runs.append((manifest, rows, status))
    return runs, events


def metrics(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[row["opponent"]].append(row["game"])
    return {key: result_metrics(games) for key, games in groups.items()}
