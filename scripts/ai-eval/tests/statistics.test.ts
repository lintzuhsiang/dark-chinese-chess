import { describe, expect, it } from 'vitest';
import { pairedConfidence, percentile } from '../statistics';

describe('independent paired confidence oracle', () => {
  it('uses one bounded observation per pair rather than two game observations', () => {
    const result = pairedConfidence(Array.from({ length: 40 }, () => 0.5));
    // Independent reference: log(40) = 3.6888794541139363 at 95% confidence.
    const radiusForFortyPairs = Math.sqrt(3.6888794541139363 / 80);
    const incorrectRadiusForEightyGames = Math.sqrt(3.6888794541139363 / 160);
    expect(result).toMatchObject({
      method: 'hoeffding-independent-pairs',
      confidenceLevel: 0.95,
      samples: 40,
      averageScoreA: 0.5,
    });
    expect(result.lower).toBeCloseTo(0.5 - radiusForFortyPairs, 12);
    expect(result.upper).toBeCloseTo(0.5 + radiusForFortyPairs, 12);
    expect(result.upper).not.toBeCloseTo(0.5 + incorrectRadiusForEightyGames, 8);
  });

  it('reports zero-pair estimates as null and one-pair uncertainty as the full bounded range', () => {
    expect(pairedConfidence([])).toMatchObject({
      samples: 0,
      averageScoreA: null,
      lower: null,
      upper: null,
    });
    expect(pairedConfidence([0.5])).toMatchObject({
      samples: 1,
      averageScoreA: 0.5,
      lower: 0,
      upper: 1,
    });
    expect(JSON.stringify(pairedConfidence([]))).not.toMatch(/NaN|Infinity/);
  });

  it('computes the mean of pair scores and clips limits to the score range', () => {
    const result = pairedConfidence([0, 0.5, 1, 1], 0.8);
    expect(result.averageScoreA).toBe(0.625);
    expect(result.confidenceLevel).toBe(0.8);
    expect(result.lower).toBeCloseTo(0.625 - Math.sqrt(2.302585092994046 / 8), 12);
    expect(result.upper).toBe(1);
  });

  it.each([0, 1, -0.1, 1.1, NaN, Infinity])('rejects invalid confidence %s', (confidence) => {
    expect(() => pairedConfidence([0.5], confidence)).toThrow();
  });

  it.each([-0.1, 1.1, NaN, Infinity])('rejects invalid bounded pair observation %s', (score) => {
    expect(() => pairedConfidence([score])).toThrow();
  });
});

describe('independent nearest-rank latency oracle', () => {
  it('uses sorted nearest ranks without mutating the observations', () => {
    const samples = [9, 1, 7, 3, 5];
    const before = [...samples];
    expect(percentile(samples, 0.5)).toBe(5);
    expect(percentile(samples, 0.95)).toBe(9);
    expect(percentile([7, 1, 4, 11], 0.5)).toBe(4);
    expect(percentile([9, 3], 0.5)).toBe(3);
    expect(percentile(samples, 1)).toBe(9);
    expect(samples).toEqual(before);
  });

  it('distinguishes no measured decisions from zero-latency decisions', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([0], 0.95)).toBe(0);
  });

  it.each([0, -0.1, 1.1, NaN])('rejects invalid percentile %s', (p) => {
    expect(() => percentile([1], p)).toThrow();
  });

  it.each([-1, NaN, Infinity])('rejects invalid latency sample %s', (sample) => {
    expect(() => percentile([sample], 0.5)).toThrow();
  });
});
