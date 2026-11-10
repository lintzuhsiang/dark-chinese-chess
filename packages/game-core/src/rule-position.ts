import type { Board, ChaseState, PlayerColors, PlayerId, PublicPiece, PublicSquare } from './types';

export type MovementBoard = Board | readonly PublicSquare[];

// Public references track continuity only; they never identify an engine piece.
export type ReferencedSquare =
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'HIDDEN' }
  | { readonly kind: 'REVEALED'; readonly piece: PublicPiece; readonly reference: string };

export interface RulePosition {
  readonly board: readonly ReferencedSquare[];
  readonly currentPlayer: PlayerId;
  readonly playerColors: PlayerColors;
  readonly status: 'ACTIVE' | 'FINISHED';
  readonly plyCount: number;
  readonly noProgressCount: number;
  readonly chase: ChaseState | null;
}

// Geometry sees only occupancy and revealed values on either representation.
export function readSquare(board: MovementBoard, position: number): PublicSquare | undefined {
  const square = board[position];
  if (square === undefined) return undefined;
  if (square === null) return { kind: 'EMPTY' };
  if ('kind' in square) return square;
  return square.revealed
    ? { kind: 'REVEALED', piece: { color: square.piece.color, rank: square.piece.rank } }
    : { kind: 'HIDDEN' };
}

export function readReference(board: MovementBoard, position: number): string | undefined {
  const square = board[position];
  if (square === undefined || square === null) return undefined;
  if (!('kind' in square)) return square.revealed ? square.piece.id : undefined;
  return square.kind === 'REVEALED' && 'reference' in square && typeof square.reference === 'string'
    ? square.reference
    : undefined;
}
