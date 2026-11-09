import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions, getObservation } from '../src/index';
import type { GameAction, GameState, PieceColor, PieceRank, Square } from '../src/index';
import { deepFreeze, initialState } from './fixtures';

const ranks: readonly PieceRank[] = ['GENERAL', 'ADVISOR', 'ELEPHANT', 'CHARIOT', 'HORSE', 'CANNON', 'SOLDIER'];
const colors: readonly PieceColor[] = ['RED', 'BLACK'];
const captureTargets: Readonly<Record<PieceRank, readonly PieceRank[]>> = {
  GENERAL: ['GENERAL', 'ADVISOR', 'ELEPHANT', 'CHARIOT', 'HORSE', 'CANNON'],
  ADVISOR: ['ADVISOR', 'ELEPHANT', 'CHARIOT', 'HORSE', 'CANNON', 'SOLDIER'],
  ELEPHANT: ['ELEPHANT', 'CHARIOT', 'HORSE', 'CANNON', 'SOLDIER'],
  CHARIOT: ['CHARIOT', 'HORSE', 'CANNON', 'SOLDIER'],
  HORSE: ['HORSE', 'CANNON', 'SOLDIER'],
  CANNON: [],
  SOLDIER: ['GENERAL', 'SOLDIER'],
};

function piece(position: number, rank: PieceRank, color: PieceColor = 'RED', revealed = true): readonly [number, Square] {
  return [position, { piece: { id: `private-${color}-${rank}-${position}`, color, rank }, revealed }];
}

function positionState(entries: readonly (readonly [number, Square])[], color: PieceColor = 'RED'): GameState {
  const board: Square[] = Array.from({ length: 32 }, () => null);
  for (const [position, square] of entries) board[position] = square;
  return deepFreeze({
    ...initialState(), board, playerColors: { P1: color, P2: color === 'RED' ? 'BLACK' : 'RED' },
    plyCount: 8,
  });
}

