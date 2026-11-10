import { describe, expect, it, vi } from 'vitest';
import {
  applyAction,
  getLegalActions,
  getObservation,
  type ActionEvent,
  type GameAction,
  type GameState,
  type PieceColor,
  type PieceRank,
  type PlayerId,
  type PlayerObservation,
  type PublicSquare,
} from '../../game-core/src/index';
import { deepFreeze, initialState, makeDeck } from '../../game-core/tests/fixtures';
import { createAgentInput } from '../../../scripts/ai-eval/agent-input';
import {
  createHeuristicAgent,
  createSeededRandom,
  evaluatePosition,
  explainDecision,
  heuristicAgent,
  randomAgent,
} from '../src/index';

const flip = (position: number): GameAction => ({ type: 'FLIP', position });
const move = (from: number, to: number): GameAction => ({ type: 'MOVE', from, to });

function arrangedState(fixed: readonly (readonly [number, PieceColor, PieceRank])[]): GameState {
  const remaining = makeDeck();
  const placed = new Map<number, (typeof remaining)[number]>();
  for (const [position, color, rank] of fixed) {
    const index = remaining.findIndex((piece) => piece.color === color && piece.rank === rank);
    if (index < 0) throw new Error('Unavailable fixture piece.');
    placed.set(position, remaining.splice(index, 1)[0]!);
  }
  return initialState(
    Array.from({ length: 32 }, (_, position) => placed.get(position) ?? remaining.shift()!),
  );
}

function accept(initial: GameState, actions: readonly GameAction[]) {
  let state = initial;
  const events: ActionEvent[] = [];
  for (const action of actions) {
    const result = applyAction(state, state.currentPlayer, action);
    if (!result.ok) throw new Error(`Invalid fixture action: ${result.error.code}`);
    state = result.state;
    events.push(result.event);
  }
  return { state, events };
}

function position(
  pieces: readonly (readonly [number, PieceColor, PieceRank])[],
  hidden: readonly number[] = [],
): PlayerObservation {
  const board: PublicSquare[] = Array.from({ length: 32 }, () => ({ kind: 'EMPTY' }));
  for (const index of hidden) board[index] = { kind: 'HIDDEN' };
  for (const [index, color, rank] of pieces) {
    board[index] = { kind: 'REVEALED', piece: { color, rank } };
  }
  return {
    board,
    currentPlayer: 'P1',
    playerColors: { P1: 'RED', P2: 'BLACK' },
    status: 'ACTIVE',
    result: null,
  };
}

function evaluate(observation: PlayerObservation, perspective: PlayerId = 'P1') {
  return evaluatePosition({ observation, perspective, publicHistory: [] });
}

