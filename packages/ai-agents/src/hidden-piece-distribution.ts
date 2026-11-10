import { PIECE_DISTRIBUTION, type PieceRank, type PublicPiece } from '../../game-core/src/index';
import type { PositionEvaluationInput } from './heuristic-evaluation';

export interface HiddenPieceOutcome {
  readonly piece: PublicPiece;
  readonly count: number;
  readonly probability: number;
}

export interface HiddenPieceDistribution {
  readonly totalHidden: number;
  readonly outcomes: readonly HiddenPieceOutcome[];
}

/**
 * Marginal distribution at any hidden square under uniform shuffling, without
 * remembered undone disclosures. Historical FLIPs are not subtracted: their
 * pieces are already accounted for by current reveals or accepted captures.
 */
export function getHiddenPieceDistribution({
  observation,
  publicHistory,
}: Pick<PositionEvaluationInput, 'observation' | 'publicHistory'>): HiddenPieceDistribution {
  if (observation.board.length !== 32) {
    throw new RangeError('Public board must contain exactly 32 squares.');
  }
  const counts = { RED: { ...PIECE_DISTRIBUTION }, BLACK: { ...PIECE_DISTRIBUTION } };
  const subtract = ({ color, rank }: PublicPiece): void => {
    counts[color][rank] -= 1;
    if (counts[color][rank] < 0) {
      throw new RangeError('Public pieces exceed the initial piece distribution.');
    }
  };
  for (const event of publicHistory) {
    if (event.type === 'MOVE' && event.captured !== null) subtract(event.captured);
  }
  let totalHidden = 0;
  for (const square of observation.board) {
    if (square.kind === 'REVEALED') subtract(square.piece);
    else if (square.kind === 'HIDDEN') totalHidden += 1;
  }
  const ranks = Object.keys(PIECE_DISTRIBUTION) as PieceRank[];
  const remainingCount = (['RED', 'BLACK'] as const).reduce(
    (total, color) => total + ranks.reduce((sum, rank) => sum + counts[color][rank], 0),
    0,
  );
  if (remainingCount !== totalHidden) {
    throw new RangeError('Public inventory does not conserve the hidden-square count.');
  }
  const outcomes: HiddenPieceOutcome[] = [];
  for (const color of ['RED', 'BLACK'] as const) {
    for (const rank of ranks) {
      const count = counts[color][rank];
      if (count > 0)
        outcomes.push({ piece: { color, rank }, count, probability: count / totalHidden });
    }
  }
  // With no hidden squares, all counts are zero and the result is empty (no 0/0).
  return { totalHidden, outcomes };
}
