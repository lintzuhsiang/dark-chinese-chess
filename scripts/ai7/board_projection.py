"""32-d actor feature derived solely from the public-v1 square categories."""
from torch import nn


class BoardProjection(nn.Module):
    def __init__(self, timing):
        super().__init__()
        if timing not in ("pre", "after"):
            raise ValueError("Expected pre or after board timing")
        self.timing = timing
        self.linear = nn.Linear(512, 32)

    def forward(self, features, rows, ids, source, target):
        flat = features[:, :512]
        base = self.linear(flat)
        if self.timing == "pre":
            return base.tanh()[rows].masked_fill((ids < 32)[:, None], 0)

        # W times a one-hot square selects one column. For each legal MOVE,
        # replace source:mover -> empty (category 0), target:old -> mover.
        # public-v1 observations are constants; all selected weights keep gradients.
        category = flat.reshape(-1, 32, 16).argmax(dim=-1)
        mover = category[rows, source]
        previous = category[rows, target]
        columns = self.linear.weight.T
        source_offset = source * 16
        target_offset = target * 16
        delta = ((columns[source_offset] - columns[source_offset + mover])
                 + (columns[target_offset + mover] - columns[target_offset + previous]))
        return (base[rows] + delta).tanh().masked_fill((ids < 32)[:, None], 0)
