"""E2a-G policy scoring with shared weights generated from public action geometry."""
from __future__ import annotations

import torch
from torch import nn
from torch.nn import functional as F

from .runtime import ACTION_COUNT, Policy


def action_geometry():
    """Match environment.ts's action IDs and GameCore's row-major 8×4 board."""
    rows, columns = 8, 4
    squares = rows * columns
    ids = torch.arange(ACTION_COUNT)
    move = ids >= squares
    move_id = (ids - squares).clamp_min(0)
    source = move_id // squares
    target = torch.where(move, move_id % squares, ids)
    source_row, source_col = source // columns, source % columns
    target_row, target_col = target // columns, target % columns
    return torch.stack([
        move.float(),
        torch.where(move, source_row / (rows - 1), -1.0),
        torch.where(move, source_col / (columns - 1), -1.0),
        target_row / (rows - 1),
        target_col / (columns - 1),
        torch.where(move, (target_row - source_row) / (rows - 1), 0.0),
        torch.where(move, (target_col - source_col) / (columns - 1), 0.0),
    ], dim=1)


class GeometryHead(nn.Module):
    def __init__(self, width):
        super().__init__()
        self.register_buffer("geometry", action_geometry(), persistent=False)
        # For a 128-wide trunk this gives 136,033 parameters versus 136,224 in E0.
        self.generator = nn.Sequential(nn.Linear(7, 992), nn.Tanh(), nn.Linear(992, width + 1))
        # Start with weak logits, as in E0. Shared features can correlate nearby logits.
        nn.init.orthogonal_(self.generator[-1].weight, gain=.01)
        nn.init.zeros_(self.generator[-1].bias)

    def forward(self, hidden):
        latent = self.generator[1](self.generator[0](self.geometry))
        output = self.generator[-1]
        if hidden.shape[0] <= 64:
            # Associate h · (W z + b) as (h W) · z + h · b. For small
            # rollout batches this avoids materializing 1056 action weights.
            projected = F.linear(hidden, output.weight[:-1].T, output.weight[-1])
            bias = F.linear(hidden, output.bias[:-1].unsqueeze(0), output.bias[-1:])
            return F.linear(projected, latent) + bias
        # The generated matrix is cheaper to share across large minibatches.
        # Recompute each forward and retain the graph for PPO in both paths.
        weights_and_bias = output(latent)
        return F.linear(hidden, weights_and_bias[:, :-1], weights_and_bias[:, -1])


class GeometryPolicy(Policy):
    def __init__(self, input_dim=2163, width=128, architecture="e2a_g"):
        if architecture != "e2a_g":
            raise ValueError("GeometryPolicy requires e2a_g architecture")
        # Keep E0's exact trunk/value initialization and masked categorical forward.
        super().__init__(input_dim=input_dim, width=width)
        self.config["architecture"] = architecture
        self.actor = GeometryHead(width)
