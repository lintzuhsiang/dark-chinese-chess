import type { PieceColor, PieceRank, PublicSquare } from '@dark-chess/game-core';

const glyphs: Readonly<Record<PieceColor, Record<PieceRank, string>>> = {
  RED: { GENERAL: '帥', ADVISOR: '仕', ELEPHANT: '相', CHARIOT: '俥', HORSE: '傌', CANNON: '炮', SOLDIER: '兵' },
  BLACK: { GENERAL: '將', ADVISOR: '士', ELEPHANT: '象', CHARIOT: '車', HORSE: '馬', CANNON: '包', SOLDIER: '卒' },
};

export function Board({ squares, selectedSquare = null, onSquareClick, disabled = false }: {
  readonly squares: readonly PublicSquare[];
  readonly selectedSquare?: number | null;
  readonly onSquareClick: (position: number) => void;
  readonly disabled?: boolean;
}) {
  return (
    <ol className="board" aria-label="暗棋棋盤，八列四欄">
      {squares.map((square, position) => {
        const coordinate = `第 ${Math.floor(position / 4) + 1} 列，第 ${position % 4 + 1} 欄`;
        const piece = square.kind === 'REVEALED' ? square.piece : null;
        const glyph = piece ? glyphs[piece.color][piece.rank] : '暗';
        const label = piece ? `${piece.color === 'RED' ? '紅方' : '黑方'}${glyph}`
          : square.kind === 'HIDDEN' ? '暗棋' : '空格';
        return (
          <li key={position}>
            <button
              className={`square ${piece ? `revealed ${piece.color.toLowerCase()}` : square.kind.toLowerCase()}${selectedSquare === position ? ' selected' : ''}`}
              type="button"
              aria-label={`${coordinate}，${label}`}
              aria-pressed={selectedSquare === position}
              onClick={() => onSquareClick(position)}
              disabled={disabled}
            >
              <span className="piece" aria-hidden="true">{square.kind === 'EMPTY' ? '' : glyph}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
