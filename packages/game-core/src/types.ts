export type PlayerId = 'P1' | 'P2';
export type PieceColor = 'RED' | 'BLACK';
export type PieceRank =
  | 'GENERAL' | 'ADVISOR' | 'ELEPHANT' | 'CHARIOT'
  | 'HORSE' | 'CANNON' | 'SOLDIER';

export interface Piece {
  readonly id: string;
  readonly color: PieceColor;
  readonly rank: PieceRank;
}

export interface OccupiedSquare {
  readonly piece: Piece;
  readonly revealed: boolean;
}

export type Square = OccupiedSquare | null;
export type Board = readonly Square[];
export type PlayerColors = Readonly<Record<PlayerId, PieceColor | null>>;

export type GameAction =
  | { readonly type: 'FLIP'; readonly position: number }
  | { readonly type: 'MOVE'; readonly from: number; readonly to: number };

export type GameResult =
  | { readonly type: 'WIN'; readonly winner: PlayerId; readonly reason: 'NO_PIECES' | 'NO_LEGAL_ACTION' }
  | { readonly type: 'DRAW'; readonly reason: 'NO_PROGRESS' };

// Authoritative rule state only; never included in PlayerObservation or events.
export interface ChaseState {
  readonly attackerPlayer: PlayerId;
  readonly attackerId: string;
  readonly targetId: string;
  readonly phase: 'ESCAPE' | 'RENEW';
  // Qualified threat-position appearances within this continuous chase only.
  readonly positionCounts: Readonly<Record<string, number>>;
}

export interface GameState {
  readonly board: Board;
  readonly currentPlayer: PlayerId;
  readonly playerColors: PlayerColors;
  readonly status: 'ACTIVE' | 'FINISHED';
  readonly result: GameResult | null;
  readonly plyCount: number;
  readonly noProgressCount: number;
  readonly chase: ChaseState | null;
}

export type PublicPiece = Readonly<Pick<Piece, 'color' | 'rank'>>;
export type PublicSquare =
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'HIDDEN' }
  | { readonly kind: 'REVEALED'; readonly piece: PublicPiece };

export interface PlayerObservation {
  readonly board: readonly PublicSquare[];
  readonly currentPlayer: PlayerId;
  readonly playerColors: PlayerColors;
  readonly status: 'ACTIVE' | 'FINISHED';
  readonly result: GameResult | null;
}

export type ActionEvent =
  | {
      readonly ply: number;
      readonly playerId: PlayerId;
      readonly type: 'FLIP';
      readonly position: number;
      readonly piece: PublicPiece;
    }
  | {
      readonly ply: number;
      readonly playerId: PlayerId;
      readonly type: 'MOVE';
      readonly from: number;
      readonly to: number;
      readonly piece: PublicPiece;
      readonly captured: PublicPiece | null;
    };

export interface ActionError {
  readonly code: 'NOT_YOUR_TURN' | 'INVALID_SOURCE' | 'INVALID_DESTINATION'
    | 'ILLEGAL_MOVE' | 'INVALID_FLIP' | 'INVALID_ACTION' | 'GAME_FINISHED' | 'PERPETUAL_CHASE';
}

export type ActionResult =
  | { readonly ok: true; readonly state: GameState; readonly event: ActionEvent }
  | { readonly ok: false; readonly error: ActionError };

export type InitialStateResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly error: { readonly code: 'INVALID_DECK' } };
