import { useRef } from 'react';

export function ModeMenu({
  label,
  active,
  onLeave,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onLeave: (confirmed: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <div className="mode-switcher">
        <span className="mode-label">{label}</span>
        <button
          type="button"
          className="menu-button"
          aria-label="回到選單"
          onClick={() => (active ? dialog.current?.showModal() : onLeave(false))}
        >
          選單
        </button>
      </div>
      {active && (
        <dialog
          className="restart-dialog"
          ref={dialog}
          aria-labelledby="menu-title"
          aria-describedby="menu-description"
        >
          <h2 id="menu-title">回到選單？</h2>
          <p id="menu-description">目前的對局與棋譜將會清除。</p>
          <div className="game-controls">
            <button
              type="button"
              className="game-button"
              autoFocus
              onClick={() => dialog.current?.close()}
            >
              取消
            </button>
            <button
              type="button"
              className="game-button"
              onClick={() => {
                dialog.current?.close();
                onLeave(true);
              }}
            >
              確定回到選單
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
