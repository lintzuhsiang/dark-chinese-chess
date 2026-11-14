import { describe, expect, it } from 'vitest';
import { createEvaluationProbes } from '../probes';

describe('evaluation-only public tactical probes', () => {
  it('uses only public network inputs and Core-legal action groups', () => {
    const result = createEvaluationProbes();
    expect(result.evaluationOnly).toBe(true);
    expect(result.probes).toHaveLength(8);
    expect(new Set(result.probes.map((probe) => probe.category))).toEqual(
      new Set([
        'immediate_capture',
        'avoid_immediate_loss',
        'flip_risk',
        'endgame_conversion',
        'repetition_break',
      ]),
    );
    for (const probe of result.probes) {
      expect(probe.evaluationOnly).toBe(true);
      expect(Object.keys(probe.observation).sort()).toEqual(
        [
          'board',
          'references',
          'hiddenInventory',
          'remainingInventory',
          'history',
          'player',
          'color',
          'quiet',
          'ply',
          'legal',
        ].sort(),
      );
      for (const actions of Object.values(probe.groups))
        for (const action of actions) expect(probe.observation.legal).toContain(action);
    }
  });

  it('computes FLIP risk over public inventory rather than actual hidden identities', () => {
    const probe = createEvaluationProbes().probes.find((probe) => probe.category === 'flip_risk')!;
    expect(probe.observation.hiddenInventory.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(probe.immediateLossRisk[10]).toBe(0.5);
    expect(probe.immediateLossRisk[31]).toBe(0);
    expect(probe.groups.lowest_flip_risk).toEqual([31]);
    expect(probe.groups.highest_flip_risk).toEqual([10]);
  });

  it('separates immediate winning conversion from repeating quiet actions', () => {
    const probe = createEvaluationProbes().probes.find(
      (probe) => probe.category === 'repetition_break',
    )!;
    expect(probe.observation.quiet).toBe(56);
    expect(probe.groups.repetition_winning_break).toEqual([330]);
    expect(probe.groups.repeated_position).toEqual([328]);
    expect(
      probe.groups.repetition_winning_break.some((id) =>
        probe.groups.repeated_position.includes(id),
      ),
    ).toBe(false);
  });
});
