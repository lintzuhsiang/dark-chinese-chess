import { useRef } from 'react';
import type { ActionEvent, PublicPiece } from '@dark-chess/game-core';
import { History } from './History';

export function GameControls({ canUndo, finished, history, captured, onUndo, onRestart }: {
  readonly canUndo: boolean;
  readonly finished: boolean;
  readonly history: readonly ActionEvent[];
  readonly captured: readonly PublicPiece[];
  readonly onUndo: () => void;
  readonly onRestart: (confirmed: boolean) => void;
}) {
  const restartDialog = useRef<HTMLDialogElement>(null);
  return (
    <div className="game-controls" aria-label="對局操作">
      <button type="button" className="game-button" disabled={!canUndo || finished} onClick={onUndo}>悔棋</button>
      <History events={history} captured={captured} />
      <button type="button" className="game-button" onClick={() => finished
        ? onRestart(false) : restartDialog.current?.showModal()}>重新開始</button>
      <dialog className="restart-dialog" ref={restartDialog} aria-labelledby="restart-title" aria-describedby="restart-description">
        <h2 id="restart-title">重新開始？</h2>
        <p id="restart-description">對局尚未結束，目前的棋譜將會清除。</p>
        <div className="game-controls">
          <button type="button" className="game-button" autoFocus onClick={() => restartDialog.current?.close()}>取消</button>
          <button type="button" className="game-button" onClick={() => {
            restartDialog.current?.close();
            onRestart(true);
          }}>確定重新開始</button>
        </div>
      </dialog>
    </div>
  );
}
