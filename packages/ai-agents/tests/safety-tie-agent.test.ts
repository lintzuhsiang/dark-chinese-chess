import { describe, expect, it } from 'vitest';
import {
  getLegalActions,
  getObservation,
  projectPermittedPublicAction,
  type GameAction,
  type PieceColor,
  type PlayerId,
} from '../../game-core/src/index';
import { deepFreeze } from '../../game-core/tests/fixtures';
import {
  tacticalSnapshot,
  type ProjectionFixture,
} from '../../game-core/tests/public-projection-fixtures';
import {
  createSafetyTieAgent,
  explainExpectedValueDecision,
  explainSafetyTieDecision,
  safetyTieAgent,
  type AgentInput,
} from '../src/index';
import { rebasedLegacy, sacrifice, stall } from './ai51-fixtures';

const move = (from: number, to: number): Extract<GameAction, { type: 'MOVE' }> => ({
  type: 'MOVE',
  from,
  to,
});
const zero = { weights: { material: 0, threat: 0, mobility: 0 } };

function input(fixture: ProjectionFixture, permitted?: readonly GameAction[]): AgentInput {
  return {
    observation: getObservation(fixture.state),
    legalActions: permitted ?? getLegalActions(fixture.state, fixture.state.currentPlayer),
    publicHistory: fixture.history,
    perspective: fixture.state.currentPlayer,
  };
}

function noPiecesTrap(extraFriendly = false): ProjectionFixture {
  return tacticalSnapshot([
    [9, 'RED', 'SOLDIER'],
    [4, 'BLACK', 'ADVISOR'],
    [6, 'BLACK', 'ADVISOR'],
    ...(extraFriendly ? [[31, 'RED', 'SOLDIER'] as const] : []),
  ]);
}

function verifyWinningWitness(request: AgentInput, action: GameAction, reply: GameAction): void {
  const own = projectPermittedPublicAction(request, action);
  if (!own.ok) throw new Error(own.error.code);
  const enemy = projectPermittedPublicAction(
    {
      observation: own.observation,
      publicHistory: [...request.publicHistory, own.event],
    },
    reply,
  );
  if (!enemy.ok) throw new Error(enemy.error.code);
  expect(enemy.observation.result).toMatchObject({
    type: 'WIN',
    winner: own.observation.currentPlayer,
  });
}

