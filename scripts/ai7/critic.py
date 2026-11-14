"""Baseline policy actor with a separate, higher-capacity outcome critic.

Both branches consume exactly public-v1's 2,163 features. This module contains no
game knowledge, evaluation features, reward definitions, or training examples.
"""
from __future__ import annotations

import math

import torch
from torch import nn
from torch.distributions import Categorical

ACTION_COUNT = 1056
PUBLIC_INPUT_DIM = 2163


class ImprovedCriticPolicy(nn.Module):
    """An unchanged MLP actor and an independently parameterized value MLP."""

    def __init__(
        self,
        input_dim=PUBLIC_INPUT_DIM,
        width=128,
        critic_widths=(256, 256, 128),
        architecture="critic",
    ):
        super().__init__()
        if architecture != "critic":
            raise ValueError("ImprovedCriticPolicy requires architecture='critic'")
        if input_dim != PUBLIC_INPUT_DIM:
            raise ValueError("ImprovedCriticPolicy requires the public-v1 input dimension")
        if not isinstance(width, int) or isinstance(width, bool) or width <= 0:
            raise ValueError("Actor width must be a positive integer")
        critic_widths = tuple(critic_widths)
        if not critic_widths or any(
            not isinstance(size, int) or isinstance(size, bool) or size <= 0
            for size in critic_widths
        ):
            raise ValueError("Critic widths must be nonempty positive integers")
        self.config = {
            "architecture": architecture,
            "input_dim": input_dim,
            "width": width,
            "critic_widths": list(critic_widths),
        }
        self.body = nn.Sequential(
            nn.Linear(input_dim, width), nn.Tanh(), nn.Linear(width, width), nn.Tanh()
        )
        self.actor = nn.Linear(width, ACTION_COUNT)

        # Reproduce the original shared model's actor initialization, including
        # its RNG consumption for the small scalar head. The temporary head is
        # not registered or retained and cannot share parameters with the critic.
        legacy_value_head = nn.Linear(width, 1)
        for layer in (self.body[0], self.body[2], self.actor, legacy_value_head):
            nn.init.orthogonal_(layer.weight, gain=math.sqrt(2))
            nn.init.zeros_(layer.bias)
        nn.init.orthogonal_(self.actor.weight, gain=0.01)
        nn.init.orthogonal_(legacy_value_head.weight, gain=1.0)

        layers = []
        previous = input_dim
        for size in critic_widths:
            layers.extend((nn.Linear(previous, size), nn.Tanh()))
            previous = size
        layers.append(nn.Linear(previous, 1))
        self.critic = nn.Sequential(*layers)
        for layer in self.critic:
            if isinstance(layer, nn.Linear):
                nn.init.orthogonal_(layer.weight, gain=math.sqrt(2))
                nn.init.zeros_(layer.bias)
        nn.init.orthogonal_(self.critic[-1].weight, gain=1.0)

    def forward(self, features, masks):
        if features.ndim != 2 or features.shape[-1] != self.config["input_dim"]:
            raise ValueError("Policy features must have shape [batch, 2163]")
        if masks.dtype != torch.bool or masks.shape != (features.shape[0], ACTION_COUNT):
            raise ValueError("Legal masks must be Boolean with shape [batch, 1056]")
        if not masks.any(dim=-1).all():
            raise ValueError("A policy decision must have at least one legal action")
        logits = self.actor(self.body(features)).masked_fill(~masks, -torch.inf)
        return Categorical(logits=logits), self.critic(features).squeeze(-1)