describe('independent Heuristic public-information invariants', () => {
  it('counts captured material from accepted history, including unrevealed survivors', () => {
    const initial = arrangedState([
      [0, 'RED', 'CHARIOT'],
      [1, 'BLACK', 'SOLDIER'],
      [4, 'RED', 'SOLDIER'],
      [5, 'BLACK', 'HORSE'],
    ]);
    const revealed = accept(initial, [flip(0), flip(1), flip(4), flip(5)]);
    const captured = accept(initial, [flip(0), flip(1), flip(4), flip(5), move(0, 1)]);
    const openingScore = evaluatePosition({
      observation: getObservation(initial),
      perspective: 'P1',
      publicHistory: [],
    });
    const revealedScore = evaluatePosition({
      observation: getObservation(revealed.state),
      perspective: 'P1',
      publicHistory: revealed.events,
    });
    const capturedScore = evaluatePosition({
      observation: getObservation(captured.state),
      perspective: 'P1',
      publicHistory: captured.events,
    });
    expect(openingScore.material.raw).toBe(0);
    expect(revealedScore.material.raw).toBe(0);
    expect(capturedScore.material.raw).toBe(2);
    expect(capturedScore.material.friendly).toBe(revealedScore.material.friendly);
    expect(capturedScore.material.enemy).toBe(revealedScore.material.enemy - 2);
    expect(captured.state.board.filter((square) => square && !square.revealed)).toHaveLength(28);
  });

  it.each([
    ['GENERAL', 'SOLDIER', -8],
    ['SOLDIER', 'GENERAL', 8],
    ['HORSE', 'SOLDIER', 2],
    ['SOLDIER', 'HORSE', -2],
  ] as const)('respects %s versus %s rank exceptions', (friendly, enemy, expected) => {
    const score = evaluate(
      position([
        [0, 'RED', friendly],
        [1, 'BLACK', enemy],
      ]),
    );
    expect(score.threat.raw).toBe(expected);
  });

  it('counts each threatened victim once despite two attackers', () => {
    const one = evaluate(
      position([
        [0, 'RED', 'CHARIOT'],
        [1, 'BLACK', 'HORSE'],
      ]),
    );
    const two = evaluate(
      position([
        [0, 'RED', 'CHARIOT'],
        [1, 'BLACK', 'HORSE'],
        [2, 'RED', 'CHARIOT'],
      ]),
    );
    expect(one.threat.raw).toBe(3);
    expect(two.threat.raw).toBe(3);
  });

  it('uses hidden Cannon screens without assigning hidden identities', () => {
    const enemy: readonly [number, PieceColor, PieceRank] = [3, 'BLACK', 'GENERAL'];
    expect(evaluate(position([[0, 'RED', 'CANNON'], enemy], [1])).threat.raw).toBe(8);
    expect(evaluate(position([[0, 'RED', 'CANNON'], enemy])).threat.raw).toBeCloseTo(0);
    expect(evaluate(position([[0, 'RED', 'CANNON'], enemy], [1, 2])).threat.raw).toBeCloseTo(0);
    expect(evaluate(position([[0, 'RED', 'CANNON']], [1, 3])).threat.raw).toBeCloseTo(0);
  });

  it('recomputes discovered Cannon exposure after a blocker moves', () => {
    const observation = position([
      [0, 'BLACK', 'CANNON'],
      [1, 'RED', 'SOLDIER'],
      [2, 'RED', 'HORSE'],
      [3, 'RED', 'GENERAL'],
    ]);
    const input = {
      observation,
      legalActions: [move(2, 6)],
      publicHistory: [],
      perspective: 'P1' as const,
    };
    const diagnostic = explainDecision(input, { seed: 0 });
    expect(diagnostic.currentEvaluation.threat.raw).toBe(-3);
    expect(diagnostic.moveEvaluations[0]!.evaluation.threat.raw).toBe(-8);
  });

  it('excludes captures and FLIPs from ordinary quiet mobility', () => {
    const observation = position(
      [
        [0, 'RED', 'CHARIOT'],
        [1, 'BLACK', 'SOLDIER'],
        [31, 'BLACK', 'GENERAL'],
      ],
      [4, 27],
    );
    // Red has no empty adjacent destinations. Black Soldier has two (2, 5), General one (30).
    expect(evaluate(observation).mobility.raw).toBe(-3);
  });

  it('negates all nonterminal features for the opposite fixed player and supports exchanged seats', () => {
    const observation = position(
      [
        [0, 'RED', 'CHARIOT'],
        [1, 'BLACK', 'HORSE'],
        [31, 'BLACK', 'GENERAL'],
      ],
      [4],
    );
    const red = evaluate(observation, 'P1');
    const black = evaluate(observation, 'P2');
    for (const key of ['material', 'threat', 'mobility'] as const) {
      expect(black[key].raw).toBeCloseTo(-red[key].raw);
      expect(black[key].contribution).toBeCloseTo(-red[key].contribution);
    }
    expect(black.total).toBe(-red.total);
    const exchanged = evaluate({ ...observation, playerColors: { P1: 'BLACK', P2: 'RED' } }, 'P2');
    expect(exchanged.material).toEqual(red.material);
    expect(exchanged.threat).toEqual(red.threat);
    expect(exchanged.mobility).toEqual(red.mobility);
    expect(exchanged.total).toBe(red.total);
  });

  it('uses GameResult rather than the advanced currentPlayer for terminal scores', async () => {
    const observation: PlayerObservation = {
      ...position([]),
      currentPlayer: 'P2',
      status: 'FINISHED',
      result: { type: 'WIN', winner: 'P1', reason: 'NO_PIECES' },
    };
    expect(evaluate(observation, 'P1').total).toBe(2);
    expect(evaluate(observation, 'P2').total).toBe(-2);
    expect(evaluate(observation, 'P1').terminal).toBe(true);
    expect(
      evaluate({ ...observation, result: { type: 'DRAW', reason: 'NO_PROGRESS' } }).total,
    ).toBe(0);
    await expect(
      heuristicAgent.chooseAction(
        {
          observation,
          legalActions: [],
          publicHistory: [],
          perspective: 'P1',
        },
        { seed: 1 },
      ),
    ).rejects.toThrow();
  });

  it('keeps first-flip evaluation neutral and every seeded first action permitted', async () => {
    const input = createAgentInput(initialState(), [], 'P1');
    expect(evaluate(input.observation).color).toBe(null);
    expect(evaluate(input.observation).total).toBe(0);
    for (const seed of [0, 1, 7, 0xffffffff]) {
      const diagnostic = explainDecision(input, { seed });
      expect(diagnostic.reason).toBe('only-flips');
      expect(diagnostic.selectedAction.type).toBe('FLIP');
      expect(input.legalActions).toContainEqual(await heuristicAgent.chooseAction(input, { seed }));
      expect(await heuristicAgent.chooseAction(input, { seed })).toEqual(diagnostic.selectedAction);
    }
  });

  it('uses the documented later FLIP fallback when a quiet MOVE has no feature improvement', () => {
    const observation = position([[0, 'RED', 'GENERAL']], [31]);
    const input = {
      observation,
      legalActions: [move(0, 1), flip(31)],
      publicHistory: [],
      perspective: 'P1' as const,
    };
    const diagnostics = explainDecision(
      input,
      { seed: 7 },
      { weights: { material: 1, threat: 0, mobility: 0 } },
    );
    expect(diagnostics.reason).toBe('flip-fallback');
    expect(diagnostics.selectedAction).toEqual(flip(31));
    expect(diagnostics.moveEvaluations[0]!.gain).toBe(0);
  });

  it('is unchanged by hidden identity permutations after captures and during a chase', async () => {
    const initial = arrangedState([
      [0, 'RED', 'CHARIOT'],
      [1, 'BLACK', 'SOLDIER'],
      [4, 'RED', 'SOLDIER'],
      [5, 'BLACK', 'HORSE'],
    ]);
    const { state, events } = accept(initial, [
      flip(0),
      flip(1),
      flip(4),
      flip(5),
      move(0, 1),
      move(5, 4),
      move(1, 0),
    ]);
    expect(state.chase).not.toBe(null);
    const board = [...state.board];
    const hidden = board.flatMap((square, index) => (square && !square.revealed ? [index] : []));
    [board[hidden[0]!], board[hidden.at(-1)!]] = [board[hidden.at(-1)!]!, board[hidden[0]!]!];
    const permuted = { ...state, board };
    const first = createAgentInput(state, events, state.currentPlayer);
    const second = createAgentInput(permuted, events, permuted.currentPlayer);
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/"(?:id|attackerId|targetId|deckSeed|chase)":/);
    const before = JSON.stringify(first);
    deepFreeze(first);
    const diagnostic = explainDecision(first, { seed: 79 });
    expect(explainDecision(second, { seed: 79 })).toEqual(diagnostic);
    expect(await heuristicAgent.chooseAction(first, { seed: 79 })).toEqual(
      await heuristicAgent.chooseAction(second, { seed: 79 }),
    );
    expect(JSON.stringify(first)).toBe(before);
  });

  it('produces finite explainable weighted scores without uncontrolled randomness or mutation', async () => {
    const revealed = accept(
      arrangedState([
        [0, 'RED', 'CHARIOT'],
        [1, 'BLACK', 'SOLDIER'],
      ]),
      [flip(0), flip(1)],
    );
    const input = createAgentInput(revealed.state, revealed.events, 'P1');
    const before = JSON.stringify(input);
    const math = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Uncontrolled randomness');
    });
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Wall clock dependency');
    });
    try {
      const agent = createHeuristicAgent({
        pieceValues: { CANNON: 9 },
        weights: { material: 2, threat: 0.25, mobility: 0.1 },
      });
      expect(input.legalActions).toContainEqual(await agent.chooseAction(input, { seed: 13 }));
      const breakdown = evaluatePosition(input, {
        pieceValues: { CANNON: 9 },
        weights: { material: 2, threat: 0.25, mobility: 0.1 },
      });
      for (const feature of [breakdown.material, breakdown.threat, breakdown.mobility]) {
        expect(Object.values(feature).every(Number.isFinite)).toBe(true);
        expect(feature.contribution).toBeCloseTo(feature.normalized * (feature.weight / 2.35));
      }
      expect(breakdown.total).toBeCloseTo(
        breakdown.material.contribution +
          breakdown.threat.contribution +
          breakdown.mobility.contribution,
      );
      expect(JSON.stringify(input)).toBe(before);
    } finally {
      math.mockRestore();
      clock.mockRestore();
    }
  });
});