describe('SAFETY-TIE-1 independent policy QA', () => {
  it('filters the real fatal tie while preserving every baseline candidate score and outcome', async () => {
    const request = deepFreeze(input(rebasedLegacy(sacrifice)));
    const options = { seed: sacrifice.seed };
    const baseline = explainExpectedValueDecision(request, options);
    const decision = explainSafetyTieDecision(request, options);
    expect(baseline.selectedAction).toEqual(move(10, 14));
    expect(decision.selectedAction).toEqual(move(10, 9));
    expect(decision.safetyTie).toEqual({
      applied: true,
      checks: [
        { action: move(10, 9), winningReply: null },
        { action: move(10, 14), winningReply: move(18, 14) },
      ],
    });
    expect(decision.actionEvaluations).toEqual(baseline.actionEvaluations);
    expect(decision.currentEvaluation).toEqual(baseline.currentEvaluation);
    expect(decision.distribution).toEqual(baseline.distribution);
    verifyWinningWitness(request, move(10, 14), move(18, 14));
    expect(await safetyTieAgent.chooseAction(request, options)).toEqual(decision.selectedAction);
  });

  it.each([
    ['P1', 'RED'],
    ['P1', 'BLACK'],
    ['P2', 'RED'],
    ['P2', 'BLACK'],
  ] as const)(
    'preserves fixed perspective for evaluating %s assigned %s',
    (perspective: PlayerId, color: PieceColor) => {
      // Same tactical shape, compiled into a real accepted v3 public prefix.
      const enemy = color === 'RED' ? 'BLACK' : 'RED';
      const fixture = tacticalSnapshot(
        [
          [10, color, 'ADVISOR'],
          [13, enemy, 'ELEPHANT'],
          [16, enemy, 'SOLDIER', false],
          [18, enemy, 'ADVISOR'],
          [21, enemy, 'HORSE'],
          [24, enemy, 'ELEPHANT'],
          [26, enemy, 'SOLDIER'],
          [29, enemy, 'ADVISOR'],
          [31, enemy, 'SOLDIER'],
        ],
        perspective,
        perspective === 'P1' ? { P1: color, P2: enemy } : { P1: enemy, P2: color },
      );
      fixture.state = {
        ...fixture.state,
        playerColors: perspective === 'P1' ? { P1: color, P2: enemy } : { P1: enemy, P2: color },
      };
      const request = input(fixture);
      const result = explainSafetyTieDecision(request, { seed: sacrifice.seed });
      expect(result.selectedAction).toEqual(move(10, 9));
      expect(result.safetyTie.applied).toBe(true);
      expect(request.legalActions).toContainEqual(result.selectedAction);
      verifyWinningWitness(request, move(10, 14), move(18, 14));
    },
  );

  it('retains the exact seeded fallback if every tied move loses by NO_PIECES', () => {
    const request = input(noPiecesTrap(), [move(9, 8), move(9, 10)]);
    for (const seed of [0, 1, 9, 0xffffffff]) {
      const result = explainSafetyTieDecision(request, { seed }, zero);
      expect(result.selectedAction).toEqual(
        explainExpectedValueDecision(request, { seed }, zero).selectedAction,
      );
      expect(result.safetyTie.applied).toBe(false);
      expect(result.safetyTie.checks).toHaveLength(2);
      for (const check of result.safetyTie.checks) {
        expect(check.winningReply).not.toBeNull();
        verifyWinningWitness(request, check.action, check.winningReply!);
      }
    }
  });

  it('also recognizes a capture winning by NO_LEGAL_ACTION rather than eliminating every piece', () => {
    const fixture = tacticalSnapshot([
      [0, 'RED', 'HORSE'],
      [10, 'RED', 'SOLDIER'],
      [1, 'BLACK', 'ADVISOR'],
      [4, 'BLACK', 'ADVISOR'],
      [13, 'BLACK', 'ELEPHANT'],
    ]);
    const request = input(fixture, [move(10, 9), move(10, 14)]);
    const result = explainSafetyTieDecision(request, { seed: 0 }, zero);
    expect(result.safetyTie.applied).toBe(false);
    for (const check of result.safetyTie.checks) {
      expect(check.winningReply).toEqual(move(13, check.action.to));
      verifyWinningWitness(request, check.action, check.winningReply!);
      const own = projectPermittedPublicAction(request, check.action);
      if (!own.ok) throw new Error(own.error.code);
      const reply = projectPermittedPublicAction(
        { observation: own.observation, publicHistory: [...request.publicHistory, own.event] },
        check.winningReply!,
      );
      if (!reply.ok) throw new Error(reply.error.code);
      expect(reply.observation.result).toMatchObject({ type: 'WIN', reason: 'NO_LEGAL_ACTION' });
    }
  });

  it('does not filter ordinary material losses that do not immediately lose the game', () => {
    const request = input(noPiecesTrap(true), [move(9, 8), move(9, 10)]);
    const result = explainSafetyTieDecision(request, { seed: 9 }, zero);
    expect(result.safetyTie).toEqual({
      applied: false,
      checks: [
        { action: move(9, 8), winningReply: null },
        { action: move(9, 10), winningReply: null },
      ],
    });
    expect(result.selectedAction).toEqual(
      explainExpectedValueDecision(request, { seed: 9 }, zero).selectedAction,
    );
  });

  it('skips the guard if any highest-scoring candidate is FLIP', () => {
    const request = input(rebasedLegacy(sacrifice));
    const options = { seed: sacrifice.seed };
    const baseline = explainExpectedValueDecision(request, options, zero);
    const result = explainSafetyTieDecision(request, options, zero);
    expect(baseline.actionEvaluations.every((candidate) => candidate.expectedScore === 0)).toBe(
      true,
    );
    expect(result.selectedAction).toEqual(baseline.selectedAction);
    expect(result.safetyTie).toEqual({ applied: false, checks: [] });
  });

  it('does not override a uniquely highest action even when its immediate reply wins', () => {
    const request = input(rebasedLegacy(sacrifice), [move(10, 6), move(10, 14)]);
    const result = explainSafetyTieDecision(request, { seed: 0 });
    expect(result.actionEvaluations[1]!.expectedScore).toBeGreaterThan(
      result.actionEvaluations[0]!.expectedScore,
    );
    expect(result.selectedAction).toEqual(move(10, 14));
    expect(result.safetyTie).toEqual({ applied: false, checks: [] });
    verifyWinningWitness(request, move(10, 14), move(18, 14));
  });

  it('keeps tied own terminal wins and their original exact seeded ordering', () => {
    const fixture = tacticalSnapshot([
      [8, 'RED', 'ADVISOR'],
      [9, 'BLACK', 'SOLDIER'],
      [10, 'RED', 'ADVISOR'],
    ]);
    const request = input(fixture, [move(8, 9), move(10, 9)]);
    for (const seed of [0, 1, 9, 0xffffffff]) {
      const result = explainSafetyTieDecision(request, { seed });
      expect(result.selectedAction).toEqual(
        explainExpectedValueDecision(request, { seed }).selectedAction,
      );
      expect(result.safetyTie).toEqual({
        applied: false,
        checks: [
          { action: move(8, 9), winningReply: null },
          { action: move(10, 9), winningReply: null },
        ],
      });
      expect(result.actionEvaluations.every((candidate) => candidate.expectedScore === 2)).toBe(
        true,
      );
    }
  });

  it('uses stable first-sample seeded ordering when several safe choices remain', () => {
    const request = input(
      tacticalSnapshot([
        [9, 'RED', 'SOLDIER'],
        [4, 'BLACK', 'ADVISOR'],
      ]),
    );
    // All four Soldier MOVEs tie at zero: 5/8 lose, while 10/13 survive.
    const safe = request.legalActions.filter(
      (action) => action.type === 'MOVE' && [10, 13].includes(action.to),
    );
    expect(safe).toHaveLength(2);
    for (const seed of [0, 1, 9, 73, 0xffffffff]) {
      const result = explainSafetyTieDecision(request, { seed }, zero);
      const safeBaseline = explainExpectedValueDecision(
        { ...request, legalActions: safe },
        { seed },
        zero,
      );
      expect(result.safetyTie.applied).toBe(true);
      expect(result.selectedAction).toEqual(safeBaseline.selectedAction);
    }
  });

  it('is deterministic, immutable and independent of hidden identities and internal IDs', async () => {
    const fixture = rebasedLegacy(stall);
    const hidden = fixture.state.board.filter((square) => square && !square.revealed).reverse();
    let next = 0;
    const variant: ProjectionFixture = {
      ...fixture,
      state: {
        ...fixture.state,
        board: fixture.state.board.map((square, index) => {
          const replacement = square && !square.revealed ? hidden[next++]! : square;
          return replacement === null
            ? null
            : { ...replacement, piece: { ...replacement.piece, id: 'opaque-' + index } };
        }),
      },
    };
    const request = deepFreeze(input(fixture));
    const alternate = deepFreeze(input(variant));
    expect(alternate).toEqual(request);
    const before = JSON.stringify(request);
    const config = { weights: { material: 1, threat: 0.5, mobility: 0.05 } };
    const agent = createSafetyTieAgent(config);
    config.weights.threat = 100;
    for (const seed of [0, 9, 0xffffffff]) {
      const result = explainSafetyTieDecision(request, { seed });
      expect(explainSafetyTieDecision(alternate, { seed })).toEqual(result);
      expect(await agent.chooseAction(request, { seed })).toEqual(result.selectedAction);
      expect(await safetyTieAgent.chooseAction(request, { seed })).toEqual(result.selectedAction);
      expect(request.legalActions).toContainEqual(result.selectedAction);
      expect(Object.keys(result.selectedAction).sort()).toEqual(
        result.selectedAction.type === 'MOVE' ? ['from', 'to', 'type'] : ['position', 'type'],
      );
    }
    expect(JSON.stringify(request)).toBe(before);
  });
});
