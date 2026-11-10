import {
  applyAction,
  type ActionEvent,
  type GameAction,
  type GameState,
  type PieceColor,
  type PieceRank,
  type PlayerId,
  type Square,
} from '../src/index';
import { initialState, makeDeck } from './fixtures';

export interface ProjectionFixture {
  state: GameState;
  history: ActionEvent[];
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

/**
 * Unit-test tactical snapshot and synthetic capture ledger, not an initial-deck
 * replay fixture. Inventory, turn, and counters match the snapshot. Subsequent
 * actions/suffix are actual Core-accepted events. Real complete prefixes are
 * tested separately via arrangedInitial and deterministic complete games.
 */
export function tacticalSnapshot(
  entries: readonly (readonly [number, PieceColor, PieceRank, boolean?])[],
  currentPlayer: PlayerId = 'P1',
): ProjectionFixture {
  const captured = makeDeck();
  const board: Square[] = Array.from({ length: 32 }, () => null);
  for (const [position, color, rank, revealed = true] of entries) {
    const index = captured.findIndex((piece) => piece.color === color && piece.rank === rank);
    if (index < 0) throw new Error('Unavailable fixture piece.');
    board[position] = { revealed, piece: captured.splice(index, 1)[0]! };
  }
  const history: ActionEvent[] = captured.map((piece, index) => ({
    type: 'MOVE',
    ply: index + 1,
    playerId: index % 2 === 0 ? 'P1' : 'P2',
    from: 0,
    to: 1,
    piece: { color: piece.color === 'RED' ? 'BLACK' : 'RED', rank: 'CANNON' },
    captured: { color: piece.color, rank: piece.rank },
  }));
  if ((history.length % 2 === 0 ? 'P1' : 'P2') !== currentPlayer) {
    history.unshift({
      type: 'FLIP',
      ply: 1,
      playerId: 'P1',
      position: 0,
      piece: { color: 'RED', rank: 'GENERAL' },
    });
    for (let index = 0; index < history.length; index += 1) {
      history[index] = {
        ...history[index]!,
        ply: index + 1,
        playerId: index % 2 === 0 ? 'P1' : 'P2',
      };
    }
  }
  return {
    state: {
      ...initialState(),
      board,
      currentPlayer,
      playerColors: { P1: 'RED', P2: 'BLACK' },
      plyCount: history.length,
    },
    history,
  };
}
