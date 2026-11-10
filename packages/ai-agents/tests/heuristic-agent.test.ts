import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ActionEvent,
  GameAction,
  PieceColor,
  PieceRank,
  PlayerObservation,
  PublicSquare,
} from '../../game-core/src/index';
import {
  createHeuristicAgent,
  DEFAULT_HEURISTIC_CONFIGURATION,
  evaluatePosition,
  explainDecision,
  heuristicAgent,
  resolveHeuristicConfiguration,
  type AgentInput,
} from '../src/index';

afterEach(() => vi.restoreAllMocks());

function position(
  pieces: readonly (readonly [number, PieceColor, PieceRank])[],
  hidden: readonly number[] = [],
): PlayerObservation {
  const board: PublicSquare[] = Array.from({ length: 32 }, () => ({ kind: 'EMPTY' }));
  for (const [square, color, rank] of pieces)
    board[square] = { kind: 'REVEALED', piece: { color, rank } };
  for (const square of hidden) board[square] = { kind: 'HIDDEN' };
  return {
    board,
    currentPlayer: 'P1',
    playerColors: { P1: 'RED', P2: 'BLACK' },
    status: 'ACTIVE',
    result: null,
  };
}

function input(
  observation: PlayerObservation,
  legalActions: readonly GameAction[],
  publicHistory: readonly ActionEvent[] = [],
): AgentInput {
  return { observation, legalActions, publicHistory, perspective: 'P1' };
}

function capture(color: PieceColor, rank: PieceRank): ActionEvent {
  return {
    ply: 1,
    playerId: 'P1',
    type: 'MOVE',
    from: 0,
    to: 1,
    piece: { color: color === 'RED' ? 'BLACK' : 'RED', rank: 'CHARIOT' },
    captured: { color, rank },
  };
}

