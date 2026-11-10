import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState } from '../../game-core/src/index';
import type { ActionEvent, GameAction, GameState } from '../../game-core/src/index';
import { initialState, makeDeck } from '../../game-core/tests/fixtures';
import { createAgentInput } from '../../../scripts/ai-eval/agent-input';
import { randomAgent } from '../src/index';

function capturedPosition(): { state: GameState; history: ActionEvent[] } {
  const deck = makeDeck();
  for (const [position, color, rank] of [
    [0, 'RED', 'CHARIOT'],
    [1, 'BLACK', 'HORSE'],
  ] as const) {
    const source = deck.findIndex((piece) => piece.color === color && piece.rank === rank);
    [deck[position], deck[source]] = [deck[source]!, deck[position]!];
  }
  const initial = createInitialState(deck);
  if (!initial.ok) throw new Error('Expected valid fixture deck.');
  let state = initial.state;
  const history: ActionEvent[] = [];
  const actions: GameAction[] = [
    { type: 'FLIP', position: 0 },
    { type: 'FLIP', position: 1 },
    { type: 'MOVE', from: 0, to: 1 },
  ];
  for (const action of actions) {
    const result = applyAction(state, state.currentPlayer, action);
    if (!result.ok) throw new Error('Expected valid fixture action.');
    state = result.state;
    history.push(result.event);
  }
  return { state, history };
}

describe('trusted public-input adapter', () => {
  it('exposes exactly the approved opening fields without private identities or counters', () => {
    const state = initialState();
    const input = createAgentInput(state, [], 'P1');
    expect(Object.keys(input).sort()).toEqual([
      'legalActions',
      'observation',
      'perspective',
      'publicHistory',
    ]);
    expect(input.observation.playerColors).toEqual({ P1: null, P2: null });
    expect(input.observation.board).toEqual(Array.from({ length: 32 }, () => ({ kind: 'HIDDEN' })));
    expect(JSON.stringify(input)).not.toMatch(/fixture-|rank|GENERAL|chase|plyCount|Seed/);
    expect(input.legalActions).toHaveLength(32);
  });

  it('copies and freezes public observations, captures, and history without freezing trusted sources', () => {
    const { state, history } = capturedPosition();
    const capture = history[2]!;
    if (capture.type !== 'MOVE' || capture.captured === null) throw new Error('Expected capture.');
    Object.assign(capture, { internalId: 'secret-event-id' });
    Object.assign(capture.piece, { id: 'secret-mover-id' });
    Object.assign(capture.captured, { id: 'secret-captured-id' });
    const sourceBefore = JSON.stringify({ state, history });
    const input = createAgentInput(state, history, 'P2');
    expect(JSON.stringify(input)).not.toMatch(/fixture-|secret-|internalId|"id"|positionCounts/);
    expect(input.publicHistory[2]).toEqual({
      ply: 3,
      playerId: 'P1',
      type: 'MOVE',
      from: 0,
      to: 1,
      piece: { color: 'RED', rank: 'CHARIOT' },
      captured: { color: 'BLACK', rank: 'HORSE' },
    });
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.observation.board)).toBe(true);
    expect(Object.isFrozen(input.observation.playerColors)).toBe(true);
    expect(Object.isFrozen(input.legalActions[0])).toBe(true);
    expect(Object.isFrozen(input.publicHistory[2])).toBe(true);
    expect(Object.isFrozen(input.publicHistory[2]!.piece)).toBe(true);
    expect(() => Object.assign(input.observation.playerColors, { P1: 'BLACK' })).toThrow();
    expect(() => Object.assign(input.publicHistory[2]!.piece, { rank: 'GENERAL' })).toThrow();
    expect(JSON.stringify({ state, history })).toBe(sourceBefore);
    expect(Object.isFrozen(history)).toBe(false);
    expect(Object.isFrozen(capture.piece)).toBe(false);
    Object.assign(capture.piece, { rank: 'GENERAL' });
    expect(input.publicHistory[2]!.piece.rank).toBe('CHARIOT');
  });

  it('is invariant under hidden-state permutations through the complete policy input and decision', async () => {
    const { state, history } = capturedPosition();
    const hiddenPositions = state.board.flatMap((square, position) =>
      square !== null && !square.revealed ? [position] : [],
    );
    const first = hiddenPositions[0]!;
    const second = hiddenPositions[hiddenPositions.length - 1]!;
    const board = [...state.board];
    [board[first], board[second]] = [board[second]!, board[first]!];
    const permuted = { ...state, board };
    expect(permuted.board).not.toEqual(state.board);
    const originalInput = createAgentInput(state, history, 'P2');
    const permutedInput = createAgentInput(permuted, history, 'P2');
    expect(permutedInput).toEqual(originalInput);
    for (const seed of [0, 1, 42, 0xffffffff]) {
      expect(await randomAgent.chooseAction(permutedInput, { seed })).toEqual(
        await randomAgent.chooseAction(originalInput, { seed }),
      );
    }
  });

  it('rejects wrong perspective, incomplete/future history, and nonsequential event plies', () => {
    const { state, history } = capturedPosition();
    expect(() => createAgentInput(state, history, 'P1')).toThrow('current player');
    expect(() => createAgentInput(state, history.slice(1), 'P2')).toThrow('accepted prefix');
    expect(() => createAgentInput(state, [...history, history[0]!], 'P2')).toThrow(
      'accepted prefix',
    );
    const outOfOrder = history.map((event) => ({ ...event, ply: 3 }));
    expect(() => createAgentInput(state, outOfOrder, 'P2')).toThrow('accepted prefix');
  });

  it('rejects terminal games and an ACTIVE state lacking permitted actions', () => {
    const initial = initialState();
    expect(() =>
      createAgentInput(
        { ...initial, status: 'FINISHED', result: { type: 'DRAW', reason: 'NO_PROGRESS' } },
        [],
        'P1',
      ),
    ).toThrow('nonterminal');
    expect(() =>
      createAgentInput({ ...initial, board: Array.from({ length: 32 }, () => null) }, [], 'P1'),
    ).toThrow('no permitted actions');
  });
});
