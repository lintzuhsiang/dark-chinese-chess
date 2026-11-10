import { createInitialState, PIECE_DISTRIBUTION } from '../src/index';
import type { GameState, Piece, PieceRank } from '../src/index';

// Frozen fixture algorithm: LCG32 Fisher-Yates, then independent occupancy/reveal masks.
export function publicMoveFixture(seed: number): GameState {
  let value = seed >>> 0;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
  const deck: Piece[] = [];
  for (const color of ['RED', 'BLACK'] as const) {
    for (const [rank, count] of Object.entries(PIECE_DISTRIBUTION)) {
      for (let index = 0; index < count; index += 1) {
        deck.push({ id: color + '-' + rank + '-' + index, color, rank: rank as PieceRank });
      }
    }
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [deck[index], deck[other]] = [deck[other]!, deck[index]!];
  }
  const initialized = createInitialState(deck);
  if (!initialized.ok) throw new Error('Invalid fixture deck.');
  return {
    ...initialized.state,
    playerColors: { P1: 'RED', P2: 'BLACK' },
    board: initialized.state.board.map((square) => {
      const occupied = random() >= 0.2;
      const revealed = random() >= 0.25;
      return occupied ? { ...square!, revealed } : null;
    }),
  };
}
