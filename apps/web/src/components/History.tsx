import { useRef } from 'react';
import type { ActionEvent, PublicPiece } from '@dark-chess/game-core';
import { coordinateLabel, pieceLabel } from './labels';

export function History({ events, captured }: {
  readonly events: readonly ActionEvent[];
  readonly captured: readonly PublicPiece[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="game-button" onClick={() => dialog.current?.showModal()}>棋譜 · {events.length}</button>
      <dialog className="history-dialog" ref={dialog} aria-labelledby="history-title">
        <div className="history-heading">
          <h2 id="history-title">棋譜 · {events.length} 手</h2>
          <button type="button" className="game-button" onClick={() => dialog.current?.close()}>返回棋盤</button>
        </div>
        <div className="captured-pieces" aria-label="已被吃掉的棋子">
          {(['RED', 'BLACK'] as const).map(color => (
            <p key={color}>{color === 'RED' ? '紅方' : '黑方'}被吃：{captured.filter(piece => piece.color === color)
              .map(pieceLabel).join('、') || '無'}</p>
          ))}
        </div>
        {events.length === 0 ? <p className="history-empty">尚無行動紀錄。</p> : (
          <ol className="history-list" aria-label="已接受的行動紀錄">
            {events.map(event => (
              <li key={event.ply}>
                <span className="history-actor">第 {event.ply} 手 · {event.playerId === 'P1' ? '玩家一' : '玩家二'}</span>
                <p>{event.type === 'FLIP' ? `翻棋 · ${pieceLabel(event.piece)}`
                  : `${event.captured ? '吃子' : '移動'} · ${pieceLabel(event.piece)}`}</p>
                <p className="history-coordinate">{event.type === 'FLIP' ? coordinateLabel(event.position)
                  : `${coordinateLabel(event.from)} → ${coordinateLabel(event.to)}`}</p>
                {event.type === 'MOVE' && event.captured && <p>吃掉{pieceLabel(event.captured)}</p>}
              </li>
            ))}
          </ol>
        )}
      </dialog>
    </>
  );
}
