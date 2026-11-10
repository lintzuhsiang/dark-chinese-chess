import type { GameState, Piece, PieceRank } from '../src/index';
import { createInitialState } from '../src/index';

// Independent fixture from the documented distribution, not the implementation constant.
export function makeDeck(): Piece[] {
  const ranks: readonly [PieceRank, number][] = [
    ['GENERAL', 1],
    ['ADVISOR', 2],
    ['ELEPHANT', 2],
    ['CHARIOT', 2],
    ['HORSE', 2],
    ['CANNON', 2],
    ['SOLDIER', 5],
  ];
  return (['RED', 'BLACK'] as const).flatMap((color) =>
    ranks.flatMap(([rank, count]) =>
      Array.from({ length: count }, (_, index) => ({
        id: `fixture-${color}-${rank}-${index}`,
        color,
        rank,
      })),
    ),
  );
}

export function initialState(deck = makeDeck()): GameState {
  const result = createInitialState(deck);
  if (!result.ok) throw new Error('Test fixture must be a valid deck.');
  return result.state;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
