import { describe, expect, it, vi } from 'vitest';
import * as core from '../../game-core/src/index';
import { accept, tacticalSnapshot } from '../../game-core/tests/public-projection-fixtures';
import { deepFreeze } from '../../game-core/tests/fixtures';
import {
  evaluatePosition,
  evaluateProgressPosition,
  getProgressState,
  countPublicPositionReturns,
  explainProgressDecision,
  explainTacticalDecision,
  searchPublicPosition,
  type AgentInput,
} from '../src/index';

const move = (from: number, to: number): core.GameAction => ({ type: 'MOVE', from, to });
function fixture(quiet: number) {
  const f = tacticalSnapshot([
    [0, 'RED', 'ADVISOR'],
    [4, 'RED', 'SOLDIER'],
    [31, 'BLACK', 'HORSE'],
    [16, 'RED', 'CANNON', false],
  ]);
  const cycle = [move(0, 1), move(31, 30), move(1, 0), move(30, 31)];
  for (let i = 0; i < quiet; i++) accept(f, cycle[i % 4]!);
  const input: AgentInput = {
    observation: core.getObservation(f.state),
    publicHistory: f.history,
    legalActions: core.getLegalActions(f.state, f.state.currentPlayer),
    perspective: f.state.currentPlayer,
  };
  return { f, input };
}

describe('AI-6B public progress awareness', () => {
  it.each([0, 40, 58, 59])(
    'derives quiet%s and remaining plies from an accepted prefix',
    (quiet) => {
      const { input } = fixture(quiet);
      expect(getProgressState(input)).toEqual({ quietPlies: quiet, remainingPlies: 60 - quiet });
      expect(evaluateProgressPosition(input).total).toBeLessThanOrEqual(
        evaluatePosition(input).total + 1,
      );
    },
  );
  it('discounts the material lead symmetrically and preserves threat/mobility contributions', () => {
    const { input } = fixture(48);
    const ahead = evaluateProgressPosition(input);
    const behind = evaluateProgressPosition({ ...input, perspective: 'P2' });
    expect(ahead.base.material.raw).toBeGreaterThan(0);
    expect(ahead.pressure).toBe(0.4);
    expect(ahead.adjustment).toBe(-ahead.base.material.contribution * 0.4);
    expect(ahead.total).toBeCloseTo(ahead.base.total + ahead.adjustment, 12);
    expect(behind.adjustment).toBeCloseTo(-ahead.adjustment, 12);
    expect(behind.total).toBeCloseTo(-ahead.total, 12);
  });
  it('keeps terminal draws zero and wins/losses dominant at quiet60', () => {
    const { f, input } = fixture(59);
    accept(f, move(30, 31));
    const terminal = {
      ...input,
      observation: core.getObservation(f.state),
      publicHistory: f.history,
    };
    expect(terminal.observation.result).toEqual({ type: 'DRAW', reason: 'NO_PROGRESS' });
    expect(evaluateProgressPosition(terminal).total).toBe(0);
    for (const winner of ['P1', 'P2'] as const) {
      const winning = {
        ...terminal,
        observation: {
          ...terminal.observation,
          result: { type: 'WIN' as const, winner, reason: 'NO_PIECES' as const },
        },
      };
      expect(evaluateProgressPosition(winning).total).toBe(winner === input.perspective ? 2 : -2);
    }
  });
  it('FLIP resets quiet pressure, not material, and public returns are only diagnostics', () => {
    const { f, input } = fixture(48);
    expect(countPublicPositionReturns(input)).toBe(12);
    accept(f, { type: 'FLIP', position: 16 });
    const next = { ...input, observation: core.getObservation(f.state), publicHistory: f.history };
    expect(getProgressState(next).quietPlies).toBe(0);
    expect(countPublicPositionReturns(next)).toBe(0);
    expect(evaluateProgressPosition(next).adjustment).toBe(0);
    expect(evaluatePosition(next).material).toEqual(evaluatePosition(input).material);
  });
  it('has no early-game bonus and preserves the existing search with the feature off', () => {
    const { input } = fixture(0);
    const base = explainTacticalDecision(input, { seed: 3 });
    const off = searchPublicPosition(
      input,
      { seed: 3 },
      {},
      {},
      (_, evaluation) => evaluation!.total,
    );
    expect(off).toEqual(base);
    expect(evaluateProgressPosition(input).adjustment).toBe(0);
  });
  it.each(['SOLDIER', 'CHARIOT'] as const)(
    'makes safe progress but prepares before a dangerous %s reveal',
    (rank) => {
      const position = rank === 'SOLDIER' ? 16 : 8;
      const f = tacticalSnapshot([
        [0, 'RED', 'ADVISOR'],
        [4, 'RED', 'SOLDIER'],
        [31, 'BLACK', 'HORSE'],
        [position, 'BLACK', rank, false],
      ]);
      const cycle = [move(0, 1), move(31, 30), move(1, 0), move(30, 31)];
      for (let i = 0; i < 48; i++) accept(f, cycle[i % 4]!);
      const input: AgentInput = {
        observation: core.getObservation(f.state),
        publicHistory: f.history,
        legalActions: core.getLegalActions(f.state, 'P1'),
        perspective: 'P1',
      };
      const decision = explainProgressDecision(input, { seed: 3 });
      if (rank === 'CHARIOT') {
        expect(decision.selectedAction).toEqual(move(4, 5));
      } else {
        expect(explainTacticalDecision(input, { seed: 3 }).selectedAction).toEqual(move(4, 8));
        expect(decision.selectedAction).toEqual({ type: 'FLIP', position });
        accept(f, decision.selectedAction);
        expect(f.state.noProgressCount).toBe(0);
        expect(
          core
            .getLegalActions(f.state, 'P2')
            .every((a) => a.type !== 'MOVE' || f.state.board[a.to] === null),
        ).toBe(true);
      }
    },
  );
  it('is immutable, deterministic and reconstructs once despite thousands of projections', () => {
    const { input } = fixture(48);
    deepFreeze(input);
    const snapshot = JSON.stringify(input);
    const rebuild = vi.spyOn(core, 'createPublicProjectionContext');
    try {
      const a = explainProgressDecision(input, { seed: 9 });
      expect(rebuild).toHaveBeenCalledTimes(1);
      expect(a.diagnostics.projections).toBeLessThanOrEqual(8192);
      expect(input.legalActions).toContainEqual(a.selectedAction);
      expect(explainProgressDecision(input, { seed: 9 })).toEqual(a);
      expect(JSON.stringify(input)).toBe(snapshot);
    } finally {
      rebuild.mockRestore();
    }
  });
});
