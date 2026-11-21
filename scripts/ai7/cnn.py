"""Board-aware policy/value architecture using the unchanged public-v1 input.

No game logic or strategic feature construction lives in this module. The only
inductive bias is arranging the existing square categories/reveal references in
the same eight-row, four-column geometry used by GameCore.
"""
from __future__ import annotations

import math

import torch
from torch import nn
from torch.distributions import Categorical

INPUT_DIM = 2163
ACTION_COUNT = 1056
SQUARE_COUNT = 32
BOARD_ROWS = 8
BOARD_COLUMNS = 4
BOARD_CATEGORIES = 16
REFERENCE_CATEGORIES = 33
BOARD_CATEGORY_END = SQUARE_COUNT * BOARD_CATEGORIES  # 512
BOARD_INPUT_END = BOARD_CATEGORY_END + SQUARE_COUNT * REFERENCE_CATEGORIES  # 1568
PUBLIC_SIDE_DIM = INPUT_DIM - BOARD_INPUT_END  # inventory28 + globals7 + history560


def split_public_features(features):
    """Rearrange, without adding/dropping information, the existing flat input.

    Square s = row*4+column retains that exact location. Channel 0..15 is its
    board category; channel 16..48 is its stable public reveal-reference category.
    Inventory, public counters/assignment and padded history retain their original
    byte order in the separate side input.
    """
    if features.ndim != 2 or features.shape[1] != INPUT_DIM:
        raise ValueError(f"CNN requires [batch, {INPUT_DIM}] public-v1 features")
    batch = features.shape[0]
    categories = features[:, :BOARD_CATEGORY_END].reshape(batch, SQUARE_COUNT, BOARD_CATEGORIES)
    references = features[:, BOARD_CATEGORY_END:BOARD_INPUT_END].reshape(batch, SQUARE_COUNT, REFERENCE_CATEGORIES)
    board = torch.cat((categories, references), dim=-1)
    board = board.transpose(1, 2).reshape(batch, BOARD_CATEGORIES + REFERENCE_CATEGORIES, BOARD_ROWS, BOARD_COLUMNS)
    return board, features[:, BOARD_INPUT_END:]


class BoardCNNPolicy(nn.Module):
    """Compact stride-one CNN plus an encoder of the remaining public inputs."""

    def __init__(self, input_dim=INPUT_DIM, width=128, board_channels=32, architecture="cnn"):
        super().__init__()
        if input_dim != INPUT_DIM or architecture != "cnn":
            raise ValueError("BoardCNNPolicy requires architecture='cnn' and public-v1 input_dim=2163")
        if not isinstance(width, int) or width < 1 or not isinstance(board_channels, int) or board_channels < 1:
            raise ValueError("CNN widths must be positive integers")
        self.config = {
            "architecture": "cnn", "input_dim": input_dim,
            "width": width, "board_channels": board_channels,
        }
        self.board_encoder = nn.Sequential(
            nn.Conv2d(BOARD_CATEGORIES + REFERENCE_CATEGORIES, board_channels, kernel_size=3, stride=1, padding=1),
            nn.Tanh(),
            nn.Conv2d(board_channels, board_channels, kernel_size=3, stride=1, padding=1),
            nn.Tanh(),
            nn.Flatten(),
        )
        self.public_encoder = nn.Sequential(nn.Linear(PUBLIC_SIDE_DIM, width), nn.Tanh())
        self.body = nn.Sequential(
            nn.Linear(board_channels * SQUARE_COUNT + width, width), nn.Tanh(),
            nn.Linear(width, width), nn.Tanh(),
        )
        self.actor = nn.Linear(width, ACTION_COUNT)
        self.critic = nn.Linear(width, 1)
        for layer in self.modules():
            if isinstance(layer, (nn.Linear, nn.Conv2d)):
                nn.init.orthogonal_(layer.weight, gain=math.sqrt(2))
                nn.init.zeros_(layer.bias)
        nn.init.orthogonal_(self.actor.weight, gain=0.01)
        nn.init.orthogonal_(self.critic.weight, gain=1.0)

    def forward(self, features, masks):
        if masks.dtype != torch.bool or masks.ndim != 2 or masks.shape != (features.shape[0], ACTION_COUNT):
            raise ValueError("CNN requires a Boolean legal mask of shape [batch, 1056]")
        if not masks.any(dim=-1).all():
            raise ValueError("A policy decision must have at least one legal action")
        board, public = split_public_features(features)
        combined = torch.cat((self.board_encoder(board), self.public_encoder(public)), dim=-1)
        hidden = self.body(combined)
        logits = self.actor(hidden).masked_fill(~masks, -torch.inf)
        return Categorical(logits=logits), self.critic(hidden).squeeze(-1)


class SpatialTrunk(nn.Module):
    """Only the encoder modules from the historical 32-channel Exp1 model."""
    def __init__(self):
        super().__init__()
        historical = BoardCNNPolicy()
        self.board_encoder = historical.board_encoder
        self.public_encoder = historical.public_encoder
        self.fusion = historical.body

    def forward(self, features):
        board, public = split_public_features(features)
        combined = torch.cat((self.board_encoder(board), self.public_encoder(public)), dim=-1)
        return self.fusion(combined)
