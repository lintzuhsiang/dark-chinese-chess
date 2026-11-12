import { describe, expect, it } from 'vitest';
import { diagnoseChaseV3 } from '../../../verification/chase-v3-diagnostics';

// The fixture source and its historical intended descriptions are retained unchanged.
// These assertions describe v4 evaluation of those action sequences, not v3 results.
describe('v4 evaluation of unchanged historical chase diagnostic prefixes', () => {
  const cases = diagnoseChaseV3();
  const get = (name: string) => {
    const c = cases.find((c) => c.name === name);
    if (!c) throw Error(name);
    return c;
  };
  it('replays all nine accepted prefixes and compares public/private results', () => {
    expect(cases).toHaveLength(9);
    expect(cases.every((c) => c.replayed && c.steps.length === c.actions.length)).toBe(true);
  });
  it('rejects the third same-coordinate appearance', () => {
    expect(get('third-appearance').rejection).toBe('PERPETUAL_CHASE');
  });
  it.each([
    'changing-position-pursuit',
    'pair-switch',
    'flip-reset',
    'capture-reset',
    'direct-capture-control',
    'reciprocal-shuffle-control',
  ])('accepts the historical %s sequence under v4', (name) =>
    expect(get(name).rejection).toBeNull(),
  );
  it.each(['initial-fork', 'renewed-fork'])(
    'records every new target of %s independently',
    (name) => {
      const step = get(name).steps.at(-1)!;
      expect(step.after!.records.filter((r) => r.ply === step.ply)).toHaveLength(2);
    },
  );
});
