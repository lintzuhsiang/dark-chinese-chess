import { useEffect, useRef } from 'react';
import type { ActionEvent, PublicPiece } from '@dark-chess/game-core';
import { CapturedPieces, HistoryEventDetails } from './History';

export function ReviewHistory({
  events,
  captured,
  cursor,
  onSeek,
}: {
  readonly events: readonly ActionEvent[];
  readonly captured: readonly PublicPiece[];
  readonly cursor: number;
  readonly onSeek: (cursor: number) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const container = list.current;
    const selected = container?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!container || !selected) return;
    // Scroll only the list, preserving the board/page position on small screens.
    const bounds = container.getBoundingClientRect();
    const row = selected.getBoundingClientRect();
    if (row.top < bounds.top) container.scrollTop += row.top - bounds.top;
    else if (row.bottom > bounds.bottom) container.scrollTop += row.bottom - bounds.bottom;
  }, [cursor]);

  return (
    <aside className="review-history" aria-labelledby="review-history-title">
      <h2 id="review-history-title">棋譜 · {events.length} 手</h2>
      <p className="review-history-help">點選任一步，檢視該步之後的局面。</p>
      <p className="review-history-position">目前局面 · 第 {cursor} 手</p>
      <CapturedPieces captured={captured} />
      <ol ref={list} className="history-list review-history-list" aria-label="完整對局紀錄">
        <li>
          <button
            type="button"
            tabIndex={0}
            className="review-step"
            aria-label="檢視開局"
            aria-current={cursor === 0 ? 'step' : undefined}
            onClick={() => onSeek(0)}
          >
            開局 · 尚未翻棋
          </button>
        </li>
        {events.map((event) => (
          <li key={event.ply}>
            <button
              type="button"
              tabIndex={0}
              className="review-step"
              aria-label={`檢視第 ${event.ply} 手`}
              aria-current={cursor === event.ply ? 'step' : undefined}
              onClick={() => onSeek(event.ply)}
            >
              <HistoryEventDetails event={event} />
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
