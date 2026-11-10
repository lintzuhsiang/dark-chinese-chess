import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAction, createInitialState, getGameResult, getObservation } from '../src/index';
import type { GameAction, GameState, Piece } from '../src/index';
import { deepFreeze, initialState, makeDeck } from './fixtures';

afterEach(() => vi.restoreAllMocks());

describe('initialization', () => {
  it('creates the exact hidden initial position without assigning colors', () => {
    const state = initialState();
    expect(state).toMatchObject({
      currentPlayer: 'P1',
      playerColors: { P1: null, P2: null },
      status: 'ACTIVE',
      result: null,
      plyCount: 0,
      noProgressCount: 0,
    });
    expect(state.board).toHaveLength(32);
    expect(state.board.every((square) => square !== null && !square.revealed)).toBe(true);
    expect(state.board.map((square) => square?.piece)).toEqual(makeDeck());
    expect(state).not.toHaveProperty('repetitionCounts');
  });

  it('copies the supplied deck and its pieces', () => {
    const deck = makeDeck();
    const state = initialState(deck);
    expect(state.board[0]?.piece).not.toBe(deck[0]);
    Object.assign(deck[0]!, { id: 'changed', color: 'BLACK', rank: 'SOLDIER' });
    deck.reverse();
    expect(state.board.map((square) => square?.piece)).toEqual(makeDeck());
  });

  it('accepts frozen input without mutating it', () => {
    const deck = deepFreeze(makeDeck());
    expect(createInitialState(deck).ok).toBe(true);
    expect(deck).toEqual(makeDeck());
  });

  it.each([
    ['not an array', null],
    ['missing deck', undefined],
    ['empty deck', []],
    ['too few pieces', makeDeck().slice(1)],
    ['too many pieces', [...makeDeck(), makeDeck()[0]]],
    ['missing piece', [undefined, ...makeDeck().slice(1)]],
    ['null piece', [null, ...makeDeck().slice(1)]],
    ['duplicate ID', [makeDeck()[1], ...makeDeck().slice(1)]],
    ['empty ID', [{ ...makeDeck()[0], id: '' }, ...makeDeck().slice(1)]],
    ['whitespace ID', [{ ...makeDeck()[0], id: ' ' }, ...makeDeck().slice(1)]],
    ['non-string ID', [{ ...makeDeck()[0], id: 1 }, ...makeDeck().slice(1)]],
    ['unknown color', [{ ...makeDeck()[0], color: 'BLUE' }, ...makeDeck().slice(1)]],
    ['unknown rank', [{ ...makeDeck()[0], rank: 'KING' }, ...makeDeck().slice(1)]],
    [
      'inherited object key as rank',
      [{ ...makeDeck()[0], rank: 'constructor' }, ...makeDeck().slice(1)],
    ],
    ['wrong rank count', [{ ...makeDeck()[0], rank: 'SOLDIER' }, ...makeDeck().slice(1)]],
    ['wrong color count', [{ ...makeDeck()[0], color: 'BLACK' }, ...makeDeck().slice(1)]],
    ['sparse array', Array<Piece>(32)],
  ])('rejects %s with a typed failure', (_, deck) => {
    expect(createInitialState(deck as readonly Piece[])).toEqual({
      ok: false,
      error: { code: 'INVALID_DECK' },
    });
  });
});