describe('ordinary movement', () => {
  const cases = colors.flatMap(color => ranks.flatMap(rank => [5, 8, 10, 13].map(to => ({ color, rank, to }))));
  it.each(cases)('$color $rank moves from 9 to adjacent empty square $to', ({ color, rank, to }) => {
    const before = positionState([piece(9, rank, color)], color);
    const result = applyAction(before, 'P1', { type: 'MOVE', from: 9, to });
    if (!result.ok) throw new Error(`Expected a legal move: ${result.error.code}`);
    expect(result.state.board[9]).toBeNull();
    expect(result.state.board[to]).toEqual(before.board[9]);
    expect(result.state.currentPlayer).toBe('P2');
    expect(result.state.plyCount).toBe(9);
    expect(result.state.playerColors).toEqual(before.playerColors);
    expect(result.event).toEqual({ ply: 9, playerId: 'P1', type: 'MOVE', from: 9, to, piece: { color, rank }, captured: null });
    expect(before.board[9]).not.toBeNull();
    expect(before.board[to]).toBeNull();
  });

  it.each([
    [0, 1], [0, 4], [3, 2], [3, 7], [28, 24], [28, 29], [31, 27], [31, 30],
  ])('permits inward movement from edge %i to %i', (from, to) => {
    expect(applyAction(positionState([piece(from, 'GENERAL')]), 'P1', { type: 'MOVE', from, to }).ok).toBe(true);
  });

  it.each([
    [3, 4], [4, 3], [7, 8], [8, 7], [27, 28], [28, 27],
    [0, 5], [5, 0], [31, 26], [9, 11], [9, 17], [9, 9],
  ])('rejects row wrapping, diagonals, distance, or no-op %i to %i', (from, to) => {
    const state = positionState([piece(from, 'HORSE')]);
    const snapshot = JSON.stringify(state);
    expect(applyAction(state, 'P1', { type: 'MOVE', from, to }))
      .toEqual({ ok: false, error: { code: 'ILLEGAL_MOVE' } });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('normal captures', () => {
  it('lets P2 capture with its assigned color and records the actor before advancing to P1', () => {
    const state: GameState = deepFreeze({
      ...positionState([piece(10, 'CHARIOT', 'BLACK'), piece(9, 'SOLDIER', 'RED')]),
      currentPlayer: 'P2',
    });
    const result = applyAction(state, 'P2', { type: 'MOVE', from: 10, to: 9 });
    if (!result.ok) throw new Error('Expected P2 capture.');
    expect(result.state.currentPlayer).toBe('P1');
    expect(result.state.board[10]).toBeNull();
    expect(result.state.board[9]?.piece).toMatchObject({ color: 'BLACK', rank: 'CHARIOT' });
    expect(result.event).toEqual({
      ply: 9, playerId: 'P2', type: 'MOVE', from: 10, to: 9,
      piece: { color: 'BLACK', rank: 'CHARIOT' }, captured: { color: 'RED', rank: 'SOLDIER' },
    });
    expect(state.board[9]?.piece.rank).toBe('SOLDIER');
    expect(state.board[10]?.piece.rank).toBe('CHARIOT');
  });

  const cases = colors.flatMap(color => ranks.flatMap(attacker => ranks.map(target => ({ color, attacker, target }))));
  it.each(cases)('$color $attacker captures adjacent $target only when the documented matrix allows it', ({ color, attacker, target }) => {
    const enemy = color === 'RED' ? 'BLACK' : 'RED';
    const state = positionState([piece(9, attacker, color), piece(10, target, enemy)], color);
    const snapshot = JSON.stringify(state);
    const result = applyAction(state, 'P1', { type: 'MOVE', from: 9, to: 10 });
    expect(result.ok).toBe(captureTargets[attacker].includes(target));
    if (result.ok) {
      expect(result.state.board[9]).toBeNull();
      expect(result.state.board[10]).toEqual(state.board[9]);
      expect(result.state.board.filter(Boolean)).toHaveLength(1);
      expect(result.event).toEqual({
        ply: 9, playerId: 'P1', type: 'MOVE', from: 9, to: 10,
        piece: { color, rank: attacker }, captured: { color: enemy, rank: target },
      });
    } else expect(result.error.code).toBe('ILLEGAL_MOVE');
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it.each([['GENERAL', 4], ['ADVISOR', 0], ['SOLDIER', 17]] as const)('rejects non-adjacent %s capture at %i despite valid ranks', (rank, to) => {
    expect(applyAction(positionState([piece(9, rank), piece(to, rank, 'BLACK')]), 'P1', { type: 'MOVE', from: 9, to }).ok).toBe(false);
  });

  it.each([5, 8, 10, 13])('permits orthogonally adjacent capture in direction %i', to => {
    expect(applyAction(positionState([piece(9, 'CHARIOT'), piece(to, 'SOLDIER', 'BLACK')]), 'P1', { type: 'MOVE', from: 9, to }).ok).toBe(true);
  });
});

describe('Cannon capture', () => {
  const directions = [
    { from: 0, to: 3, screen: 1 }, { from: 3, to: 0, screen: 2 },
    { from: 0, to: 28, screen: 12 }, { from: 28, to: 0, screen: 16 },
  ];
  const screens = colors.flatMap(color => [true, false].map(revealed => ({ color, revealed })));
  it.each(directions.flatMap(direction => screens.map(screen => ({ ...direction, ...screen }))))(
    'captures from $from to $to over one $color screen (revealed=$revealed)',
    ({ from, to, screen, color, revealed }) => {
      const state = positionState([piece(from, 'CANNON'), piece(to, 'GENERAL', 'BLACK'), piece(screen, 'SOLDIER', color, revealed)]);
      const result = applyAction(state, 'P1', { type: 'MOVE', from, to });
      if (!result.ok) throw new Error(`Expected Cannon capture: ${result.error.code}`);
      expect(result.state.board[from]).toBeNull();
      expect(result.state.board[to]?.piece.rank).toBe('CANNON');
      expect(result.state.board[screen]).toEqual(state.board[screen]);
      expect(result.event).toMatchObject({ captured: { color: 'BLACK', rank: 'GENERAL' } });
      expect(JSON.stringify(result.event)).not.toContain('private-');
      if (!revealed) expect(getObservation(result.state).board[screen]).toEqual({ kind: 'HIDDEN' });
    },
  );

  it.each(colors.flatMap(color => ranks.map(target => ({ color, target })) ))('captures $target regardless of rank for $color', ({ color, target }) => {
    const enemy = color === 'RED' ? 'BLACK' : 'RED';
    expect(applyAction(positionState([
      piece(0, 'CANNON', color), piece(12, 'HORSE', color, false), piece(28, target, enemy),
    ], color), 'P1', { type: 'MOVE', from: 0, to: 28 }).ok).toBe(true);
  });

  it.each(ranks)('accepts a %s as the single screen', rank => {
    const state = positionState([piece(0, 'CANNON'), piece(1, rank), piece(3, 'GENERAL', 'BLACK')]);
    expect(applyAction(state, 'P1', { type: 'MOVE', from: 0, to: 3 }).ok).toBe(true);
  });

  it.each([
    { from: 0, to: 1, screen: [] },
    { from: 0, to: 3, screen: [] },
    { from: 0, to: 28, screen: [] },
    { from: 0, to: 3, screen: [1, 2] },
    { from: 0, to: 28, screen: [4, 24] },
    { from: 28, to: 0, screen: [4, 12, 24] },
    { from: 0, to: 9, screen: [4] },
    { from: 3, to: 4, screen: [] },
  ])('rejects invalid alignment/screen count from $from to $to with screens $screen', ({ from, to, screen }) => {
    const state = positionState([piece(from, 'CANNON'), piece(to, 'GENERAL', 'BLACK'), ...screen.map(index => piece(index, 'HORSE', 'BLACK', false))]);
    expect(applyAction(state, 'P1', { type: 'MOVE', from, to }))
      .toEqual({ ok: false, error: { code: 'ILLEGAL_MOVE' } });
  });

  it.each([true, false])('cannot jump to an empty destination, hidden screen revealed=%s', revealed => {
    const state = positionState([piece(0, 'CANNON'), piece(1, 'HORSE', 'RED', revealed)]);
    expect(applyAction(state, 'P1', { type: 'MOVE', from: 0, to: 3 }).ok).toBe(false);
  });
});

describe('action validation and immutable rejection', () => {
  const invalidCoordinates: readonly unknown[] = [-1, 32, 1.5, NaN, Infinity, -Infinity, undefined, null, '9', {}, true];
  it.each(invalidCoordinates.map(value => [value]))('rejects malformed source %j', value => {
    const state = positionState([piece(9, 'CHARIOT')]);
    const snapshot = JSON.stringify(state);
    expect(applyAction(state, 'P1', { type: 'MOVE', from: value, to: 10 } as GameAction))
      .toEqual({ ok: false, error: { code: 'INVALID_SOURCE' } });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it.each(invalidCoordinates.map(value => [value]))('rejects malformed destination %j', value => {
    const state = positionState([piece(9, 'CHARIOT')]);
    expect(applyAction(state, 'P1', { type: 'MOVE', from: 9, to: value } as GameAction))
      .toEqual({ ok: false, error: { code: 'INVALID_DESTINATION' } });
  });

  it.each([
    { entries: [piece(9, 'CHARIOT', 'RED', false)], code: 'INVALID_SOURCE' },
    { entries: [piece(9, 'CHARIOT', 'BLACK')], code: 'INVALID_SOURCE' },
    { entries: [], code: 'INVALID_SOURCE' },
    { entries: [piece(9, 'CHARIOT'), piece(10, 'HORSE', 'RED')], code: 'ILLEGAL_MOVE' },
    { entries: [piece(9, 'CHARIOT'), piece(10, 'HORSE', 'BLACK', false)], code: 'ILLEGAL_MOVE' },
  ])('rejects inaccessible source or protected destination $entries', ({ entries, code }) => {
    const state = positionState(entries);
    const snapshot = JSON.stringify(state);
    expect(applyAction(state, 'P1', deepFreeze({ type: 'MOVE', from: 9, to: 10 })))
      .toEqual({ ok: false, error: { code } });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('rejects a Cannon hidden/friendly target even with a valid screen', () => {
    for (const target of [piece(3, 'GENERAL', 'BLACK', false), piece(3, 'SOLDIER', 'RED')]) {
      const state = positionState([piece(0, 'CANNON'), piece(1, 'HORSE'), target]);
      const snapshot = JSON.stringify(state);
      expect(applyAction(state, 'P1', { type: 'MOVE', from: 0, to: 3 }))
        .toEqual({ ok: false, error: { code: 'ILLEGAL_MOVE' } });
      expect(JSON.stringify(state)).toBe(snapshot);
    }
  });

  it('rejects the wrong actor and finished-game moves, and preserves Task 3 state', () => {
    const state = positionState([piece(9, 'CHARIOT')]);
    expect(applyAction(state, 'P2', { type: 'MOVE', from: 9, to: 10 }))
      .toEqual({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    const finished: GameState = deepFreeze({ ...state, status: 'FINISHED', result: { type: 'DRAW', reason: 'NO_PROGRESS' } });
    expect(applyAction(finished, 'P1', { type: 'MOVE', from: 9, to: 10 }))
      .toEqual({ ok: false, error: { code: 'GAME_FINISHED' } });
    const pending: GameState = deepFreeze({ ...state, noProgressCount: 59 });
    const result = applyAction(pending, 'P1', { type: 'MOVE', from: 9, to: 10 });
    if (!result.ok) throw new Error('Expected legal quiet move.');
    expect(result.state.noProgressCount).toBe(59);
    expect(result.state.status).toBe('ACTIVE');
    expect(result.state.result).toBeNull();
  });

  it('copies public MOVE event data independently of full state', () => {
    const state = positionState([piece(9, 'CHARIOT'), piece(10, 'HORSE', 'BLACK')]);
    const result = applyAction(state, 'P1', { type: 'MOVE', from: 9, to: 10 });
    if (!result.ok || result.event.type !== 'MOVE') throw new Error('Expected capture event.');
    expect(JSON.stringify(result.event)).not.toContain('private-');
    Object.assign(result.event.piece, { rank: 'SOLDIER' });
    Object.assign(result.event.captured!, { rank: 'GENERAL' });
    expect(result.state.board[10]?.piece.rank).toBe('CHARIOT');
    expect(state.board[10]?.piece.rank).toBe('HORSE');
  });
});

describe('legal-action enumeration', () => {
  const mixed = () => positionState([
    piece(0, 'CANNON'), piece(1, 'SOLDIER', 'BLACK', false), piece(3, 'GENERAL', 'BLACK'),
    piece(9, 'CHARIOT'), piece(10, 'HORSE', 'BLACK'), piece(15, 'HORSE'),
    piece(16, 'GENERAL'), piece(20, 'SOLDIER', 'BLACK'), piece(31, 'ADVISOR', 'BLACK', false),
  ]);

  it('keeps observations and legal actions identical when only hidden identities are permuted', () => {
    const original = mixed();
    const board = [...original.board];
    board[22] = piece(22, 'GENERAL', 'RED', false)[1];
    const before: GameState = deepFreeze({ ...original, board });
    const permuted = [...before.board];
    [permuted[1], permuted[22], permuted[31]] = [before.board[22]!, before.board[31]!, before.board[1]!];
    const after: GameState = deepFreeze({ ...before, board: permuted });
    expect(after.board).not.toEqual(before.board);
    expect(getObservation(after)).toEqual(getObservation(before));
    expect(getLegalActions(after, 'P1')).toEqual(getLegalActions(before, 'P1'));
    expect(getLegalActions({ ...after, currentPlayer: 'P2' }, 'P2'))
      .toEqual(getLegalActions({ ...before, currentPlayer: 'P2' }, 'P2'));
  });

  it('initially enumerates exactly the 32 available flips', () => {
    const actions = getLegalActions(deepFreeze(initialState()), 'P1');
    expect(actions).toEqual(Array.from({ length: 32 }, (_, position) => ({ type: 'FLIP', position })));
  });

  it('enumerates exactly every accepted board action, without mutation or duplicates', () => {
    const state = mixed();
    const snapshot = JSON.stringify(state);
    const legal = getLegalActions(state, 'P1');
    const serialized = new Set(legal.map(action => JSON.stringify(action)));
    expect(serialized.size).toBe(legal.length);
    for (let from = 0; from < 32; from += 1) {
      const flip: GameAction = { type: 'FLIP', position: from };
      expect(serialized.has(JSON.stringify(flip))).toBe(applyAction(state, 'P1', flip).ok);
      for (let to = 0; to < 32; to += 1) {
        const move: GameAction = { type: 'MOVE', from, to };
        expect(serialized.has(JSON.stringify(move))).toBe(applyAction(state, 'P1', move).ok);
      }
    }
    expect(legal).toContainEqual({ type: 'MOVE', from: 0, to: 3 });
    expect(legal).toContainEqual({ type: 'MOVE', from: 9, to: 10 });
    expect(legal).toContainEqual({ type: 'FLIP', position: 31 });
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(JSON.stringify(legal)).not.toMatch(/private-|GENERAL|BLACK/);
  });

  it('has no actions for a non-current player or completed game', () => {
    const state = mixed();
    expect(getLegalActions(state, 'P2')).toEqual([]);
    const finished: GameState = deepFreeze({ ...state, status: 'FINISHED', result: { type: 'DRAW', reason: 'NO_PROGRESS' } });
    expect(getLegalActions(finished, 'P1')).toEqual([]);
  });

  it('preserves piece identities and hidden-data boundaries through a deterministic accepted sequence', () => {
    let state = initialState();
    let captures = 0;
    for (let ply = 0; ply < 100; ply += 1) {
      const legal = getLegalActions(deepFreeze(state), state.currentPlayer);
      if (legal.length === 0) break;
      const action = legal[(ply * 17 + 3) % legal.length]!;
      const result = applyAction(state, state.currentPlayer, action);
      if (!result.ok) throw new Error('An enumerated action must be accepted.');
      if (result.event.type === 'MOVE' && result.event.captured !== null) captures += 1;
      state = result.state;
      const remaining = state.board.filter(square => square !== null);
      expect(remaining).toHaveLength(32 - captures);
      expect(new Set(remaining.map(square => square.piece.id)).size).toBe(remaining.length);
      expect(state.plyCount).toBe(ply + 1);
      const observation = getObservation(state);
      expect(JSON.stringify(observation)).not.toContain('fixture-');
      for (let position = 0; position < 32; position += 1) {
        if (state.board[position]?.revealed === false) expect(observation.board[position]).toEqual({ kind: 'HIDDEN' });
      }
    }
    expect(state.plyCount).toBeGreaterThan(32);
  });
});
