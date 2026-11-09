import type { PublicSquare } from '@dark-chess/game-core';
import { coordinateLabel, pieceGlyph, pieceLabel } from './labels';

export function Board({ squares, selectedSquare = null, onSquareClick, disabled = false }: {
  readonly squares: readonly PublicSquare[];
  readonly selectedSquare?: number | null;
  readonly onSquareClick: (position: number) => void;
  readonly disabled?: boolean;
}) {
  return (
    <ol className="board" aria-label="暗棋棋盤，八列四欄">
      {squares.map((square, position) => {
        const coordinate = coordinateLabel(position);
        const piece = square.kind === 'REVEALED' ? square.piece : null;
        const glyph = piece ? pieceGlyph(piece) : '暗';
        const label = piece ? pieceLabel(piece)
          : square.kind === 'HIDDEN' ? '暗棋' : '空格';
        return (
          <li key={position}>
            <button
              className={`square ${piece ? `revealed ${piece.color.toLowerCase()}` : square.kind.toLowerCase()}${selectedSquare === position ? ' selected' : ''}`}
              type="button"
              tabIndex={0}
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
