import { PIECE_DISTRIBUTION } from '@dark-chess/game-core';
import type { Piece, PieceRank } from '@dark-chess/game-core';

// Called by the start command, never by a reducer, render, or core transition.
export function createShuffledDeck(random: () => number = Math.random): Piece[] {
  const deck: Piece[] = [];
  for (const color of ['RED', 'BLACK'] as const) {
    for (const [rank, count] of Object.entries(PIECE_DISTRIBUTION)) {
      for (let index = 0; index < count; index += 1) {
        deck.push({ id: `${color}-${rank}-${index}`, color, rank: rank as PieceRank });
      }
    }
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError('Random source must return a finite value in [0, 1).');
    }
    const other = Math.floor(sample * (index + 1));
    [deck[index], deck[other]] = [deck[other]!, deck[index]!];
  }
  return deck;
}
