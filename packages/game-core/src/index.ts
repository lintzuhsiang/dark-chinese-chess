import type {
  ActionResult, GameAction, GameResult, GameState, InitialStateResult,
  Piece, PieceColor, PieceRank, PlayerId, PlayerObservation, PublicPiece,
} from './types';

export type * from './types';

// Shared domain data: the session builds a deck; the core independently validates it.
export const PIECE_DISTRIBUTION: Readonly<Record<PieceRank, number>> = Object.freeze({
  GENERAL: 1, ADVISOR: 2, ELEPHANT: 2, CHARIOT: 2,
  HORSE: 2, CANNON: 2, SOLDIER: 5,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPiece(value: unknown): value is Piece {
  return isRecord(value)
    && typeof value.id === 'string' && value.id.trim().length > 0
    && (value.color === 'RED' || value.color === 'BLACK')
    && typeof value.rank === 'string' && Object.hasOwn(PIECE_DISTRIBUTION, value.rank);
}

function isValidDeck(deck: readonly Piece[]): boolean {
  if (!Array.isArray(deck) || deck.length !== 32) return false;
  const ids = new Set<string>();
  const counts: Record<PieceColor, Map<PieceRank, number>> = {
    RED: new Map(), BLACK: new Map(),
  };
  for (const piece of deck) {
    if (!isPiece(piece) || ids.has(piece.id)) return false;
    ids.add(piece.id);
    const colorCounts = counts[piece.color];
    colorCounts.set(piece.rank, (colorCounts.get(piece.rank) ?? 0) + 1);
  }
  return (['RED', 'BLACK'] as const).every(color =>
    Object.entries(PIECE_DISTRIBUTION).every(([rank, count]) =>
      counts[color].get(rank as PieceRank) === count));
}

export function createInitialState(deck: readonly Piece[]): InitialStateResult {
  if (!isValidDeck(deck)) return { ok: false, error: { code: 'INVALID_DECK' } };
  return {
    ok: true,
    state: {
      board: deck.map(({ id, color, rank }) => ({ piece: { id, color, rank }, revealed: false })),
      currentPlayer: 'P1',
      playerColors: { P1: null, P2: null },
      status: 'ACTIVE',
      result: null,
      plyCount: 0,
      noProgressCount: 0,
    },
  };
}

function publicPiece({ color, rank }: Piece): PublicPiece {
  return { color, rank };
}

export function applyAction(state: GameState, playerId: PlayerId, action: GameAction): ActionResult {
  if (state.status === 'FINISHED') return { ok: false, error: { code: 'GAME_FINISHED' } };
  if (playerId !== state.currentPlayer) return { ok: false, error: { code: 'NOT_YOUR_TURN' } };
  if (!isRecord(action)) return { ok: false, error: { code: 'INVALID_ACTION' } };
  // MOVE is part of the approved contract, but its behavior belongs to Task 2.
  if (action.type === 'MOVE') return { ok: false, error: { code: 'ILLEGAL_MOVE' } };
  if (action.type !== 'FLIP') return { ok: false, error: { code: 'INVALID_ACTION' } };
  const position = action.position;
  if (!Number.isInteger(position) || position < 0 || position >= 32) {
    return { ok: false, error: { code: 'INVALID_DESTINATION' } };
  }
  const square = state.board[position];
  if (!square || square.revealed) return { ok: false, error: { code: 'INVALID_FLIP' } };

  const board = [...state.board];
  board[position] = { piece: square.piece, revealed: true };
  const colors = state.playerColors.P1 === null
    ? { P1: square.piece.color, P2: square.piece.color === 'RED' ? 'BLACK' as const : 'RED' as const }
    : state.playerColors;
  const nextState: GameState = {
    ...state,
    board,
    playerColors: colors,
    currentPlayer: playerId === 'P1' ? 'P2' : 'P1',
    plyCount: state.plyCount + 1,
    noProgressCount: 0,
  };
  return {
    ok: true,
    state: nextState,
    event: { ply: nextState.plyCount, playerId, type: 'FLIP', position, piece: publicPiece(square.piece) },
  };
}

export function getGameResult(state: GameState): GameResult | null {
  return state.result === null ? null : { ...state.result };
}

export function getObservation(state: GameState): PlayerObservation {
  return {
    board: state.board.map(square => {
      if (square === null) return { kind: 'EMPTY' };
      return square.revealed
        ? { kind: 'REVEALED', piece: publicPiece(square.piece) }
        : { kind: 'HIDDEN' };
    }),
    currentPlayer: state.currentPlayer,
    playerColors: { ...state.playerColors },
    status: state.status,
    result: getGameResult(state),
  };
}
