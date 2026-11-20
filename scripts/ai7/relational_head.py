"""E2b shared nonlinear scoring of Core-legal public state/action pairs."""
from __future__ import annotations

import torch
from torch import nn
from torch.distributions import Categorical

from .geometry_head import action_geometry
from .runtime import ACTION_COUNT, Policy


class RelationalHead(nn.Module):
    def __init__(self, use_local):
        super().__init__()
        self.use_local = use_local
        self.register_buffer("geometry", action_geometry(), persistent=False)
        ids = torch.arange(ACTION_COUNT)
        # FLIP uses a zero source vector. Index 0 is a safe gather placeholder.
        self.register_buffer("source", (ids - 32).clamp_min(0) // 32, persistent=False)
        self.register_buffer("target", ids % 32, persistent=False)
        self.input = nn.Linear(167, 128)
        self.output = nn.Linear(128, 1)
        with torch.no_grad():
            self.input.weight[:, -32:].zero_()
        nn.init.orthogonal_(self.output.weight, gain=.01)
        nn.init.zeros_(self.output.bias)

    def local_features(self, features, rows, ids):
        if not self.use_local:
            return features.new_zeros((ids.numel(), 32))
        board = features[:, :512].reshape(-1, 32, 16)
        source = board[rows, self.source[ids]].masked_fill((ids < 32)[:, None], 0)
        target = board[rows, self.target[ids]]
        return torch.cat((source, target), dim=-1)

    def forward(self, hidden, features, masks):
        rows, ids = masks.nonzero(as_tuple=True)
        inputs = torch.cat((hidden[rows], self.geometry[ids],
                            self.local_features(features, rows, ids)), dim=-1)
        scores = self.output(self.input(inputs).tanh()).squeeze(-1)
        return scores.new_full(masks.shape, -torch.inf).index_put((rows, ids), scores)


class RelationalPolicy(Policy):
    def __init__(self, input_dim=2163, width=128, architecture="e2b_g"):
        if (input_dim, width) != (2163, 128) or architecture not in ("e2b_g", "e2b_l"):
            raise ValueError("E2b v1 requires public-v1, a 128-wide trunk and a G/L arm")
        super().__init__(input_dim=input_dim, width=width)
        self.config["architecture"] = architecture
        self.actor = RelationalHead(use_local=architecture == "e2b_l")

    def forward(self, features, masks):
        if masks.dtype != torch.bool or masks.shape != (features.shape[0], ACTION_COUNT):
            raise ValueError("Expected a boolean legal mask with 1056 columns per state")
        if not masks.any(dim=-1).all():
            raise ValueError("A policy decision must have at least one legal action")
        hidden = self.body(features)
        logits = self.actor(hidden, features, masks)
        return Categorical(logits=logits), self.critic(hidden).squeeze(-1)
