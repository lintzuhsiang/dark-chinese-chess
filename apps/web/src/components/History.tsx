import { useRef } from 'react';
import type { ActionEvent, PublicPiece } from '@dark-chess/game-core';
import { coordinateLabel, pieceLabel } from './labels';

export function HistoryEventDetails({ event }: { readonly event: ActionEvent }) {
  return (
    <>
      <span className="history-actor">
        第 {event.ply} 手 · {event.playerId === 'P1' ? '玩家一' : '玩家二'}
      </span>
      <span className="history-description">
        {event.type === 'FLIP'
          ? `翻棋 · ${pieceLabel(event.piece)}`
          : `${event.captured ? '吃子' : '移動'} · ${pieceLabel(event.piece)}`}
      </span>
      <span className="history-coordinate">
        {event.type === 'FLIP'
          ? coordinateLabel(event.position)
          : `${coordinateLabel(event.from)} → ${coordinateLabel(event.to)}`}
      </span>
      {event.type === 'MOVE' && event.captured && (
        <span className="history-capture">吃掉{pieceLabel(event.captured)}</span>
      )}
    </>
  );
}

export function CapturedPieces({ captured }: { readonly captured: readonly PublicPiece[] }) {
  return (
    <div className="captured-pieces" aria-label="已被吃掉的棋子">
      {(['RED', 'BLACK'] as const).map((color) => (
        <p key={color}>
          {color === 'RED' ? '紅方' : '黑方'}被吃：
          {captured
            .filter((piece) => piece.color === color)
            .map(pieceLabel)
            .join('、') || '無'}
        </p>
      ))}
    </div>
  );
}

export function History({
  events,
  captured,
}: {
  readonly events: readonly ActionEvent[];
  readonly captured: readonly PublicPiece[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        tabIndex={0}
        className="game-button"
        onClick={() => dialog.current?.showModal()}
      >
        棋譜 · {events.length}
      </button>
      <dialog className="history-dialog" ref={dialog} aria-labelledby="history-title">
        <div className="history-heading">
          <h2 id="history-title">棋譜 · {events.length} 手</h2>
          <button
            type="button"
            tabIndex={0}
            className="game-button"
            onClick={() => dialog.current?.close()}
          >
            返回棋盤
          </button>
        </div>
        <CapturedPieces captured={captured} />
        {events.length === 0 ? (
          <p className="history-empty">尚無行動紀錄。</p>
        ) : (
          <ol className="history-list" aria-label="已接受的行動紀錄">
            {events.map((event) => (
              <li key={event.ply}>
                <HistoryEventDetails event={event} />
              </li>
            ))}
          </ol>
        )}
      </dialog>
    </>
  );
}