describe('Heuristic feature breakdown', () => {
  it('counts remaining hidden material via captured public history, never via reveals', () => {
    const hidden = position([], [0, 1]);
    const revealed = position([
      [0, 'RED', 'GENERAL'],
      [1, 'BLACK', 'SOLDIER'],
    ]);
    const before = evaluatePosition(input(hidden, []));
    const after = evaluatePosition(input(revealed, []));
    expect(before.material).toEqual(after.material);
    expect(before.material.friendly).toBe(64);
    expect(before.material.enemy).toBe(64);
    const captured = evaluatePosition(input(revealed, [], [capture('BLACK', 'SOLDIER')]));
    expect(captured.material.friendly).toBe(64);
    expect(captured.material.enemy).toBe(62);
    expect(captured.material.raw).toBe(2);
    expect(captured.material.normalized).toBe(2 / 64);
    expect(captured.material.contribution).toBeCloseTo(2 / 64 / 1.55);
  });

  it('counts a multiply threatened enemy victim once', () => {
    const observation = position([
      [0, 'RED', 'CHARIOT'],
      [5, 'RED', 'CHARIOT'],
      [1, 'BLACK', 'HORSE'],
    ]);
    const value = evaluatePosition(input(observation, []));
    expect(value.threat.enemy).toBe(3);
    expect(value.threat.friendly).toBe(0);
    expect(value.threat.raw).toBe(3);
  });

  it.each([
    ['GENERAL', 'SOLDIER', -8],
    ['SOLDIER', 'GENERAL', 8],
    ['SOLDIER', 'ADVISOR', -2],
  ] as const)('uses the Core %s/%s capture exceptions', (redRank, blackRank, expected) => {
    expect(
      evaluatePosition(
        input(
          position([
            [0, 'RED', redRank],
            [1, 'BLACK', blackRank],
          ]),
          [],
        ),
      ).threat.raw,
    ).toBe(expected);
  });

  it('uses hidden pieces as Cannon screens without treating them as targets', () => {
    const screened = position(
      [
        [0, 'RED', 'CANNON'],
        [8, 'BLACK', 'HORSE'],
      ],
      [4],
    );
    expect(evaluatePosition(input(screened, [])).threat.raw).toBe(3);
    expect(
      evaluatePosition(
        input(
          position([
            [0, 'RED', 'CANNON'],
            [8, 'BLACK', 'HORSE'],
          ]),
          [],
        ),
      ).threat.raw,
    ).toBe(0);
    expect(evaluatePosition(input(position([[0, 'RED', 'CANNON']], [4, 8]), [])).threat.raw).toBe(
      0,
    );
  });

  it('counts only quiet ordinary moves as mobility; no FLIP/capture overlap', () => {
    const observation = position(
      [
        [5, 'RED', 'CHARIOT'],
        [6, 'BLACK', 'SOLDIER'],
      ],
      [4],
    );
    const value = evaluatePosition(input(observation, [{ type: 'FLIP', position: 4 }]));
    // Red 5→1/9, Black 6→2/7/10; occupied capture square is excluded.
    expect(value.mobility.friendly).toBe(2);
    expect(value.mobility.enemy).toBe(3);
    expect(value.mobility.raw).toBe(-1);
    expect(value.mobility.normalized).toBe(-1 / 64);
    expect(value.threat.raw).toBe(2);
  });

  it('exposes finite weighted components that sum to the active score', () => {
    const value = evaluatePosition(
      input(
        position([
          [5, 'RED', 'HORSE'],
          [31, 'BLACK', 'GENERAL'],
        ]),
        [],
      ),
      { weights: { threat: 0, mobility: 2 } },
    );
    expect(value.threat.contribution).toBe(0);
    expect(value.total).toBe(
      value.material.contribution + value.threat.contribution + value.mobility.contribution,
    );
    expect(value.total).toBeGreaterThanOrEqual(-1);
    expect(value.total).toBeLessThanOrEqual(1);
  });

  it('keeps unassigned positions neutral and terminal outcomes outside all feature weights', () => {
    const observation = { ...position([], [0]), playerColors: { P1: null, P2: null } };
    expect(evaluatePosition(input(observation, [])).total).toBe(0);
    for (const perspective of ['P1', 'P2'] as const) {
      const value = evaluatePosition(
        {
          observation: {
            ...observation,
            status: 'FINISHED',
            result: { type: 'WIN', winner: 'P1', reason: 'NO_LEGAL_ACTION' },
          },
          publicHistory: [],
          perspective,
        },
        { weights: { material: 0, threat: 0, mobility: 0 } },
      );
      expect(value.total).toBe(perspective === 'P1' ? 2 : -2);
      expect(value.terminal).toBe(true);
    }
    expect(
      evaluatePosition(
        input(
          { ...observation, status: 'FINISHED', result: { type: 'DRAW', reason: 'NO_PROGRESS' } },
          [],
        ),
      ).total,
    ).toBe(0);
  });

  it('validates configuration and impossible public capture multiplicity', () => {
    for (const value of [-1, 0, NaN, Infinity])
      expect(() => resolveHeuristicConfiguration({ pieceValues: { SOLDIER: value } })).toThrow(
        RangeError,
      );
    for (const value of [-1, NaN, Infinity])
      expect(() => resolveHeuristicConfiguration({ weights: { mobility: value } })).toThrow(
        RangeError,
      );
    expect(() =>
      resolveHeuristicConfiguration({ pieceValues: { ADVISOR: Number.MAX_VALUE } }),
    ).toThrow(RangeError);
    expect(() =>
      resolveHeuristicConfiguration({
        weights: { material: Number.MAX_VALUE, threat: Number.MAX_VALUE },
      }),
    ).toThrow(RangeError);
    expect(() =>
      evaluatePosition(
        input(position([]), [], [capture('RED', 'GENERAL'), capture('RED', 'GENERAL')]),
      ),
    ).toThrow('distribution');
    expect(Object.isFrozen(DEFAULT_HEURISTIC_CONFIGURATION)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HEURISTIC_CONFIGURATION.weights)).toBe(true);
  });
});

