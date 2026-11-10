import type { ActionError, Board, GameAction, GameState, PieceRank, PlayerId } from './types';

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

function hasOneScreen(board: Board, from: number, to: number): boolean {
  const sameRow = Math.floor(from / 4) === Math.floor(to / 4);
  const sameColumn = from % 4 === to % 4;
  if (!sameRow && !sameColumn) return false;
  const step = (to > from ? 1 : -1) * (sameRow ? 1 : 4);
  let occupied = 0;
  for (let position = from + step; position !== to; position += step) {
    if (board[position] != null) occupied += 1;
  }
  return occupied === 1;
}

// Ordinary capture relationship, independent of turn, outcome, and chase policy.
export function isCaptureThreat(board: Board, from: number, to: number): boolean {
  if (!isPosition(from) || !isPosition(to) || from === to) return false;
  const source = board[from];
  const target = board[to];
  if (!source?.revealed || !target?.revealed || source.piece.color === target.piece.color)
    return false;
  return source.piece.rank === 'CANNON'
    ? hasOneScreen(board, from, to)
    : adjacent(from, to) && canCaptureRank(source.piece.rank, target.piece.rank);
}

// Ordinary validation, without chase policy. Outcomes use this same base path.
export function getActionError(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
): ActionError | null {
  if (state.status === 'FINISHED') return { code: 'GAME_FINISHED' };
  if (playerId !== state.currentPlayer) return { code: 'NOT_YOUR_TURN' };
  if (typeof action !== 'object' || action === null || Array.isArray(action))
    return { code: 'INVALID_ACTION' };

  if (action.type === 'FLIP') {
    if (!isPosition(action.position)) return { code: 'INVALID_DESTINATION' };
    const square = state.board[action.position];
    return !square || square.revealed ? { code: 'INVALID_FLIP' } : null;
  }
  if (action.type !== 'MOVE') return { code: 'INVALID_ACTION' };
  if (!isPosition(action.from)) return { code: 'INVALID_SOURCE' };
  if (!isPosition(action.to)) return { code: 'INVALID_DESTINATION' };
  const source = state.board[action.from];
  if (!source || !source.revealed || source.piece.color !== state.playerColors[playerId]) {
    return { code: 'INVALID_SOURCE' };
  }
  if (action.from === action.to) return { code: 'ILLEGAL_MOVE' };
  const target = state.board[action.to];
  if (target === undefined) return { code: 'INVALID_DESTINATION' };
  if (target === null) return adjacent(action.from, action.to) ? null : { code: 'ILLEGAL_MOVE' };
  if (!target.revealed || target.piece.color === source.piece.color)
    return { code: 'ILLEGAL_MOVE' };
  const legal = isCaptureThreat(state.board, action.from, action.to);
  return legal ? null : { code: 'ILLEGAL_MOVE' };
}
