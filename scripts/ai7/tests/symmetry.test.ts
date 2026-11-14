import { describe, expect, it } from 'vitest';
import { createEnvironment } from '../environment';
import { rotateAction, rotateId, rotateInput, validateRotation } from '../symmetry';

describe('evaluation-only rotation', () => {
  it('maps all 1056 action IDs bijectively and is an involution', () => {
    const ids = Array.from({ length: 1056 }, (_, i) => i);
    expect(new Set(ids.map(rotateId)).size).toBe(1056);
    expect(ids.map(rotateId).map(rotateId)).toEqual(ids);
    expect(rotateAction({ type: 'MOVE', from: 0, to: 4 })).toEqual({
      type: 'MOVE',
      from: 31,
      to: 27,
    });
  });
  it('replays hidden flips and histories through Core and detects corruption', () => {
    const env = createEnvironment(11000099);
    for (let i = 0; i < 25; i++) {
      const o = env.observe();
      env.step(o.legal[(i * 7) % o.legal.length]!);
    }
    const archive = env.archive();
    const result = validateRotation(archive);
    expect(result.validation.prefixChecks).toBe(26);
    expect(rotateInput(rotateInput(result.observation))).toEqual({
      ...result.observation,
      legal: [...result.observation.legal].sort((a, b) => a - b),
    });
    const history = [...archive.publicHistory];
    history[0] = { ...history[0]!, ply: 100 };
    expect(() => validateRotation({ ...archive, publicHistory: history })).toThrow(
      'original full history',
    );
  });
});
