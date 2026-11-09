import type { PlayerColors, PlayerId } from '@dark-chess/game-core';
import { Board } from './components/Board';
import { useLocalGame } from './hooks/useLocalGame';

const playerNames: Readonly<Record<PlayerId, string>> = { P1: '玩家一', P2: '玩家二' };
const errorMessages = {
  INVALID_DECK: '無法建立棋盤，請再試一次。',
  NOT_YOUR_TURN: '尚未輪到這位玩家。',
  INVALID_SOURCE: '無法操作這個位置。',
  INVALID_DESTINATION: '這個位置不在棋盤內。',
  ILLEGAL_MOVE: '目前無法移動這枚棋子。',
  INVALID_FLIP: '這枚棋子已翻開。',
  INVALID_ACTION: '目前無法進行這個操作。',
  GAME_FINISHED: '對局已結束。',
} as const;

function Players({ colors, current }: { readonly colors: PlayerColors; readonly current: PlayerId }) {
  return (
    <div className="players" aria-label="玩家與顏色">
      {(['P1', 'P2'] as const).map(player => (
        <div className={`player ${current === player ? 'current' : ''}`} key={player}>
          <span className="player-name">{playerNames[player]}</span>
          <span className={`assignment ${colors[player]?.toLowerCase() ?? ''}`}>
            {colors[player] === null ? '尚未分色' : colors[player] === 'RED' ? '紅方' : '黑方'}
          </span>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const { observation, error, startGame, flip } = useLocalGame();
  const allRevealed = observation?.board.every(square => square.kind !== 'HIDDEN');
  const turnText = observation === null ? '同一台裝置，輪流對弈。'
    : allRevealed ? '棋子已全部翻開。' : `輪到${playerNames[observation.currentPlayer]}翻棋`;

  return (
    <div className={`app ${observation ? 'playing' : 'welcome'}`}>
      <header className="masthead">
        <div><p className="eyebrow">台灣暗棋</p><h1>暗棋<span className="title-dot" aria-hidden="true">。</span></h1></div>
        <span className="mode-label">本機雙人</span>
      </header>
      <main>
        {observation === null ? (
          <section className="start-panel" aria-labelledby="start-title">
            <p className="eyebrow">一盤棋，兩個人</p>
            <h2 id="start-title">翻開，開始對弈。</h2>
            <p className="start-copy">三十二枚棋子，藏著下一步的可能。<br />與朋友坐下，輪流翻開第一枚棋。</p>
            <button className="start-button" type="button" onClick={startGame}>本機雙人<span aria-hidden="true"> →</span></button>
            <p className="start-note">無須帳號 · 共用一台裝置</p>
          </section>
        ) : (
          <section className="game" aria-label="本機雙人對局">
            <Players colors={observation.playerColors} current={observation.currentPlayer} />
            <div className="game-status" role="status" aria-live="polite" aria-atomic="true">
              <p>{turnText}{error && <span className="error-message"> · {errorMessages[error.code]}</span>}</p>
            </div>
            <Board squares={observation.board} onFlip={flip} />
            <p className="board-note">{observation.playerColors.P1 === null ? '第一枚棋子，決定你的顏色。' : '輪流翻棋，每次一枚。'}</p>
          </section>
        )}
        {observation === null && <p className="entry-status" role="status">{error ? errorMessages[error.code] : turnText}</p>}
      </main>
      <footer className="footer">專注一盤棋。</footer>
    </div>
  );
}
