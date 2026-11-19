"""Public-descriptor-only restart sampling with explicit checkpointable RNG state.

No private simulator records, labels, decks, or game-rule implementation belong
here. Full training remains gated on the separate verified Intel reference.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import time
from collections import Counter

import numpy as np


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def value_error_priorities(catalog, evidence, archive_sha256):
    """Freeze a candidate scoring table from replicated training-only outcomes.

    Targets use the snapshot's ACTING player's reward, with no alternating sign.
    Evidence must be produced/verified by a trusted continuation collector, not
    hand-authored labels. Its public-equivalence proof is an independent launch
    gate: this function computes scores, not a scientific validity certificate.
    """
    if evidence.get("archive_sha256") != archive_sha256 or evidence.get("training_only") is not True:
        raise ValueError("Priority evidence must match the training-only archive")
    if evidence.get("perspective") != "snapshot_acting_player":
        raise ValueError("Priority target perspective mismatch")
    for key in ["predictor_sha256", "continuation_protocol_sha256", "equivalence_verification_sha256"]:
        if not isinstance(evidence.get(key), str) or len(evidence[key]) != 64:
            raise ValueError("Missing frozen reference or public-equivalence verification fingerprint")
    if set(evidence["records"]) != {record["id"] for record in catalog}:
        raise ValueError("B3 must score the same complete archive as B1")
    scores = {}
    details = {}
    for record in catalog:
        item = evidence["records"][record["id"]]
        prediction = item["prediction"]
        outcomes = item["outcomes"]
        if not math.isfinite(prediction) or len(outcomes) < 8:
            raise ValueError("Priority requires a finite public value and at least eight outcomes")
        if len({outcome["action_seed"] for outcome in outcomes}) != len(outcomes):
            raise ValueError("Priority continuation RNG streams must be independent")
        if any(outcome["public_sha256"] != record["publicSha256"] or outcome["return"] not in [-1, 0, 1] for outcome in outcomes):
            raise ValueError("Priority outcomes must share the public start and original terminal rewards")
        if record["hidden"] and len({outcome["layout_sha256"] for outcome in outcomes}) < 8:
            raise ValueError("Action RNG repeats on one hidden layout cannot establish public-state value error")
        targets = np.asarray([outcome["return"] for outcome in outcomes], dtype=np.float64)
        mean = float(targets.mean())
        variance = float(targets.var(ddof=1))
        scores[record["id"]] = min(2., abs(prediction - mean))
        details[record["id"]] = {"prediction": prediction, "target_mean": mean,
            "outcomes": len(outcomes), "outcome_variance": variance,
            "standard_error": math.sqrt(variance / len(outcomes)), "clipped_error": scores[record["id"]]}
    return {"version": 1, "archive_sha256": archive_sha256,
        "evidence_sha256": fingerprint(evidence), "scores": scores, "details": details,
        "uniform_mixture": .2, "clip": [0, 2], "exponent": 1,
        "status": "candidate scores; full-training reference/equivalence gates still required"}


class RestartSampler:
    """Owns one isolated sampling stream and its resumable accounting state."""

    def __init__(self, catalog, archive_sha256, treatment, seed, priority=None, restart_probability=None):
        if treatment not in ["B0", "B1", "B2", "B3"]:
            raise ValueError("Unknown restart treatment")
        if len({record["id"] for record in catalog}) != len(catalog):
            raise ValueError("Duplicate restart identifiers")
        # Copy descriptors; callers cannot change the distribution after freeze.
        self.catalog = copy.deepcopy(catalog)
        self.restart_probability = (0 if treatment == "B0" else .3) if restart_probability is None else restart_probability
        if not 0 <= self.restart_probability <= 1 or (treatment == "B0" and self.restart_probability != 0):
            raise ValueError("Invalid restart probability")
        self.treatment = treatment
        self.rng = np.random.default_rng(seed)
        self.eligible = [record for record in self.catalog if treatment != "B2" or record["endgameEligible"]]
        if treatment != "B0" and not self.eligible:
            raise ValueError("No eligible restart states")
        self.probabilities = None
        if treatment == "B3":
            if priority is None or priority["archive_sha256"] != archive_sha256:
                raise ValueError("B3 requires a frozen priority table for this exact archive")
            if priority.get("uniform_mixture") != .2 or priority.get("clip") != [0, 2] or priority.get("exponent") != 1:
                raise ValueError("Priority clipping/mixing differs from the frozen design")
            if set(priority["scores"]) != {record["id"] for record in self.catalog}:
                raise ValueError("B3 and B1 archive records differ")
            scores = np.asarray([priority["scores"][record["id"]] for record in self.eligible], dtype=np.float64)
            if not np.all(np.isfinite(scores)) or np.any(scores < 0) or np.any(scores > 2):
                raise ValueError("Invalid value-error priorities")
            uniform = np.full(len(scores), 1. / len(scores))
            self.probabilities = uniform if scores.sum() == 0 else .2 * uniform + .8 * scores / scores.sum()
        self.identity = fingerprint({"catalog": self.catalog, "archive": archive_sha256,
            "treatment": treatment, "priority": priority, "seed": seed, "restart_probability": self.restart_probability})
        self.normal_starts = 0
        self.restart_starts = 0
        self.frequencies = Counter()
        self.stages = Counter()
        self.sampling_seconds = 0.

    def sample(self):
        started = time.perf_counter()
        # Disabled means no sampling RNG draws, preserving B0's original stream.
        if self.treatment == "B0" or self.rng.random() >= self.restart_probability:
            self.normal_starts += 1
            self.sampling_seconds += time.perf_counter() - started
            return {}
        index = int(self.rng.choice(len(self.eligible), p=self.probabilities))
        record = self.eligible[index]
        self.restart_starts += 1
        self.frequencies[record["id"]] += 1
        self.stages[record["stage"]] += 1
        self.sampling_seconds += time.perf_counter() - started
        return {"restartId": record["id"], "start_stage": record["stage"]}

    def state_dict(self):
        return copy.deepcopy({"version": 1, "identity": self.identity, "rng": self.rng.bit_generator.state,
            "normal_starts": self.normal_starts, "restart_starts": self.restart_starts,
            "frequencies": dict(self.frequencies), "stages": dict(self.stages),
            "sampling_seconds": self.sampling_seconds})

    def load_state_dict(self, state):
        state = copy.deepcopy(state)
        if state.get("version") != 1 or state.get("identity") != self.identity:
            raise ValueError("Restart sampler checkpoint/archive/configuration mismatch")
        if state["normal_starts"] < 0 or state["restart_starts"] < 0:
            raise ValueError("Invalid restart counters")
        if sum(state["frequencies"].values()) != state["restart_starts"] or sum(state["stages"].values()) != state["restart_starts"]:
            raise ValueError("Restart checkpoint accounting mismatch")
        self.rng.bit_generator.state = state["rng"]
        self.normal_starts = state["normal_starts"]
        self.restart_starts = state["restart_starts"]
        self.frequencies = Counter(state["frequencies"])
        self.stages = Counter(state["stages"])
        self.sampling_seconds = state["sampling_seconds"]