describe('flip transitions', () => {
  it.each([
    ['RED', 0],
    ['BLACK', 16],
  ] as const)('assigns P1 %s from the first flip', (color, position) => {
    const before = deepFreeze(initialState());
    const result = applyAction(before, 'P1', { type: 'FLIP', position });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a valid flip.');
    expect(result.state.currentPlayer).toBe('P2');
    expect(result.state.playerColors).toEqual({ P1: color, P2: color === 'RED' ? 'BLACK' : 'RED' });
    expect(result.state.board[position]?.revealed).toBe(true);
    expect(result.state.board.filter((square) => square?.revealed)).toHaveLength(1);
    expect(before.board.every((square) => !square?.revealed)).toBe(true);
    expect(before.plyCount).toBe(0);
    expect(result.state.plyCount).toBe(1);
    expect(result.event).toEqual({
      ply: 1,
      playerId: 'P1',
      type: 'FLIP',
      position,
      piece: { color, rank: 'GENERAL' },
    });
  });

  it('assigns Red to P1 when the first piece is a Red Horse', () => {
    const result = applyAction(initialState(), 'P1', { type: 'FLIP', position: 7 });
    if (!result.ok) throw new Error('Expected a valid flip.');
    expect(result.event).toMatchObject({ piece: { color: 'RED', rank: 'HORSE' } });
    expect(result.state.playerColors.P1).toBe('RED');
  });

  it.each([1, 16])(
    'lets P2 flip either color without reassigning colors (square %i)',
    (position) => {
      const first = applyAction(initialState(), 'P1', { type: 'FLIP', position: 0 });
      if (!first.ok) throw new Error('Expected first flip.');
      const second = applyAction(deepFreeze(first.state), 'P2', { type: 'FLIP', position });
      if (!second.ok) throw new Error('Expected second flip.');
      expect(second.state.playerColors).toEqual(first.state.playerColors);
      expect(second.state.currentPlayer).toBe('P1');
      expect(second.state.plyCount).toBe(2);
      expect(second.event).toMatchObject({ ply: 2, playerId: 'P2', type: 'FLIP', position });
    },
  );

  it('resets no-progress count and accepts the last valid board index', () => {
    const before = { ...initialState(), noProgressCount: 59 };
    const result = applyAction(deepFreeze(before), 'P1', { type: 'FLIP', position: 31 });
    if (!result.ok) throw new Error('Expected flip at index 31.');
    expect(result.state.noProgressCount).toBe(0);
    expect(before.noProgressCount).toBe(59);
  });

  it.each([-1, 32, 0.5, NaN, Infinity, -Infinity, undefined, null, '0'])(
    'rejects invalid position %s without mutation',
    (position) => {
      const state = deepFreeze(initialState());
      const snapshot = JSON.stringify(state);
      const action = { type: 'FLIP', position } as GameAction;
      expect(applyAction(state, 'P1', action)).toEqual({
        ok: false,
        error: { code: 'INVALID_DESTINATION' },
      });
      expect(JSON.stringify(state)).toBe(snapshot);
    },
  );

  it.each([undefined, null, {}, [], 'FLIP', { type: 'CAPTURE', position: 0 }])(
    'rejects malformed action %j',
    (action) => {
      expect(applyAction(deepFreeze(initialState()), 'P1', action as GameAction)).toEqual({
        ok: false,
        error: { code: 'INVALID_ACTION' },
      });
    },
  );

  it('rejects the wrong player, a revealed square, and an empty square', () => {
    const state = deepFreeze(initialState());
    expect(applyAction(state, 'P2', { type: 'FLIP', position: 0 })).toEqual({
      ok: false,
      error: { code: 'NOT_YOUR_TURN' },
    });
    const first = applyAction(state, 'P1', { type: 'FLIP', position: 0 });
    if (!first.ok) throw new Error('Expected first flip.');
    const snapshot = JSON.stringify(first.state);
    expect(applyAction(deepFreeze(first.state), 'P2', { type: 'FLIP', position: 0 })).toEqual({
      ok: false,
      error: { code: 'INVALID_FLIP' },
    });
    expect(JSON.stringify(first.state)).toBe(snapshot);
    const empty: GameState = {
      ...state,
      board: state.board.map((square, index) => (index === 0 ? null : square)),
    };
    expect(applyAction(deepFreeze(empty), 'P1', { type: 'FLIP', position: 0 })).toEqual({
      ok: false,
      error: { code: 'INVALID_FLIP' },
    });
  });

  it('rejects actions after completion and moving a hidden source', () => {
    const state = deepFreeze(initialState());
    const finished: GameState = {
      ...state,
      status: 'FINISHED',
      result: { type: 'DRAW', reason: 'NO_PROGRESS' },
    };
    expect(applyAction(deepFreeze(finished), 'P1', { type: 'FLIP', position: 0 })).toEqual({
      ok: false,
      error: { code: 'GAME_FINISHED' },
    });
    expect(applyAction(state, 'P1', { type: 'MOVE', from: 0, to: 1 })).toEqual({
      ok: false,
      error: { code: 'INVALID_SOURCE' },
    });
  });

  it('reproduces all 32 flips without using time or randomness', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('No random transitions.');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('No timed transitions.');
    });
    function run() {
      let state = initialState();
      const steps = [];
      for (let position = 0; position < 32; position += 1) {
        const result = applyAction(deepFreeze(state), state.currentPlayer, {
          type: 'FLIP',
          position,
        });
        if (!result.ok) throw new Error('Expected each hidden square to flip.');
        state = result.state;
        expect(state.plyCount).toBe(position + 1);
        expect(state.board.filter((square) => square?.revealed)).toHaveLength(position + 1);
        expect(new Set(state.board.map((square) => square?.piece.id)).size).toBe(32);
        steps.push({ state, event: result.event });
      }
      return steps;
    }
    expect(run()).toEqual(run());
  });
});

