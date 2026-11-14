"""Byte equivalence against the original public-v1 encoder, on real Core games."""
from __future__ import annotations

import time
import unittest

import numpy as np

from scripts.ai7.runtime import Bridge, ROOT, encode


def reference_encode(observation):
    board = np.eye(16, dtype=np.float32)[observation["board"]].ravel()
    refs = np.eye(33, dtype=np.float32)[observation["references"]].ravel()
    inventory = np.asarray(observation["hiddenInventory"] + observation["remainingInventory"], dtype=np.float32) / 5
    globals_ = np.concatenate([
        np.eye(2, dtype=np.float32)[observation["player"]],
        np.eye(3, dtype=np.float32)[observation["color"]],
        np.asarray([observation["quiet"] / 60, observation["ply"] / 4096], dtype=np.float32),
    ])
    history = np.zeros((20, 28), dtype=np.float32)
    for row, event in enumerate(observation["history"]):
        kind, player, from_, to, mover, target, rank, color, captured, captured_color = event
        history[row] = np.concatenate([
            np.eye(2)[kind - 1], np.eye(2)[player - 1],
            np.asarray([from_, to, mover, target]) / 32,
            np.eye(7)[rank - 1], np.eye(2)[color - 1],
            np.eye(8)[captured], np.eye(3)[captured_color],
        ])
    return np.concatenate([board, refs, inventory, globals_, history.ravel()]).astype(np.float32)


class EncoderTests(unittest.TestCase):
    def test_real_public_prefixes_are_byte_identical(self):
        output = ROOT / f"benchmark-results/ai7-selfplay/correctness-encoder-{time.time_ns()}"
        bridge = Bridge(output)
        rng = np.random.default_rng(23)
        positions = 0
        saw_full_history = False
        try:
            states = bridge.request(command="reset", games=[{"id": i, "seed": seed} for i, seed in enumerate([11, 23, 37, 70037])])
            for _ in range(300):
                actions = []
                for state in states:
                    observation = state["observation"]
                    expected = reference_encode(observation)
                    actual = encode(observation)
                    self.assertEqual(actual.dtype, np.dtype("float32"))
                    self.assertEqual(actual.tobytes(), expected.tobytes())
                    saw_full_history |= len(observation["history"]) == 20
                    positions += 1
                    actions.append({"id": state["id"], "action": int(rng.choice(observation["legal"]))})
                if not actions:
                    break
                states = [state for state in bridge.request(command="step", actions=actions) if not state["terminated"]]
        finally:
            bridge.close()
        self.assertGreater(positions, 400)
        self.assertTrue(saw_full_history)

    def test_categorical_and_counter_boundaries_are_byte_identical(self):
        rng = np.random.default_rng(37)
        for history_length in [0, 1, 19, 20]:
            observation = {
                "board": rng.integers(0, 16, 32).tolist(),
                "references": rng.integers(0, 33, 32).tolist(),
                "hiddenInventory": rng.integers(0, 6, 14).tolist(),
                "remainingInventory": rng.integers(0, 6, 14).tolist(),
                "player": 1, "color": 0, "quiet": 59, "ply": 4095,
                "history": [[int(rng.integers(1, 3)), int(rng.integers(1, 3)), *rng.integers(0, 33, 4).tolist(), int(rng.integers(1, 8)), int(rng.integers(1, 3)), int(rng.integers(0, 8)), int(rng.integers(0, 3))] for _ in range(history_length)],
                "legal": [0],
            }
            self.assertEqual(encode(observation).tobytes(), reference_encode(observation).tobytes())


if __name__ == "__main__":
    unittest.main()
