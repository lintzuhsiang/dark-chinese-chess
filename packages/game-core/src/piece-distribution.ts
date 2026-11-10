import type { PieceRank } from './types';

// Shared domain data: the session builds a deck; Core independently validates it.
export const PIECE_DISTRIBUTION: Readonly<Record<PieceRank, number>> = Object.freeze({
  GENERAL: 1,
  ADVISOR: 2,
  ELEPHANT: 2,
  CHARIOT: 2,
  HORSE: 2,
  CANNON: 2,
  SOLDIER: 5,
});
