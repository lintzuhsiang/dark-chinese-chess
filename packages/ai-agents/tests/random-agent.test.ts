import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAction } from '../../game-core/src/index';
import { initialState } from '../../game-core/tests/fixtures';
import { createAgentInput } from '../../../scripts/ai-eval/agent-input';
import { createSeededRandom, randomAgent } from '../src/index';

afterEach(() => vi.restoreAllMocks());

describe('Mulberry32-v1', () => {
  it('matches a fixed reference sequence and has independent stream state', () => {
    const first = createSeededRandom(1);
    const second = createSeededRandom(1);
    const expected = [
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
      0.9683778982143849,
    ];
    expect(expected.map(() => first())).toEqual(expected);
    expect(expected.map(() => second())).toEqual(expected);
  });

  it.each([0, 0xffffffff])(
    'accepts boundary seed %s and returns finite samples in [0, 1)',
    (seed) => {
      const random = createSeededRandom(seed);
      for (let count = 0; count < 100; count += 1) {
        const value = random();
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    },
  );

  it.each([-1, 0x100000000, 0.5, NaN, Infinity, -Infinity])('rejects invalid seed %s', (seed) => {
    expect(() => createSeededRandom(seed)).toThrow(RangeError);
  });
});

describe('Random Agent', () => {
  it('selects only supplied permitted actions for both seats without uncontrolled randomness', async () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Uncontrolled randomness.');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Wall-clock-dependent policy.');
    });
    const initial = initialState();
    const first = applyAction(initial, 'P1', { type: 'FLIP', position: 0 });
    if (!first.ok) throw new Error('Expected valid opening.');
    const inputs = [
      createAgentInput(initial, [], 'P1'),
      createAgentInput(first.state, [first.event], 'P2'),
    ];
    for (const input of inputs) {
      const before = JSON.stringify(input);
      for (let seed = 0; seed < 50; seed += 1) {
        const action = await randomAgent.chooseAction(input, { seed });
        expect(input.legalActions).toContainEqual(action);
        expect(await randomAgent.chooseAction(input, { seed })).toEqual(action);
        expect(input.legalActions).not.toContain(action);
      }
      expect(JSON.stringify(input)).toBe(before);
    }
  });

  it('returns clean copied MOVE actions', async () => {
    const initial = createAgentInput(initialState(), [], 'P1');
    const input = {
      ...initial,
      legalActions: [{ type: 'MOVE' as const, from: 0, to: 1, privateExtra: 'exclude' }],
    };
    expect(await randomAgent.chooseAction(input, { seed: 5 })).toEqual({
      type: 'MOVE',
      from: 0,
      to: 1,
    });
  });

  it('rejects an empty action list and invalid decision seed', async () => {
    const input = createAgentInput(initialState(), [], 'P1');
    await expect(
      randomAgent.chooseAction({ ...input, legalActions: [] }, { seed: 0 }),
    ).rejects.toThrow('at least one permitted action');
    await expect(randomAgent.chooseAction(input, { seed: -1 })).rejects.toThrow(RangeError);
  });
});
