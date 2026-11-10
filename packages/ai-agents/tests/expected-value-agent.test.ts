import { describe, expect, it, vi } from 'vitest';
import {
  applyAction,
  getLegalActions,
  getObservation,
  type GameAction,
  type PublicPiece,
} from '../../game-core/src/index';
import { deepFreeze } from '../../game-core/tests/fixtures';
import {
  accept,
  arrangedInitial,
  tacticalSnapshot,
  type ProjectionFixture,
} from '../../game-core/tests/public-projection-fixtures';
import {
  createExpectedValueAgent,
  evaluatePosition,
  expectedValueAgent,
  explainExpectedValueDecision,
  randomAgent,
  type AgentInput,
} from '../src/index';

const flip = (position: number): GameAction => ({ type: 'FLIP', position });
const move = (from: number, to: number): GameAction => ({ type: 'MOVE', from, to });

function input(fixture: ProjectionFixture): AgentInput {
  return deepFreeze({
    observation: getObservation(fixture.state),
    legalActions: getLegalActions(fixture.state, fixture.state.currentPlayer),
    publicHistory: [...fixture.history],
    perspective: fixture.state.currentPlayer,
  });
}

function middlegame(): ProjectionFixture {
  const fixture = arrangedInitial([
    [0, 'RED', 'CHARIOT'],
    [1, 'BLACK', 'SOLDIER'],
    [4, 'BLACK', 'GENERAL'],
  ]);
  for (const action of [flip(0), flip(1), move(0, 1), flip(4)]) accept(fixture, action);
  return fixture;
}

function authoritativeValue(
  fixture: ProjectionFixture,
  action: GameAction,
  reveal?: PublicPiece,
): number {
  const board = [...fixture.state.board];
  if (action.type === 'FLIP' && reveal !== undefined) {
    const index = board.findIndex(
      (square) =>
        square &&
        !square.revealed &&
        square.piece.color === reveal.color &&
        square.piece.rank === reveal.rank,
    );
    if (index < 0) throw new Error('Unavailable public outcome.');
    [board[index], board[action.position]] = [board[action.position]!, board[index]!];
  }
  const result = applyAction({ ...fixture.state, board }, fixture.state.currentPlayer, action);
  if (!result.ok) throw new Error(result.error.code);
  return evaluatePosition({
    observation: getObservation(result.state),
    publicHistory: [...fixture.history, result.event],
    perspective: fixture.state.currentPlayer,
  }).total;
}

