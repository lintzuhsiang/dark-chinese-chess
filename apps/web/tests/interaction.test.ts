import { describe, expect, it } from 'vitest';
import { getObservation } from '@dark-chess/game-core';
import type { Piece, PieceColor, PieceRank } from '@dark-chess/game-core';
import { boardUiReducer, initialBoardUi } from '../src/game/interaction';
import type { BoardUiState } from '../src/game/interaction';
import { createShuffledDeck } from '../src/game/deck';

// Keep every fixture reachable from a valid initial deck and accepted flips.
function arrangedDeck(): Piece[] {
  const remaining = createShuffledDeck(() => 1 - Number.EPSILON);
  function take(color: PieceColor, rank: PieceRank): Piece {
    const index = remaining.findIndex(piece => piece.color === color && piece.rank === rank);
    if (index < 0) throw new Error('Fixture piece is missing.');
    return remaining.splice(index, 1)[0]!;
  }
  const fixed = new Map<number, Piece>([
    [0, take('RED', 'CHARIOT')], [1, take('BLACK', 'HORSE')],
    [2, take('RED', 'HORSE')], [3, take('BLACK', 'GENERAL')], [4, take('BLACK', 'SOLDIER')],
    [8, take('RED', 'SOLDIER')],
  ]);
  return Array.from({ length: 32 }, (_, index) => fixed.get(index) ?? remaining.shift()!);
}

const click = (state: BoardUiState, position: number) => boardUiReducer(state, { type: 'CLICK', position });
const start = () => boardUiReducer(initialBoardUi, { type: 'START', deck: arrangedDeck() });

