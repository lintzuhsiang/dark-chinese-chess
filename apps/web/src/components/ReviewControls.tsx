export function ReviewControls({
  cursor,
  total,
  onSeek,
  onExit,
}: {
  readonly cursor: number;
  readonly total: number;
  readonly onSeek: (cursor: number) => void;
  readonly onExit: () => void;
}) {
  return (
    <div className="review-controls" aria-label="覆盤操作">
      <div className="game-controls review-navigation">
        <button
          type="button"
          tabIndex={0}
          className="game-button"
          aria-label="回到開局"
          disabled={cursor === 0}
          onClick={() => onSeek(0)}
        >
          開局
        </button>
        <button
          type="button"
          tabIndex={0}
          className="game-button"
          aria-label="前一步"
          disabled={cursor === 0}
          onClick={() => onSeek(cursor - 1)}
        >
          上步
        </button>
        <button
          type="button"
          tabIndex={0}
          autoFocus={cursor < total}
          className="game-button"
          aria-label="下一步"
          disabled={cursor === total}
          onClick={() => onSeek(cursor + 1)}
        >
          下步
        </button>
        <button
          type="button"
          tabIndex={0}
          className="game-button"
          aria-label="最終局面"
          disabled={cursor === total}
          onClick={() => onSeek(total)}
        >
          終局
        </button>
      </div>
      <div className="game-controls">
        <button type="button" tabIndex={0} className="game-button" onClick={onExit}>
          結束覆盤
        </button>
      </div>
    </div>
  );
}
