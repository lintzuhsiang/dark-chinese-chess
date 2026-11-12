import {
  applyAction,
  type ActionEvent,
  type GameAction,
  type GameState,
  type Piece,
  type PieceColor,
  type PieceRank,
  type PlayerId,
  type PlayerColors,
  type Square,
} from '../src/index';
import { initialState, makeDeck } from './fixtures';
import { compilePosition } from './compile-position';

export interface ProjectionFixture {
  state: GameState;
  history: ActionEvent[];
  readonly initialDeck?: readonly Piece[];
}

export function accept(fixture: ProjectionFixture, action: GameAction): void {
  const accepted = applyAction(fixture.state, fixture.state.currentPlayer, action);
  if (!accepted.ok) throw new Error(`Invalid fixture action: ${accepted.error.code}`);
  fixture.state = accepted.state;
  fixture.history.push(accepted.event);
}

export function arrangedInitial(
  entries: readonly (readonly [number, PieceColor, PieceRank])[],
): ProjectionFixture {
  const deck = makeDeck();
  const fixed = new Map<number, (typeof deck)[number]>();
  for (const [position, color, rank] of entries) {
    const index = deck.findIndex((piece) => piece.color === color && piece.rank === rank);
    if (index < 0) throw new Error('Unavailable fixture piece.');
    fixed.set(position, deck.splice(index, 1)[0]!);
  }
  return {
    state: initialState(
      Array.from({ length: 32 }, (_, position) => fixed.get(position) ?? deck.shift()!),
    ),
    history: [],
  };
}

/** Tactical geometry with a real, cooperative, Core-replayed initial-deck setup. */
export function tacticalSnapshot(
  entries: readonly (readonly [number, PieceColor, PieceRank, boolean?])[],
  currentPlayer: PlayerId = 'P1',
  playerColors: PlayerColors = { P1: 'RED', P2: 'BLACK' },
): ProjectionFixture {
  const captured = makeDeck();
  const board: Square[] = Array.from({ length: 32 }, () => null);
  for (const [position, color, rank, revealed = true] of entries) {
    const index = captured.findIndex((piece) => piece.color === color && piece.rank === rank);
    if (index < 0) throw new Error('Unavailable fixture piece.');
    board[position] = { revealed, piece: captured.splice(index, 1)[0]! };
  }
  return compilePosition(board, captured, currentPlayer, playerColors);
}
