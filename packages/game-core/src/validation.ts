import type {
  ActionError,
  GameAction,
  PieceColor,
  PieceRank,
  PlayerId,
  PlayerColors,
  PublicSquare,
} from './types';
import { readSquare, type MovementBoard } from './rule-position';

const CAPTURE_STRENGTH: Readonly<Record<PieceRank, number>> = Object.freeze({
  GENERAL: 6,
  ADVISOR: 5,
  ELEPHANT: 4,
  CHARIOT: 3,
  HORSE: 2,
  CANNON: 1,
  SOLDIER: 0,
});

function isPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 32;
}

function adjacent(from: number, to: number): boolean {
  return (
    Math.abs(Math.floor(from / 4) - Math.floor(to / 4)) + Math.abs((from % 4) - (to % 4)) === 1
  );
}

function canCaptureRank(attacker: PieceRank, target: PieceRank): boolean {
  if (attacker === 'SOLDIER') return target === 'GENERAL' || target === 'SOLDIER';
  if (attacker === 'GENERAL' && target === 'SOLDIER') return false;
  return CAPTURE_STRENGTH[attacker] >= CAPTURE_STRENGTH[target];
}

function hasOneScreen(board: MovementBoard, from: number, to: number): boolean {
  const sameRow = Math.floor(from / 4) === Math.floor(to / 4);
  const sameColumn = from % 4 === to % 4;
  if (!sameRow && !sameColumn) return false;
  const step = (to > from ? 1 : -1) * (sameRow ? 1 : 4);
  let occupied = 0;
  for (let position = from + step; position !== to; position += step) {
    const square = readSquare(board, position);
    if (square !== undefined && square.kind !== 'EMPTY') occupied += 1;
  }
  return occupied === 1;
}

// Ordinary capture relationship, independent of turn, outcome, and chase policy.
function captureThreat(board: MovementBoard, from: number, to: number): boolean {
  if (!isPosition(from) || !isPosition(to) || from === to) return false;
  const source = readSquare(board, from);
  const target = readSquare(board, to);
  if (
    source?.kind !== 'REVEALED' ||
    target?.kind !== 'REVEALED' ||
    source.piece.color === target.piece.color
  )
    return false;
  return source.piece.rank === 'CANNON'
    ? hasOneScreen(board, from, to)
    : adjacent(from, to) && canCaptureRank(source.piece.rank, target.piece.rank);
}

export function isCaptureThreat(board: MovementBoard, from: number, to: number): boolean {
  return captureThreat(board, from, to);
}

function ordinaryMove(board: MovementBoard, from: number, to: number): boolean {
  if (!isPosition(from) || !isPosition(to) || from === to) return false;
  if (readSquare(board, from)?.kind !== 'REVEALED') return false;
  return readSquare(board, to)?.kind === 'EMPTY'
    ? adjacent(from, to)
    : captureThreat(board, from, to);
}

// Structural movement only: deliberately excludes FLIPs, turn, chase, and outcomes.
export function getPublicOrdinaryMoves(
  board: readonly PublicSquare[],
  color: PieceColor,
): readonly Extract<GameAction, { readonly type: 'MOVE' }>[] {
  if (board.length !== 32 || (color !== 'RED' && color !== 'BLACK')) {
    throw new RangeError('Public movement requires 32 squares and a valid color.');
  }
  const moves: Extract<GameAction, { readonly type: 'MOVE' }>[] = [];
  for (let from = 0; from < 32; from += 1) {
    const source = readSquare(board, from);
    if (source?.kind !== 'REVEALED' || source.piece.color !== color) continue;
    for (let to = 0; to < 32; to += 1) {
      if (ordinaryMove(board, from, to)) moves.push({ type: 'MOVE', from, to });
    }
  }
  return moves;
}

// Ordinary validation, without chase policy. Outcomes use this same base path.
export function getActionError<
  State extends {
    readonly board: MovementBoard;
    readonly currentPlayer: PlayerId;
    readonly playerColors: PlayerColors;
    readonly status: 'ACTIVE' | 'FINISHED';
  },
>(state: State, playerId: PlayerId, action: GameAction): ActionError | null {
  if (state.status === 'FINISHED') return { code: 'GAME_FINISHED' };
  if (playerId !== state.currentPlayer) return { code: 'NOT_YOUR_TURN' };
  if (typeof action !== 'object' || action === null || Array.isArray(action))
    return { code: 'INVALID_ACTION' };

  if (action.type === 'FLIP') {
    if (!isPosition(action.position)) return { code: 'INVALID_DESTINATION' };
    return readSquare(state.board, action.position)?.kind === 'HIDDEN'
      ? null
      : { code: 'INVALID_FLIP' };
  }
  if (action.type !== 'MOVE') return { code: 'INVALID_ACTION' };
  if (!isPosition(action.from)) return { code: 'INVALID_SOURCE' };
  if (!isPosition(action.to)) return { code: 'INVALID_DESTINATION' };
  const source = readSquare(state.board, action.from);
  if (source?.kind !== 'REVEALED' || source.piece.color !== state.playerColors[playerId]) {
    return { code: 'INVALID_SOURCE' };
  }
  if (action.from === action.to) return { code: 'ILLEGAL_MOVE' };
  const target = state.board[action.to];
  if (target === undefined) return { code: 'INVALID_DESTINATION' };
  const legal = ordinaryMove(state.board, action.from, action.to);
  return legal ? null : { code: 'ILLEGAL_MOVE' };
}
