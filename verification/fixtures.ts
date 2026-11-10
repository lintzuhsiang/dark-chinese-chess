import type { GameAction, Piece, PieceColor, PieceRank } from '../packages/game-core/src/types';
import { createShuffledDeck } from '../apps/web/src/game/deck';

// Verification inputs only. Nothing in the application imports this module.
export function fixtureDeck(
  fixed: readonly (readonly [number, PieceColor, PieceRank])[] = [],
): Piece[] {
  const remaining = createShuffledDeck(() => 1 - Number.EPSILON);
  const placed = new Map<number, Piece>();
  for (const [position, color, rank] of fixed) {
    const index = remaining.findIndex((piece) => piece.color === color && piece.rank === rank);
    if (index < 0) throw new Error('Missing verification piece.');
    placed.set(position, remaining.splice(index, 1)[0]!);
  }
  return Array.from({ length: 32 }, (_, position) => placed.get(position) ?? remaining.shift()!);
}

export const pairDeck = (rank: 'HORSE' | 'CHARIOT' = 'HORSE') =>
  fixtureDeck([
    [0, 'RED', rank],
    [1, 'BLACK', 'SOLDIER'],
    [4, 'RED', 'SOLDIER'],
    [5, 'BLACK', 'HORSE'],
  ]);
export const flip = (position: number): GameAction => ({ type: 'FLIP', position });
export const move = (from: number, to: number): GameAction => ({ type: 'MOVE', from, to });
export const opening = [flip(0), flip(1), flip(4), flip(5), move(0, 1), move(5, 4), move(1, 0)];
export const cycle = [move(4, 5), move(0, 1), move(5, 4), move(1, 0)];
export const shortFixture = {
  deck: pairDeck(),
  active: opening,
  completed: [...opening, ...Array.from({ length: 59 }, (_, index) => cycle[index % 4]!)],
};
const longActive = [...opening];
for (let block = 0; block < 10; block += 1) {
  longActive.push(
    ...Array.from({ length: 52 }, (_, index) => cycle[index % 4]!),
    flip(8 + block * 2),
    flip(9 + block * 2),
  );
}
export const longFixture = {
  deck: pairDeck(),
  active: longActive,
  completed: [...longActive, ...Array.from({ length: 60 }, (_, index) => cycle[index % 4]!)],
};

export function shuffleSamples(deck: readonly Piece[]): number[] {
  const ordered = fixtureDeck();
  const samples: number[] = [];
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    const other = ordered.findIndex((piece) => piece.id === deck[index]!.id);
    if (other < 0 || other > index) throw new Error('Invalid verification permutation.');
    samples.push((other + 0.5) / (index + 1));
    [ordered[index], ordered[other]] = [ordered[other]!, ordered[index]!];
  }
  return samples;
}