function shuffledState(seed: number) {
  const deck = makeDeck();
  const shuffle = createSeededRandom(seed);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const other = Math.floor(shuffle() * (index + 1));
    [deck[index], deck[other]] = [deck[other]!, deck[index]!];
  }
  return initialState(deck);
}

async function play(seed: number, heuristicSeat: PlayerId) {
  let state = shuffledState(seed);
  const events: ActionEvent[] = [];
  const actions: GameAction[] = [];
  const decisions = createSeededRandom(seed ^ 0xa13);
  while (state.status === 'ACTIVE' && actions.length < 600) {
    const player = state.currentPlayer;
    const input = createAgentInput(state, events, player);
    const agent = player === heuristicSeat ? heuristicAgent : randomAgent;
    const action = await agent.chooseAction(input, { seed: Math.floor(decisions() * 0x100000000) });
    expect(input.legalActions).toContainEqual(action);
    expect(getLegalActions(state, player)).toContainEqual(action);
    const result = applyAction(state, player, action);
    if (!result.ok) throw new Error(`Rejected Agent action: ${result.error.code}`);
    state = result.state;
    events.push(result.event);
    actions.push(action);
  }
  return { state, events, actions };
}

describe('direct authoritative Core Heuristic integration (not a pinned benchmark)', () => {
  it.each(['P1', 'P2'] as const)('finishes reproducible legal games in seat %s', async (seat) => {
    const first = await play(1543, seat);
    const second = await play(1543, seat);
    expect(first.state.status).toBe('FINISHED');
    expect(first.state.result).not.toBe(null);
    expect(second).toEqual(first);
    // Applying the accepted action prefix to the same valid initial deck reproduces every event.
    const replay = accept(shuffledState(1543), first.actions);
    expect(replay.state).toEqual(first.state);
    expect(replay.events).toEqual(first.events);
    expect(first.actions).toHaveLength(first.events.length);
    const terminal = evaluatePosition({
      observation: getObservation(first.state),
      publicHistory: first.events,
      perspective: seat,
    });
    expect(terminal.terminal).toBe(true);
    expect(terminal.total).toBe(
      first.state.result!.type === 'DRAW' ? 0 : first.state.result!.winner === seat ? 2 : -2,
    );
  });
});
