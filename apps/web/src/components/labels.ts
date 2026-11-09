import type { PublicPiece } from '@dark-chess/game-core';

const glyphs = {
  RED: { GENERAL: '帥', ADVISOR: '仕', ELEPHANT: '相', CHARIOT: '俥', HORSE: '傌', CANNON: '炮', SOLDIER: '兵' },
  BLACK: { GENERAL: '將', ADVISOR: '士', ELEPHANT: '象', CHARIOT: '車', HORSE: '馬', CANNON: '包', SOLDIER: '卒' },
} as const;

export const pieceGlyph = (piece: PublicPiece) => glyphs[piece.color][piece.rank];
export const pieceLabel = (piece: PublicPiece) => `${piece.color === 'RED' ? '紅方' : '黑方'}${pieceGlyph(piece)}`;
export const coordinateLabel = (position: number) => `第 ${Math.floor(position / 4) + 1} 列，第 ${position % 4 + 1} 欄`;
