"""Intel learning ablations. References contain training-generated states only.

CHAIN-lite is a policy-only forward KL to the frozen pre-update policy on a
deterministic, evenly spaced subset of the current complete-game rollout.
References live for one PPO update, never across checkpoint boundaries. The
existing rollback restores weights, optimizer and RNG before rebuilding them.
"""
from __future__ import annotations

import torch


METHODS = ("baseline", "gae_lambda_095", "chain_lite")
CHAIN_ALPHA = 0.1
REFERENCE_STATES = 256


def freeze_reference(model, features, masks, count=REFERENCE_STATES):
    if len(features) == 0 or count < 1:
        raise ValueError("Reference requires nonempty training observations")
    # Integer arithmetic includes the complete rollout without consuming RNG.
    n = min(count, len(features))
    indices = torch.arange(n, device=features.device) * len(features) // n
    reference_features = features[indices].detach().clone()
    reference_masks = masks[indices].detach().clone()
    with torch.no_grad():
        policy, _ = model(reference_features, reference_masks)
        probabilities = policy.probs.detach().clone()
        log_probabilities = policy.logits.masked_fill(~reference_masks, 0).detach().clone()
    return reference_features, reference_masks, probabilities, log_probabilities


def reference_kl(model, reference):
    features, masks, probabilities, old_log_probabilities = reference
    current, _ = model(features, masks)
    # Both illegal log probabilities are zero before subtraction, avoiding
    # 0 * (-inf - -inf). Illegal actions have exactly zero probability/gradient.
    current_log_probabilities = current.logits.masked_fill(~masks, 0)
    return (probabilities * (old_log_probabilities - current_log_probabilities)).sum(-1).mean()