describe('Heuristic decision policy', () => {
  it('uses a deterministic seeded opening FLIP without a color assignment', async () => {
    const observation = { ...position([], [0, 1, 2]), playerColors: { P1: null, P2: null } };
    const request = input(
      observation,
      [0, 1, 2].map((position) => ({ type: 'FLIP', position })),
    );
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Uncontrolled random');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Wall clock');
    });
    const before = JSON.stringify(request);
    for (let seed = 0; seed < 20; seed += 1) {
      const decision = explainDecision(request, { seed });
      expect(decision.reason).toBe('only-flips');
      expect(decision.moveEvaluations).toEqual([]);
      expect(request.legalActions).toContainEqual(decision.selectedAction);
      expect(await heuristicAgent.chooseAction(request, { seed })).toEqual(decision.selectedAction);
    }
    expect(JSON.stringify(request)).toBe(before);
  });

  it('takes an improving capture and accounts for material exactly once', () => {
    const request = input(
      position(
        [
          [0, 'RED', 'CHARIOT'],
          [1, 'BLACK', 'HORSE'],
        ],
        [31],
      ),
      [
        { type: 'MOVE', from: 0, to: 1 },
        { type: 'FLIP', position: 31 },
      ],
    );
    const decision = explainDecision(request, { seed: 0 });
    expect(decision.selectedAction).toEqual({ type: 'MOVE', from: 0, to: 1 });
    expect(decision.reason).toBe('best-move');
    expect(decision.moveEvaluations[0]!.evaluation.material.raw).toBe(3);
    expect(decision.moveEvaluations[0]!.evaluation.threat.raw).toBe(0);
    expect(decision.moveEvaluations[0]!.gain).toBeGreaterThan(0);
  });

  it('avoids immediate exposure when a safer supplied move exists', () => {
    const request = input(
      position([
        [5, 'RED', 'HORSE'],
        [0, 'BLACK', 'CHARIOT'],
      ]),
      [
        { type: 'MOVE', from: 5, to: 1 },
        { type: 'MOVE', from: 5, to: 6 },
      ],
    );
    const decision = explainDecision(request, { seed: 0 });
    expect(decision.selectedAction).toEqual({ type: 'MOVE', from: 5, to: 6 });
    expect(decision.moveEvaluations[0]!.evaluation.threat.raw).toBe(-3);
    expect(decision.moveEvaluations[1]!.evaluation.threat.raw).toBe(0);
  });

  it('recomputes discovered Cannon threats after moving a screen', () => {
    const request = input(
      position(
        [
          [0, 'RED', 'CANNON'],
          [4, 'RED', 'HORSE'],
          [12, 'BLACK', 'GENERAL'],
        ],
        [8],
      ),
      [{ type: 'MOVE', from: 4, to: 5 }],
    );
    const decision = explainDecision(request, { seed: 0 });
    expect(decision.currentEvaluation.threat.raw).toBe(0);
    expect(decision.moveEvaluations[0]!.evaluation.threat.raw).toBe(8);
  });

  it('uses FLIP fallback for equal or worsening moves and still moves when no FLIP exists', () => {
    const observation = position(
      [
        [0, 'RED', 'HORSE'],
        [31, 'BLACK', 'HORSE'],
      ],
      [16],
    );
    const legalActions: GameAction[] = [
      { type: 'MOVE', from: 0, to: 1 },
      { type: 'FLIP', position: 16 },
    ];
    const config = { weights: { material: 1, threat: 0, mobility: 0 } };
    const decision = explainDecision(input(observation, legalActions), { seed: 9 }, config);
    expect(decision.reason).toBe('flip-fallback');
    expect(decision.selectedAction).toEqual(legalActions[1]);
    expect(
      explainDecision(input(observation, legalActions.slice(0, 1)), { seed: 9 }, config)
        .selectedAction,
    ).toEqual(legalActions[0]);
  });

  it('captures configuration by value and returns clean seeded tie-broken legal actions', async () => {
    const configuration = { weights: { material: 1, threat: 0, mobility: 0 } };
    const agent = createHeuristicAgent(configuration);
    configuration.weights.mobility = 100;
    const observation = position([
      [0, 'RED', 'HORSE'],
      [31, 'BLACK', 'HORSE'],
    ]);
    const request = input(observation, [
      { type: 'MOVE', from: 0, to: 1, extra: 'private' } as GameAction,
      { type: 'MOVE', from: 0, to: 4 },
    ]);
    for (let seed = 0; seed < 20; seed += 1) {
      const first = await agent.chooseAction(request, { seed });
      expect(await agent.chooseAction(request, { seed })).toEqual(first);
      expect(
        request.legalActions.map((action) => ({
          type: action.type,
          ...(action.type === 'MOVE' ? { from: action.from, to: action.to } : {}),
        })),
      ).toContainEqual(first);
      expect(Object.keys(first).sort()).toEqual(['from', 'to', 'type']);
      expect(request.legalActions).not.toContain(first);
    }
  });

  it('rejects empty actions, terminal decisions, wrong turns, and invalid seeds', async () => {
    const request = input(position([], [0]), [{ type: 'FLIP', position: 0 }]);
    await expect(
      heuristicAgent.chooseAction({ ...request, legalActions: [] }, { seed: 0 }),
    ).rejects.toThrow('at least one');
    await expect(
      heuristicAgent.chooseAction(
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
    await expect(
      heuristicAgent.chooseAction({ ...request, perspective: 'P2' }, { seed: 0 }),
    ).rejects.toThrow('assigned turn');
    await expect(heuristicAgent.chooseAction(request, { seed: -1 })).rejects.toThrow(RangeError);
  });
});
