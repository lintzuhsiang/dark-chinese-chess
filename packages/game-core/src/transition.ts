import type { ActionEvent, GameAction, PlayerColors, PlayerId, PublicPiece } from './types';

// Shared action metadata: both private transitions and public branches use this.
export function actionMetadata(
  before: {
    readonly currentPlayer: PlayerId;
    readonly playerColors: PlayerColors;
    readonly plyCount: number;
    readonly noProgressCount: number;
  },
  action: GameAction,
  piece: PublicPiece,
  captured: PublicPiece | null,
) {
  const playerColors: PlayerColors =
    action.type === 'FLIP' && before.playerColors.P1 === null
      ? { P1: piece.color, P2: piece.color === 'RED' ? 'BLACK' : 'RED' }
      : { ...before.playerColors };
  const plyCount = before.plyCount + 1;
  const event: ActionEvent =
    action.type === 'FLIP'
      ? {
          type: 'FLIP',
          ply: plyCount,
          playerId: before.currentPlayer,
          position: action.position,
          piece: { color: piece.color, rank: piece.rank },
        }
      : {
          type: 'MOVE',
          ply: plyCount,
          playerId: before.currentPlayer,
          from: action.from,
          to: action.to,
          piece: { color: piece.color, rank: piece.rank },
          captured: captured === null ? null : { color: captured.color, rank: captured.rank },
        };
  return {
    currentPlayer: before.currentPlayer === 'P1' ? ('P2' as const) : ('P1' as const),
    playerColors,
    plyCount,
    noProgressCount: action.type === 'MOVE' && captured === null ? before.noProgressCount + 1 : 0,
    event,
  };
}