function revealedBoard(): BoardUiState {
  let state = start();
  for (let position = 0; position < 32; position += 1) state = click(state, position);
  if (state.local.error !== null) throw new Error('Fixture flips must succeed.');
  return state;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe('board interaction and session integration', () => {
  it('keeps first-flip assignment and subsequent opposite-player flipping', () => {
    const initial = start();
    const first = click(freeze(initial), 0);
    expect(first.local.session?.currentState.playerColors).toEqual({ P1: 'RED', P2: 'BLACK' });
    expect(first.local.session?.currentState.currentPlayer).toBe('P2');
    expect(first.selectedSquare).toBeNull();
    const second = click(first, 1);
    expect(second.local.session?.currentState.currentPlayer).toBe('P1');
    expect(second.local.session?.actions).toEqual([
      { playerId: 'P1', action: { type: 'FLIP', position: 0 } },
      { playerId: 'P2', action: { type: 'FLIP', position: 1 } },
    ]);
  });

  it('selects, deselects, and switches friendly revealed pieces without a domain action', () => {
    const initial = freeze(revealedBoard());
    const selected = click(initial, 0);
    expect(selected.selectedSquare).toBe(0);
    expect(selected.local.session).toBe(initial.local.session);
    expect(selected.local.error).toBeNull();
    const switched = click(selected, 2);
    expect(switched.selectedSquare).toBe(2);
    expect(switched.local.session).toBe(initial.local.session);
    const deselected = click(switched, 2);
    expect(deselected.selectedSquare).toBeNull();
    expect(deselected.local.session).toBe(initial.local.session);
    expect(initial.local.session?.actions).toHaveLength(32);
    expect(initial.local.session?.currentState.currentPlayer).toBe('P1');
  });

  it('does not select an opponent piece, consume a turn, or append history', () => {
    const initial = freeze(revealedBoard());
    const rejected = click(initial, 1);
    expect(rejected.selectedSquare).toBeNull();
    expect(rejected.local.error?.code).toBe('INVALID_SOURCE');
    expect(rejected.local.session).toBe(initial.local.session);
    expect(click(rejected, 0).local.error).toBeNull();
  });

  it('captures, moves into empty destinations, advances turns, and clears selection', () => {
    const initial = freeze(revealedBoard());
    const captured = click(click(initial, 0), 1);
    expect(captured.local.error).toBeNull();
    expect(captured.selectedSquare).toBeNull();
    const captureState = captured.local.session!.currentState;
    expect(captureState.board[0]).toBeNull();
    expect(captureState.board[1]?.piece).toMatchObject({ color: 'RED', rank: 'CHARIOT' });
    expect(captureState.currentPlayer).toBe('P2');
    expect(captured.local.session?.actions.at(-1)).toEqual({ playerId: 'P1', action: { type: 'MOVE', from: 0, to: 1 } });
    expect(initial.local.session?.currentState.board[0]?.piece.color).toBe('RED');
    expect(initial.local.session?.currentState.board[1]?.piece.color).toBe('BLACK');

    const moved = click(click(freeze(captured), 4), 0);
    expect(moved.local.error).toBeNull();
    expect(moved.selectedSquare).toBeNull();
    expect(moved.local.session?.currentState.board[4]).toBeNull();
    expect(moved.local.session?.currentState.board[0]?.piece).toMatchObject({ color: 'BLACK', rank: 'SOLDIER' });
    expect(moved.local.session?.currentState.currentPlayer).toBe('P1');
    const next = click(click(moved, 8), 4);
    expect(next.local.error).toBeNull();
    expect(next.local.session?.currentState.board[8]).toBeNull();
    expect(next.local.session?.currentState.board[4]?.piece).toMatchObject({ color: 'RED', rank: 'SOLDIER' });
    expect(next.local.session?.actions).toHaveLength(35);
    expect(next.local.session?.currentState.plyCount).toBe(35);
  });

  it('preserves selection and the exact session on an illegal capture, then allows another selection', () => {
    const initial = freeze(revealedBoard());
    const selected = click(initial, 2);
    const rejected = click(selected, 3); // Adjacent Horse cannot capture a stronger General.
    expect(rejected.local.error).not.toBeNull();
    expect(rejected.selectedSquare).toBe(2);
    expect(rejected.local.session).toBe(initial.local.session);
    const switched = click(rejected, 0);
    expect(switched.selectedSquare).toBe(0);
    expect(switched.local.error).toBeNull();
    expect(switched.local.session).toBe(initial.local.session);
    const accepted = click(switched, 1);
    expect(accepted.local.error).toBeNull();
    expect(accepted.selectedSquare).toBeNull();
  });

  it.each([2, 4])('flips hidden square %i directly while another piece is selected', position => {
    const firstTwo = click(click(start(), 0), 1);
    const selected = click(freeze(firstTwo), 0);
    const flipped = click(freeze(selected), position);
    expect(flipped.local.error).toBeNull();
    expect(flipped.selectedSquare).toBeNull();
    expect(flipped.local.session?.currentState.board[position]?.revealed).toBe(true);
    expect(flipped.local.session?.currentState.currentPlayer).toBe('P2');
    expect(flipped.local.session?.currentState.playerColors).toEqual({ P1: 'RED', P2: 'BLACK' });
    expect(flipped.local.session?.currentState.board[0]).toEqual(firstTwo.local.session?.currentState.board[0]);
    expect(flipped.local.session?.currentState.plyCount).toBe(3);
    expect(flipped.local.session?.actions).toHaveLength(3);
    expect(flipped.local.session?.actions.at(-1)).toEqual({ playerId: 'P1', action: { type: 'FLIP', position } });
    expect(firstTwo.local.session?.currentState.board[position]?.revealed).toBe(false);
    expect(firstTwo.local.session?.actions).toHaveLength(2);
    expect(selected.selectedSquare).toBe(0);
  });

  it('clears prior rejection feedback when flipping a hidden piece from a selection', () => {
    const firstTwo = click(click(start(), 0), 1);
    const selected = click(firstTwo, 0);
    const rejected = click(freeze(selected), 32);
    expect(rejected.local.error?.code).toBe('INVALID_DESTINATION');
    expect(rejected.selectedSquare).toBe(0);
    const flipped = click(freeze(rejected), 4);
    expect(flipped.local.error).toBeNull();
    expect(flipped.selectedSquare).toBeNull();
    expect(flipped.local.session?.currentState.currentPlayer).toBe('P2');
    expect(flipped.local.session?.actions).toHaveLength(3);
    expect(flipped.local.session?.actions.at(-1)).toEqual({ playerId: 'P1', action: { type: 'FLIP', position: 4 } });
  });

  it('does not act on an empty square without a selected source', () => {
    const captured = click(click(revealedBoard(), 0), 1);
    const clickedEmpty = click(freeze(captured), 0);
    expect(clickedEmpty.selectedSquare).toBeNull();
    expect(clickedEmpty.local.error?.code).toBe('INVALID_SOURCE');
    expect(clickedEmpty.local.session).toBe(captured.local.session);
  });

  it('reveals only the newly flipped piece and keeps other hidden identities redacted', () => {
    const firstTwo = click(click(start(), 0), 1);
    const flipped = click(click(freeze(firstTwo), 0), 2);
    const observation = getObservation(flipped.local.session!.currentState);
    expect(observation.board[0]).toEqual({ kind: 'REVEALED', piece: { color: 'RED', rank: 'CHARIOT' } });
    expect(observation.board[2]).toEqual({ kind: 'REVEALED', piece: { color: 'RED', rank: 'HORSE' } });
    expect(observation.board.slice(3)).toEqual(Array.from({ length: 29 }, () => ({ kind: 'HIDDEN' })));
    expect(JSON.stringify(observation)).not.toContain('RED-CHARIOT-');
    expect(JSON.stringify(observation)).not.toContain('RED-HORSE-');
    expect(observation).not.toHaveProperty('selectedSquare');
    expect(flipped.local.session).not.toHaveProperty('selectedSquare');
  });

  it('rejects invalid positions through the core without losing selection', () => {
    const selected = click(freeze(revealedBoard()), 0);
    const rejected = click(selected, 32);
    expect(rejected.local.error?.code).toBe('INVALID_DESTINATION');
    expect(rejected.selectedSquare).toBe(0);
    expect(rejected.local.session).toBe(selected.local.session);
  });

  it('cannot select or submit a successful action in a finished session', () => {
    const initial = revealedBoard();
    const finished: BoardUiState = {
      ...initial,
      local: {
        ...initial.local,
        session: {
          ...initial.local.session!,
          currentState: { ...initial.local.session!.currentState, status: 'FINISHED', result: { type: 'DRAW', reason: 'NO_PROGRESS' } },
        },
      },
    };
    const rejected = click(freeze(finished), 0);
    expect(rejected.selectedSquare).toBeNull();
    expect(rejected.local.error?.code).toBe('GAME_FINISHED');
    expect(rejected.local.session).toBe(finished.local.session);
  });
});
