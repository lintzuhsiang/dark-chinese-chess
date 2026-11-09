import type {
  ActionResult, GameAction, GameResult, GameState, InitialStateResult,
  Piece, PieceColor, PieceRank, PlayerId, PlayerObservation, PublicPiece,
} from './types';
import { evaluateOutcome } from './outcomes';
import { getChaseUpdate } from './chase';
import { getActionError } from './validation';

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
      chase: null,
    },
  };
}

function publicPiece({ color, rank }: Piece): PublicPiece {
  return { color, rank };
}

// This helper is called only after ordinary action validation.
function transitionAction(
  state: GameState, playerId: PlayerId, action: GameAction,
): Extract<ActionResult, { readonly ok: true }> {
  if (action.type === 'MOVE') {
    const source = state.board[action.from]!;
    const target = state.board[action.to];
    const board = [...state.board];
    board[action.from] = null;
    board[action.to] = source;
    const nextState: GameState = {
      ...state,
      board,
      currentPlayer: playerId === 'P1' ? 'P2' : 'P1',
      plyCount: state.plyCount + 1,
      noProgressCount: target === null ? state.noProgressCount + 1 : 0,
    };
    return {
      ok: true,
      state: nextState,
      event: {
        ply: nextState.plyCount, playerId, type: 'MOVE', from: action.from, to: action.to,
        piece: publicPiece(source.piece), captured: target ? publicPiece(target.piece) : null,
      },
    };
  }
  const position = action.position;
  const square = state.board[position]!;
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

// Submission and enumeration share both ordinary validation and chase screening.
function permittedTransition(state: GameState, playerId: PlayerId, action: GameAction): ActionResult {
  const error = getActionError(state, playerId, action);
  if (error !== null) return { ok: false, error };
  const result = transitionAction(state, playerId, action);
  const update = getChaseUpdate(state, result.state, action);
  if (update.prohibited) return { ok: false, error: { code: 'PERPETUAL_CHASE' } };
  return { ...result, state: { ...result.state, chase: update.chase } };
}

export function applyAction(state: GameState, playerId: PlayerId, action: GameAction): ActionResult {
  const result = permittedTransition(state, playerId, action);
  if (!result.ok) return result;
  const outcome = evaluateOutcome(result.state);
  return {
    ...result,
    state: { ...result.state, status: outcome === null ? 'ACTIVE' : 'FINISHED', result: outcome },
  };
}

export function getLegalActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.status === 'FINISHED' || playerId !== state.currentPlayer) return [];
  const actions: GameAction[] = [];
  for (let position = 0; position < 32; position += 1) {
    const flip: GameAction = { type: 'FLIP', position };
    if (permittedTransition(state, playerId, flip).ok) actions.push(flip);
    for (let to = 0; to < 32; to += 1) {
      const move: GameAction = { type: 'MOVE', from: position, to };
      if (permittedTransition(state, playerId, move).ok) actions.push(move);
    }
  }
  return actions;
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
