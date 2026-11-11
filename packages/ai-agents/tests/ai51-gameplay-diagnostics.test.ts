import { describe, expect, it } from 'vitest';
import {
  getLegalActions,
  getObservation,
  getPublicOrdinaryMoves,
  projectPermittedPublicAction,
  type GameAction,
} from '../../game-core/src/index';
import { accept, type ProjectionFixture } from '../../game-core/tests/public-projection-fixtures';
import { evaluatePosition, explainExpectedValueDecision, type AgentInput } from '../src/index';

import { sacrifice, stall, replay } from './ai51-fixtures';

function input(fixture: ProjectionFixture): AgentInput {
  return {
    observation: getObservation(fixture.state),
    legalActions: getLegalActions(fixture.state, fixture.state.currentPlayer),
    publicHistory: fixture.history,
    perspective: fixture.state.currentPlayer,
  };
}

function move(from: number, to: number): GameAction {
  return { type: 'MOVE', from, to };
}

describe('AI-5.1 gameplay diagnostics: unchanged one-step policy', () => {
  it('reproduces a safe/losing tie that net threat and current weights cannot distinguish', () => {
    const fixture = replay(sacrifice);
    const request = input(fixture);
    expect(fixture.state.plyCount).toBe(176);
    expect(fixture.state.noProgressCount).toBe(37);
    const decision = explainExpectedValueDecision(request, { seed: sacrifice.seed });
    expect(request.observation.playerColors.P1).toBe('BLACK');
    expect(decision.distribution.outcomes).toEqual([
      { piece: { color: 'RED', rank: 'SOLDIER' }, count: 1, probability: 1 },
    ]);
    expect(decision.selectedAction).toEqual(move(10, 14));
    expect(request.legalActions).toContainEqual(decision.selectedAction);
    const candidates = decision.actionEvaluations.filter(
      (candidate) => candidate.action.type === 'MOVE',
    );
    const safe = candidates.find(
      (candidate) => candidate.action.type === 'MOVE' && candidate.action.to === 9,
    )!;
    const unsafe = candidates.find(
      (candidate) => candidate.action.type === 'MOVE' && candidate.action.to === 14,
    )!;
    if (!('evaluation' in safe) || !('evaluation' in unsafe))
      throw new Error('Expected MOVE evaluations.');
    expect(safe.expectedScore).toBe(unsafe.expectedScore);
    expect(safe.expectedScore).toBeCloseTo(-0.23689516129032256, 14);
    expect([safe.evaluation.threat.friendly, safe.evaluation.threat.enemy]).toEqual([0, 5]);
    expect([unsafe.evaluation.threat.friendly, unsafe.evaluation.threat.enemy]).toEqual([6, 11]);
    for (const candidate of [safe, unsafe]) {
      expect([
        candidate.evaluation.material.raw,
        candidate.evaluation.threat.raw,
        candidate.evaluation.mobility.raw,
      ]).toEqual([-25, 5, -20]);
      expect(candidate.evaluation.terminal).toBe(false);
    }
    // The next turn can win immediately; this is outside the policy's one-step horizon.
    const first = projectPermittedPublicAction(request, decision.selectedAction);
    if (!first.ok) throw new Error(first.error.code);
    const reply = projectPermittedPublicAction(
      { observation: first.observation, publicHistory: [...request.publicHistory, first.event] },
      move(18, 14),
    );
    if (!reply.ok) throw new Error(reply.error.code);
    expect(reply.observation.result).toEqual({ type: 'WIN', winner: 'P2', reason: 'NO_PIECES' });
    expect(
      evaluatePosition({
        observation: reply.observation,
        publicHistory: [...request.publicHistory, first.event, reply.event],
        perspective: 'P1',
      }).total,
    ).toBe(-2);
    accept(fixture, decision.selectedAction);
    const opponent = explainExpectedValueDecision(input(fixture), { seed: 0 });
    // Enumerating every permitted reply (including public FLIP outcomes) confirms
    // that this capture is a strongest immediate response, not a guessed tactic.
    expect(
      Math.max(...opponent.actionEvaluations.map((candidate) => candidate.expectedScore)),
    ).toBe(2);
    accept(fixture, move(18, 14));
    expect(getObservation(fixture.state)).toEqual(reply.observation);
  });

  it('reproduces an ahead position preferring a quiet MOVE while a next-turn draw is available', () => {
    const fixture = replay(stall);
    const request = input(fixture);
    expect(fixture.state.plyCount).toBe(75);
    expect(fixture.state.noProgressCount).toBe(58);
    expect(fixture.state.chase?.phase).toBe('ESCAPE');
    const decision = explainExpectedValueDecision(request, { seed: stall.seed });
    expect(decision.currentEvaluation.material.raw).toBe(7);
    expect(decision.distribution.totalHidden).toBe(19);
    expect(decision.selectedAction).toEqual(move(10, 14));
    const flips = decision.actionEvaluations.filter(
      (candidate) => candidate.action.type === 'FLIP',
    );
    expect(flips).toHaveLength(19);
    const bestFlip = flips.reduce((best, candidate) =>
      candidate.expectedScore > best.expectedScore ? candidate : best,
    );
    expect(bestFlip.action).toEqual({ type: 'FLIP', position: 29 });
    expect(bestFlip.expectedScore).toBeCloseTo(0.057300509337860774, 14);
    const chosen = decision.actionEvaluations.find(
      (candidate) => candidate.action.type === 'MOVE' && candidate.action.from === 10,
    )!;
    expect(chosen.expectedScore).toBeCloseTo(0.07106854838709677, 14);
    expect(chosen.expectedScore).toBeGreaterThan(bestFlip.expectedScore);
    // A reveal never creates material; all public outcomes keep the captured ledger's value.
    for (const candidate of flips) {
      if (!('outcomes' in candidate)) throw new Error('Expected FLIP outcomes.');
      for (const outcome of candidate.outcomes) expect(outcome.evaluation.material.raw).toBe(7);
    }
    accept(fixture, decision.selectedAction);
    expect(fixture.state.noProgressCount).toBe(59);
    expect(fixture.state.chase?.phase).toBe('RENEW');
    const opponent = explainExpectedValueDecision(input(fixture), { seed: 0 });
    expect(
      Math.max(...opponent.actionEvaluations.map((candidate) => candidate.expectedScore)),
    ).toBe(0);
    // The historical Heuristic opponent chose this quiet draw. All its FLIPs
    // have negative expected value from its own fixed perspective here.
    expect(
      opponent.actionEvaluations
        .filter((candidate) => candidate.action.type === 'FLIP')
        .every((candidate) => candidate.expectedScore < 0),
    ).toBe(true);
    accept(fixture, move(9, 13));
    expect(fixture.state.chase).toBeNull();
    // Renewing the old threat also threatens a second piece. The approved
    // unique-target classifier resets this sequence, allowing the cycle again.
    const board = getObservation(fixture.state).board;
    expect(
      getPublicOrdinaryMoves(board, 'RED').filter(
        (action) => board[action.to]?.kind === 'REVEALED',
      ),
    ).toEqual([move(13, 12), move(13, 14)]);
    expect(fixture.state.result).toEqual({ type: 'DRAW', reason: 'NO_PROGRESS' });
    expect(
      evaluatePosition({
        observation: getObservation(fixture.state),
        publicHistory: fixture.history,
        perspective: request.perspective,
      }).total,
    ).toBe(0);
  });

  it('resets the no-progress counter for the same permitted FLIP without inventing material', () => {
    const fixture = replay(stall);
    const before = evaluatePosition(input(fixture));
    accept(fixture, { type: 'FLIP', position: 29 });
    expect(fixture.state.noProgressCount).toBe(0);
    const after = evaluatePosition({ ...input(fixture), perspective: 'P2' });
    expect(after.material).toEqual(before.material);
    expect(fixture.state.status).toBe('ACTIVE');
  });

  it('keeps terminal wins/losses outside every bounded nonterminal score from either seat', () => {
    const fixture = replay(sacrifice);
    const observation = getObservation(fixture.state);
    for (const perspective of ['P1', 'P2'] as const) {
      for (const weights of [
        { material: 0, threat: 0, mobility: 0 },
        { material: 1e9, threat: 2e9, mobility: 3e9 },
      ]) {
        const base = { observation, publicHistory: fixture.history, perspective };
        const active = evaluatePosition(base, { weights });
        expect(Math.abs(active.total)).toBeLessThanOrEqual(1);
        for (const winner of ['P1', 'P2'] as const) {
          const terminal = evaluatePosition(
            {
              ...base,
              observation: {
                ...observation,
                currentPlayer: winner === 'P1' ? 'P2' : 'P1',
                status: 'FINISHED',
                result: { type: 'WIN', winner, reason: 'NO_PIECES' },
              },
            },
            { weights },
          );
          expect(terminal.total).toBe(winner === perspective ? 2 : -2);
        }
      }
    }
  });
});
