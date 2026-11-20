import unittest

import numpy as np

from scripts.ai7_p0.common import paired_statistics, target_metrics
from scripts.ai7_p0.import_bundle import safe_name


class MetricTests(unittest.TestCase):
    def test_multiple_winning_actions_mass_membership_and_best_rank(self):
        result = target_metrics(np.array([.05, .2, .4, .35]), [3, 2, 1, 0], [1, 3])
        self.assertAlmostEqual(result["target_probability"], .55)
        self.assertEqual(result["uniform_probability"], .5)
        self.assertAlmostEqual(result["probability_over_uniform"], 1.1)
        self.assertEqual(result["top1_action"], 2)
        self.assertFalse(result["top1_correct"])
        self.assertEqual(result["best_target_rank"], 2)
        correct = target_metrics(np.array([.05, .2, .3, .45]), [0, 1, 2, 3], [1, 3])
        self.assertTrue(correct["top1_correct"])
        self.assertEqual(correct["best_target_rank"], 1)

    def test_legal_only_argmax_ties_and_invalid_targets(self):
        result = target_metrics(np.array([0., .5, .5, 0.]), [2, 1], [2])
        self.assertEqual(result["top1_action"], 1)
        self.assertEqual(result["top1_tie_count"], 2)
        self.assertFalse(result["top1_correct"])
        self.assertEqual(result["best_target_rank"], 1)
        for targets in [[], [0]]:
            with self.assertRaises(ValueError):
                target_metrics(np.array([0., .5, .5, 0.]), [1, 2], targets)

    def test_position_pair_bootstrap_counts_positions_not_orientations(self):
        result = paired_statistics([.1, .1, .1], resamples=4000)
        self.assertEqual(result["pairs"], 3)
        np.testing.assert_allclose(result["percentile95"], [.1, .1])
        self.assertEqual(result, paired_statistics([.1, .1, .1], resamples=4000))

    def test_archive_paths_cannot_escape_or_use_external_roots(self):
        self.assertEqual(safe_name("intel-evaluation-bundle/tactical-bank/stage2.json")[-1], "stage2.json")
        for name in ["/tmp/file", "../file", "intel-evaluation-bundle/../escape", "another-root/file", "intel-evaluation-bundle/back\\slash"]:
            with self.assertRaises(ValueError):
                safe_name(name)


if __name__ == "__main__":
    unittest.main()