describe('public observations and events', () => {
  it('projects only generic hidden squares with no IDs, history, or deck', () => {
    const state = initialState();
    const observation = getObservation(state);
    expect(observation.board).toEqual(Array.from({ length: 32 }, () => ({ kind: 'HIDDEN' })));
    expect(Object.keys(observation).sort()).toEqual([
      'board',
      'currentPlayer',
      'playerColors',
      'result',
      'status',
    ]);
    expect(JSON.stringify(observation)).not.toMatch(/fixture-|rank|GENERAL|RED|BLACK/);
  });

  it('exposes only the flipped piece, and copies public data without writable state aliases', () => {
    const result = applyAction(initialState(), 'P1', { type: 'FLIP', position: 0 });
    if (!result.ok) throw new Error('Expected flip.');
    const observation = getObservation(result.state);
    expect(observation.board[0]).toEqual({
      kind: 'REVEALED',
      piece: { color: 'RED', rank: 'GENERAL' },
    });
    expect(
      observation.board.slice(1).every((square) => JSON.stringify(square) === '{"kind":"HIDDEN"}'),
    ).toBe(true);
    expect(JSON.stringify([observation, result.event])).not.toContain('fixture-');
    const square = observation.board[0];
    if (square?.kind !== 'REVEALED') throw new Error('Expected revealed public square.');
    Object.assign(square.piece, { rank: 'SOLDIER' });
    Object.assign(observation.board[1]!, { kind: 'EMPTY' });
    Object.assign(observation.playerColors, { P1: 'BLACK' });
    Object.assign(result.event.piece, { rank: 'SOLDIER' });
    expect(result.state.board[0]?.piece.rank).toBe('GENERAL');
    expect(result.state.board[1]?.revealed).toBe(false);
    expect(result.state.playerColors.P1).toBe('RED');
  });

  it('projects empty squares and reads a stored result without aliases or reevaluation', () => {
    const state: GameState = {
      ...initialState(),
      board: Array.from({ length: 32 }, () => null),
      status: 'FINISHED',
      result: { type: 'WIN', winner: 'P1', reason: 'NO_PIECES' },
    };
    const observation = getObservation(state);
    expect(observation.board.every((square) => square.kind === 'EMPTY')).toBe(true);
    expect(getGameResult(initialState())).toBeNull();
    expect(getGameResult(state)).toEqual(state.result);
    expect(getGameResult(state)).not.toBe(state.result);
    Object.assign(observation.result!, { winner: 'P2' });
    expect(state.result).toMatchObject({ winner: 'P1' });
  });
});