describe('one-step Expected Value Agent', () => {
  it('handles the first FLIP with both color assignments, normalized probabilities, and no material gain', async () => {
    const request = input(arrangedInitial([]));
    const decision = explainExpectedValueDecision(request, { seed: 7 });
    expect(decision.distribution.totalHidden).toBe(32);
    expect(decision.actionEvaluations).toHaveLength(32);
    for (const action of decision.actionEvaluations) {
      if (!('outcomes' in action)) throw new Error('Expected an opening FLIP.');
      expect(action.outcomes).toHaveLength(14);
      expect(action.expectedScore).toBe(0);
      expect(action.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0)).toBe(1);
      for (const outcome of action.outcomes) {
        expect(outcome.evaluation.perspective).toBe('P1');
        expect(outcome.evaluation.color).toBe(outcome.piece.color);
        expect(outcome.evaluation.material.friendly).toBe(64);
        expect(outcome.evaluation.material.enemy).toBe(64);
        expect(outcome.evaluation.material.raw).toBe(0);
      }
    }
    expect(await expectedValueAgent.chooseAction(request, { seed: 7 })).toEqual(
      decision.selectedAction,
    );
    expect(request.legalActions).toContainEqual(decision.selectedAction);
  });

  it('matches an independent authoritative weighted sum for every MOVE and later FLIP', () => {
    const fixture = middlegame();
    const request = input(fixture);
    const decision = explainExpectedValueDecision(request, { seed: 23 });
    let moves = 0;
    let flips = 0;
    for (const candidate of decision.actionEvaluations) {
      let expected: number;
      if ('outcomes' in candidate) {
        flips += 1;
        expected = 0;
        for (const outcome of candidate.outcomes) {
          const value = authoritativeValue(fixture, candidate.action, outcome.piece);
          expect(outcome.evaluation.total).toBe(value);
          expect(outcome.evaluation.perspective).toBe(request.perspective);
          expect(outcome.evaluation.color).toBe('RED');
          const actualHiddenCount = fixture.state.board.filter(
            (square) =>
              square &&
              !square.revealed &&
              square.piece.color === outcome.piece.color &&
              square.piece.rank === outcome.piece.rank,
          ).length;
          expect(outcome.count).toBe(actualHiddenCount);
          expected += (actualHiddenCount / decision.distribution.totalHidden) * value;
          expect(outcome.contribution).toBe(outcome.probability * value);
          expect(outcome.evaluation.material).toEqual(decision.currentEvaluation.material);
        }
      } else {
        moves += 1;
        expected = authoritativeValue(fixture, candidate.action);
      }
      expect(candidate.expectedScore).toBeCloseTo(expected, 14);
      expect(Number.isFinite(candidate.expectedScore)).toBe(true);
    }
    expect(moves).toBeGreaterThan(0);
    expect(flips).toBeGreaterThan(0);
    const chosen = decision.actionEvaluations.find(
      (candidate) => JSON.stringify(candidate.action) === JSON.stringify(decision.selectedAction),
    );
    expect(chosen?.expectedScore).toBe(
      Math.max(...decision.actionEvaluations.map((candidate) => candidate.expectedScore)),
    );
  });

  it.each(['P1', 'P2'] as const)(
    'uses terminal GameResult from fixed %s perspective on the last FLIP',
    (perspective) => {
      const fixture = tacticalSnapshot(
        [
          [0, 'BLACK', 'SOLDIER'],
          [1, 'RED', 'CANNON'],
          [4, 'RED', 'CANNON'],
          [31, 'RED', 'HORSE', false],
        ],
        perspective,
      );
      fixture.state = {
        ...fixture.state,
        playerColors:
          perspective === 'P1' ? { P1: 'RED', P2: 'BLACK' } : { P1: 'BLACK', P2: 'RED' },
      };
      const decision = explainExpectedValueDecision(
        input(fixture),
        { seed: 0 },
        { weights: { material: 0, threat: 0, mobility: 0 } },
      );
      const candidate = decision.actionEvaluations.find((value) => value.action.type === 'FLIP');
      expect(candidate?.expectedScore).toBe(2);
      if (candidate === undefined || !('outcomes' in candidate))
        throw new Error('Expected FLIP outcomes.');
      expect(candidate.outcomes).toHaveLength(1);
      expect(candidate.outcomes[0]!.evaluation.terminal).toBe(true);
      expect(candidate.outcomes[0]!.evaluation.perspective).toBe(perspective);
      expect(decision.selectedAction).toEqual(flip(31));
    },
  );

  it('chooses a terminal capture over quiet MOVEs without hidden outcomes', () => {
    const fixture = tacticalSnapshot([
      [9, 'RED', 'SOLDIER'],
      [10, 'BLACK', 'GENERAL'],
    ]);
    const decision = explainExpectedValueDecision(input(fixture), { seed: 0 });
    expect(decision.distribution).toEqual({ totalHidden: 0, outcomes: [] });
    expect(decision.selectedAction).toEqual(move(9, 10));
    const capture = decision.actionEvaluations.find(
      (value) => value.action.type === 'MOVE' && value.action.to === 10,
    );
    expect(capture?.expectedScore).toBe(2);
    if (capture === undefined || !('evaluation' in capture)) throw new Error('Expected a MOVE.');
    expect(capture.evaluation.terminal).toBe(true);
  });

  it('scores a predicted quiet draw as zero after the turn advances', () => {
    const fixture = tacticalSnapshot([
      [0, 'RED', 'HORSE'],
      [31, 'BLACK', 'HORSE'],
    ]);
    const cycle = [move(0, 1), move(31, 30), move(1, 0), move(30, 31)];
    for (let ply = 0; ply < 59; ply += 1) accept(fixture, cycle[ply % 4]!);
    const request = { ...input(fixture), legalActions: [cycle[3]!] };
    const decision = explainExpectedValueDecision(request, { seed: 0 });
    expect(decision.actionEvaluations[0]!.expectedScore).toBe(0);
    const candidate = decision.actionEvaluations[0]!;
    expect('evaluation' in candidate && candidate.evaluation.terminal).toBe(true);
    expect('evaluation' in candidate && candidate.evaluation.perspective).toBe('P2');
  });

  it('is invariant under hidden permutations and engine-ID renaming in an accepted middlegame', () => {
    const fixture = middlegame();
    const hidden = fixture.state.board.filter((square) => square && !square.revealed).reverse();
    let next = 0;
    const variant = {
      ...fixture,
      state: {
        ...fixture.state,
        board: fixture.state.board.map((square, index) => {
          const replacement = square && !square.revealed ? hidden[next++]! : square;
          return replacement === null
            ? null
            : { ...replacement, piece: { ...replacement.piece, id: `unrelated-${index}` } };
        }),
      },
    };
    const first = input(fixture);
    const second = input(variant);
    expect(first).toEqual(second);
    expect(explainExpectedValueDecision(first, { seed: 9 })).toEqual(
      explainExpectedValueDecision(second, { seed: 9 }),
    );
  });

  it('captures configuration by value and uses only the decision seed for exact ties', async () => {
    const configuration = { weights: { material: 0, threat: 0, mobility: 0 } };
    const agent = createExpectedValueAgent(configuration);
    const reference = createExpectedValueAgent(configuration);
    configuration.weights.mobility = 100;
    const request = input(middlegame());
    const before = JSON.stringify(request);
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Uncontrolled randomness');
    });
    const timeSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Wall clock');
    });
    try {
      for (const seed of [0, 1, 0xffffffff]) {
        const action = await agent.chooseAction(request, { seed });
        expect(action).toEqual(await reference.chooseAction(request, { seed }));
        expect(request.legalActions).toContainEqual(action);
        expect(request.legalActions).not.toContain(action);
        expect(Object.keys(action).sort()).toEqual(
          action.type === 'MOVE' ? ['from', 'to', 'type'] : ['position', 'type'],
        );
      }
    } finally {
      randomSpy.mockRestore();
      timeSpy.mockRestore();
    }
    expect(JSON.stringify(request)).toBe(before);
  });

  it('rejects empty/terminal/wrong-turn inputs, invalid seeds, and forged legal actions', async () => {
    const request = input(arrangedInitial([]));
    await expect(
      expectedValueAgent.chooseAction({ ...request, legalActions: [] }, { seed: 0 }),
    ).rejects.toThrow('at least one');
    await expect(
      expectedValueAgent.chooseAction({ ...request, perspective: 'P2' }, { seed: 0 }),
    ).rejects.toThrow('assigned turn');
    await expect(
      expectedValueAgent.chooseAction(
        {
          ...request,
          observation: {
            ...request.observation,
            status: 'FINISHED',
            result: { type: 'DRAW', reason: 'NO_PROGRESS' },
          },
        },
        { seed: 0 },
      ),
    ).rejects.toThrow('active');
    await expect(expectedValueAgent.chooseAction(request, { seed: -1 })).rejects.toThrow(
      RangeError,
    );
    await expect(
      expectedValueAgent.chooseAction({ ...request, legalActions: [move(0, 1)] }, { seed: 0 }),
    ).rejects.toThrow('rejected by Core projection');
  });

  it.each(['P1', 'P2'] as const)(
    'finishes reproducible direct-Core games against Random as %s and replays exactly',
    async (seat) => {
      async function play() {
        const fixture = arrangedInitial([]);
        const actions: GameAction[] = [];
        for (let ply = 0; ply < 600 && fixture.state.status === 'ACTIVE'; ply += 1) {
          const policy = fixture.state.currentPlayer === seat ? expectedValueAgent : randomAgent;
          const request = input(fixture);
          const action = await policy.chooseAction(request, { seed: (ply * 17 + 923) >>> 0 });
          expect(request.legalActions).toContainEqual(action);
          accept(fixture, action);
          actions.push(action);
        }
        expect(fixture.state.status).toBe('FINISHED');
        const replay = arrangedInitial([]);
        for (const action of actions) accept(replay, action);
        expect(replay.state).toEqual(fixture.state);
        expect(replay.history).toEqual(fixture.history);
        return { actions, result: fixture.state.result };
      }
      expect(await play()).toEqual(await play());
    },
    30000,
  );
});
