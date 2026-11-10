import type { PairedConfidence } from './tournament-types';

export function pairedConfidence(
  scores: readonly number[],
  confidenceLevel = 0.95,
): PairedConfidence {
  if (!Number.isFinite(confidenceLevel) || confidenceLevel <= 0 || confidenceLevel >= 1) {
    throw new RangeError('Confidence level must be strictly between zero and one.');
  }
  if (scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
    throw new RangeError('Pair scores must be finite values between zero and one.');
  }
  const samples = scores.length;
  const averageScoreA =
    samples === 0 ? null : scores.reduce((sum, score) => sum + score, 0) / samples;
  // Hoeffding applies to independent bounded PAIR scores, not the individual legs.
  const radius =
    samples === 0 ? null : Math.sqrt(Math.log(2 / (1 - confidenceLevel)) / (2 * samples));
  return {
    samples,
    averageScoreA,
    confidenceLevel,
    lower: averageScoreA === null || radius === null ? null : Math.max(0, averageScoreA - radius),
    upper: averageScoreA === null || radius === null ? null : Math.min(1, averageScoreA + radius),
    method: 'hoeffding-independent-pairs',
  };
}

export function percentile(values: readonly number[], p: number): number | null {
  if (!Number.isFinite(p) || p <= 0 || p > 1) {
    throw new RangeError('Percentile must be in (0, 1].');
  }
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Latency samples must be finite nonnegative values.');
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1]!;
}
