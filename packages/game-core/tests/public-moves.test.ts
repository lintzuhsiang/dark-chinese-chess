import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions, getObservation, getPublicOrdinaryMoves } from '../src/index';
import type { GameAction, GameState, PublicSquare } from '../src/index';
import { getActionError } from '../src/validation';
import { deepFreeze, initialState } from './fixtures';
import { publicMoveFixture } from './public-move-fixtures';
import { PUBLIC_MOVE_BASELINE as baseline } from './public-moves-baseline';

describe('shared public ordinary movement', () => {
  it.each(baseline.fixtures)('matches the PRE-extraction Core oracle: $seed $color', (fixture) => {
    expect(baseline.coreRevision).toBe('34452df2bc198d382e36399218d2cfcb9e95f3f3');
    const state = publicMoveFixture(fixture.seed);
    const board = deepFreeze(getObservation(state).board);
    const moves = getPublicOrdinaryMoves(board, fixture.color);
    expect(moves).toHaveLength(fixture.count);
    expect(moves.map((move) => [move.from, move.to])).toEqual(fixture.moves);
  });

  it.each([0, 1, 7, 19, 42])(
    'matches all authoritative ordinary MOVE candidates for both colors: %i',
    (seed) => {
      const original = deepFreeze(publicMoveFixture(seed));
      for (const player of ['P1', 'P2'] as const) {
        const state: GameState = { ...original, currentPlayer: player };
        const color = state.playerColors[player]!;
        const board = getObservation(state).board;
        const before = JSON.stringify(board);
        const moves = getPublicOrdinaryMoves(deepFreeze(board), color);
        const keys = new Set(moves.map((move) => move.from + ':' + move.to));
        expect(keys.size).toBe(moves.length);
        for (let from = 0; from < 32; from += 1) {
          for (let to = 0; to < 32; to += 1) {
            const action: GameAction = { type: 'MOVE', from, to };
            expect(keys.has(from + ':' + to)).toBe(getActionError(state, player, action) === null);
          }
        }
        expect(JSON.stringify(board)).toBe(before);
        const hidden = original.board.flatMap((square, index) =>
          square && !square.revealed ? [index] : [],
        );
        const permuted = [...original.board];
        for (let index = 0; index < hidden.length; index += 1) {
          permuted[hidden[index]!] = original.board[hidden[(index + 1) % hidden.length]!]!;
        }
        expect(
          getPublicOrdinaryMoves(getObservation({ ...state, board: permuted }).board, color),
        ).toEqual(moves);
      }
    },
  );

  it('agrees with legal enumeration and public board patches through an accepted sequence', () => {
    let state = initialState();
    for (let ply = 0; ply < 160 && state.status === 'ACTIVE'; ply += 1) {
      const before = getObservation(state);
      const legal = getLegalActions(state, state.currentPlayer);
      expect(legal.length).toBeGreaterThan(0);
      const color = before.playerColors[state.currentPlayer];
      const ordinary = color === null ? [] : getPublicOrdinaryMoves(before.board, color);
      for (const action of ordinary) {
        const result = applyAction(state, state.currentPlayer, action);
        if (!result.ok) expect(result.error.code).toBe('PERPETUAL_CHASE');
      }
      for (const action of legal) {
        if (action.type !== 'MOVE') continue;
        expect(ordinary).toContainEqual(action);
        const result = applyAction(state, state.currentPlayer, action);
        if (!result.ok) throw new Error('Permitted MOVE rejected.');
        const patched: PublicSquare[] = [...before.board];
        patched[action.to] = before.board[action.from]!;
        patched[action.from] = { kind: 'EMPTY' };
        expect(getObservation(result.state).board).toEqual(patched);
      }
      const action = legal[(ply * 17 + 3) % legal.length]!;
      const result = applyAction(state, state.currentPlayer, action);
      if (!result.ok) throw new Error('Permitted action rejected.');
      state = result.state;
    }
  });

  it('has no movement on the hidden opening and rejects invalid public board length', () => {
    const board = getObservation(initialState()).board;
    expect(getPublicOrdinaryMoves(board, 'RED')).toEqual([]);
    expect(getPublicOrdinaryMoves(board, 'BLACK')).toEqual([]);
    expect(() => getPublicOrdinaryMoves([], 'RED')).toThrow(RangeError);
  });
});
