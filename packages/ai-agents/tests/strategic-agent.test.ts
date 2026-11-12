import { describe, expect, it, vi } from 'vitest';
import * as core from '../../game-core/src/index';
import { accept, tacticalSnapshot } from '../../game-core/tests/public-projection-fixtures';
import { deepFreeze } from '../../game-core/tests/fixtures';
import {
  evaluateStrategicPosition,
  explainStrategicDecision,
  explainProgressDecision,
  STRATEGIC_PRESETS,
  type AgentInput,
} from '../src/index';

const move = (from: number, to: number): core.GameAction => ({ type: 'MOVE', from, to });
const input = (f: ReturnType<typeof tacticalSnapshot>): AgentInput => ({
  observation: core.getObservation(f.state),
  publicHistory: f.history,
  legalActions: core.getLegalActions(f.state, f.state.currentPlayer),
  perspective: f.state.currentPlayer,
});
const all = { proximity: true, blockers: true, cannon: true };

describe('AI-6C independent public strategic candidates', () => {
  it('prefers approach while ahead and retreat while behind without adding another material score', () => {
    const f = tacticalSnapshot([
      [0, 'RED', 'GENERAL'],
      [4, 'RED', 'CHARIOT'],
      [31, 'BLACK', 'HORSE'],
    ]);
    const before = input(f);
    const a = evaluateStrategicPosition(before, STRATEGIC_PRESETS.proximity);
    accept(f, move(4, 8));
    const after = { ...input(f), perspective: 'P1' as const };
    const b = evaluateStrategicPosition(after, STRATEGIC_PRESETS.proximity);
    expect(a.proximity).toBeGreaterThan(0);
    expect(b.proximity).toBeGreaterThan(a.proximity);
    expect(b.progress.base.material).toEqual(a.progress.base.material);
    expect(
      evaluateStrategicPosition({ ...after, perspective: 'P2' }, STRATEGIC_PRESETS.proximity)
        .proximity,
    ).toBeCloseTo(-b.proximity, 12);
  });
  it('uses hidden blockers only as occupancy and measures multi-step access', () => {
    const f = tacticalSnapshot([
      [0, 'RED', 'GENERAL'],
      [31, 'BLACK', 'HORSE'],
      [4, 'RED', 'SOLDIER', false],
      [5, 'RED', 'SOLDIER', false],
      [6, 'BLACK', 'SOLDIER', false],
      [7, 'BLACK', 'SOLDIER', false],
    ]);
    const request = input(f);
    const score = evaluateStrategicPosition(request, STRATEGIC_PRESETS.blockers);
    expect(score.blockers).toBe(-20 / 32);
    const board = [...f.state.board];
    [board[4], board[6]] = [board[6]!, board[4]!];
    expect(core.getObservation({ ...f.state, board })).toEqual(request.observation);
    expect(
      evaluateStrategicPosition(
        { ...request, observation: core.getObservation({ ...f.state, board }) },
        STRATEGIC_PRESETS.blockers,
      ),
    ).toEqual(score);
  });
  it.each([0, 1, 2])('Cannon setup delegates %s-screen legality to Core', (screens) => {
    const entries: Parameters<typeof tacticalSnapshot>[0] = [
      [1, 'RED', 'CANNON'],
      [12, 'BLACK', 'GENERAL'],
      [31, 'BLACK', 'HORSE'],
      ...[8, 4].slice(0, screens).map((p) => [p, 'RED', 'SOLDIER', false] as const),
    ];
    const request = input(tacticalSnapshot(entries));
    const score = evaluateStrategicPosition(request, STRATEGIC_PRESETS.cannon);
    expect(score.cannon).toBe(screens === 1 ? 8 / 64 : 0);
  });
  it('does not recount a Cannon victim already threatened by the side', () => {
    const f = tacticalSnapshot([
      [1, 'RED', 'CANNON'],
      [20, 'RED', 'CANNON'],
      [8, 'RED', 'SOLDIER', false],
      [16, 'BLACK', 'SOLDIER', false],
      [12, 'BLACK', 'GENERAL'],
      [31, 'BLACK', 'HORSE'],
    ]);
    expect(evaluateStrategicPosition(input(f), STRATEGIC_PRESETS.cannon).cannon).toBe(0);
  });
  it('preserves rotational symmetry, fixed perspective and bounded terminal values', () => {
    const request = input(
      tacticalSnapshot([
        [1, 'RED', 'CANNON'],
        [8, 'RED', 'SOLDIER', false],
        [12, 'BLACK', 'GENERAL'],
        [31, 'BLACK', 'HORSE'],
      ]),
    );
    const score = evaluateStrategicPosition(request, all);
    const rotated = {
      ...request,
      observation: { ...request.observation, board: [...request.observation.board].reverse() },
    };
    expect(evaluateStrategicPosition(rotated, all)).toEqual(score);
    expect(evaluateStrategicPosition({ ...request, perspective: 'P2' }, all).total).toBeCloseTo(
      -score.total,
      12,
    );
    expect(Math.abs(score.total)).toBeLessThanOrEqual(1);
    const draw = {
      ...request,
      observation: {
        ...request.observation,
        status: 'FINISHED' as const,
        result: { type: 'DRAW' as const, reason: 'NO_PROGRESS' as const },
      },
    };
    expect(evaluateStrategicPosition(draw, all).total).toBe(0);
    const win = {
      ...draw,
      observation: {
        ...draw.observation,
        result: { type: 'WIN' as const, winner: request.perspective, reason: 'NO_PIECES' as const },
      },
    };
    expect(evaluateStrategicPosition(win, all).total).toBe(2);
  });
  it('keeps feature-off exact parity with frozen6B', () => {
    const request = input(
      tacticalSnapshot([
        [9, 'RED', 'SOLDIER'],
        [10, 'BLACK', 'GENERAL'],
        [31, 'BLACK', 'SOLDIER'],
      ]),
    );
    expect(explainStrategicDecision(request, { seed: 3 })).toEqual(
      explainProgressDecision(request, { seed: 3 }),
    );
  });
  it.each(['proximity', 'blockers', 'cannon'] as const)(
    '%s keeps immutable public inputs, deterministic decisions and one root reconstruction',
    (feature) => {
      const request = deepFreeze(
        input(
          tacticalSnapshot([
            [1, 'RED', 'CANNON'],
            [8, 'RED', 'SOLDIER', false],
            [12, 'BLACK', 'GENERAL'],
            [31, 'BLACK', 'HORSE'],
          ]),
        ),
      );
      const snapshot = JSON.stringify(request);
      const rebuild = vi.spyOn(core, 'createPublicProjectionContext');
      try {
        const a = explainStrategicDecision(request, { seed: 4 }, STRATEGIC_PRESETS[feature]);
        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(a.diagnostics.projections).toBeLessThanOrEqual(8192);
        expect(a.diagnostics.limits).toEqual({
          maxDepth: 6,
          projectionBudget: 8192,
          rootWidth: 8,
          interiorWidth: 4,
          alphaBeta: true,
        });
        expect(request.legalActions).toContainEqual(a.selectedAction);
        expect(explainStrategicDecision(request, { seed: 4 }, STRATEGIC_PRESETS[feature])).toEqual(
          a,
        );
        expect(JSON.stringify(request)).toBe(snapshot);
      } finally {
        rebuild.mockRestore();
      }
    },
  );
});
