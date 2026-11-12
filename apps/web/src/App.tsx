import type { PlayerColors, PlayerId, PlayerObservation } from '@dark-chess/game-core';
import { Board } from './components/Board';
import { GameControls } from './components/GameControls';
import { ReviewControls } from './components/ReviewControls';
import { ReviewHistory } from './components/ReviewHistory';
import { useLocalGame } from './hooks/useLocalGame';
import { StartPanel } from './components/StartPanel';
import { ModeMenu } from './components/ModeMenu';
import { AGENT_LABELS, type AiFailure } from './ai/protocol';

const playerNames: Readonly<Record<PlayerId, string>> = { P1: '玩家一', P2: '玩家二' };
const errorMessages = {
  INVALID_DECK: '無法建立棋盤，請再試一次。',
  NOT_YOUR_TURN: '尚未輪到這位玩家。',
  INVALID_SOURCE: '請先選擇自己的明棋。',
  INVALID_DESTINATION: '這個位置不在棋盤內。',
  ILLEGAL_MOVE: '這一步無法移動或吃子。',
  INVALID_FLIP: '這枚棋子已翻開。',
  INVALID_ACTION: '目前無法進行這個操作。',
  GAME_FINISHED: '對局已結束。',
  PERPETUAL_CHASE: '長捉，請改走其他步。',
} as const;

export function gameStatusText(
  observation: PlayerObservation,
  names: Readonly<Record<PlayerId, string>> = playerNames,
): string {
  const result = observation.result;
  if (result?.type === 'WIN') {
    const reason = result.reason === 'NO_PIECES' ? '對手已無棋子。' : '對手無法行動。';
    return `${names[result.winner]}獲勝：${reason}`;
  }
  if (result?.type === 'DRAW')
    return result.reason === 'CHASE_STALEMATE'
      ? '和棋：所有可走步皆因長捉而受限。'
      : '和棋：連續 60 手沒有翻棋或吃子。';
  return `輪到${names[observation.currentPlayer]}`;
}

function Players({
  colors,
  current,
  names = playerNames,
}: {
  readonly colors: PlayerColors;
  readonly current: PlayerId | null;
  readonly names?: Readonly<Record<PlayerId, string>>;
}) {
  return (
    <div className="players" aria-label="玩家與顏色">
      {(['P1', 'P2'] as const).map((player) => (
        <div className={`player ${current === player ? 'current' : ''}`} key={player}>
          <span className="player-name">{names[player]}</span>
          <span className={`assignment ${colors[player]?.toLowerCase() ?? ''}`}>
            {colors[player] === null ? '尚未分色' : colors[player] === 'RED' ? '紅方' : '黑方'}
          </span>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const {
    observation,
    error,
    selectedSquare,
    history,
    reviewHistory,
    captured,
    canUndo,
    canReview,
    reviewCursor,
    totalActions,
    startGame,
    clickSquare,
    undo,
    restartGame,
    openReview,
    closeReview,
    seekReview,
    mode,
    aiThinking,
    aiFailure,
    isAiTurn,
    startAiGame,
    retryAi,
    leaveGame,
  } = useLocalGame();
  const isReview = reviewCursor !== null;
  const finished = observation?.status === 'FINISHED';
  const names =
    mode.kind === 'LOCAL'
      ? playerNames
      : {
          P1: mode.humanSeat === 'P1' ? '你（玩家一）' : 'AI（玩家一）',
          P2: mode.humanSeat === 'P2' ? '你（玩家二）' : 'AI（玩家二）',
        };
  const failureMessages: Readonly<Record<AiFailure, string>> = {
    TIMEOUT: 'AI 思考逾時，對局已暫停。',
    UNAVAILABLE: '無法啟動 AI，請使用支援的瀏覽器重試。',
    WORKER_ERROR: 'AI 執行中斷，對局已暫停。',
    MALFORMED_RESPONSE: '無法讀取 AI 回應，對局已暫停。',
    INVALID_ACTION: 'AI 提出的走法無法使用，對局已暫停。',
    AGENT_ERROR: 'AI 無法完成這一步，對局已暫停。',
  };
  const turnText =
    observation === null
      ? '同一台裝置，輪流對弈。'
      : `${isReview ? `覆盤 · 第 ${reviewCursor}/${totalActions} 手 · ` : ''}${aiFailure ? failureMessages[aiFailure] : aiThinking ? 'AI 思考中…' : gameStatusText(observation, names)}`;

  return (
    <div className={`app ${observation ? 'playing' : 'welcome'}${isReview ? ' reviewing' : ''}`}>
      <header className="masthead">
        <div>
          <p className="eyebrow">台灣暗棋</p>
          <h1>
            暗棋
            <span className="title-dot" aria-hidden="true">
              。
            </span>
          </h1>
        </div>
        {observation ? (
          <ModeMenu
            label={mode.kind === 'AI' ? `人機 · ${AGENT_LABELS[mode.agent]}` : '本機雙人'}
            active={!finished && !isReview}
            onLeave={leaveGame}
          />
        ) : (
          <span className="mode-label">暗棋對弈</span>
        )}
      </header>
      <main className={isReview ? 'review-layout' : undefined}>
        {observation === null ? (
          <StartPanel onLocal={startGame} onAi={startAiGame} />
        ) : (
          <section className="game" aria-label={mode.kind === 'AI' ? '人機對局' : '本機雙人對局'}>
            <Players
              colors={observation.playerColors}
              current={finished ? null : observation.currentPlayer}
              names={names}
            />
            <div className="game-status" role="status" aria-live="polite" aria-atomic="true">
              <p>
                {turnText}
                {error && <span className="error-message"> · {errorMessages[error.code]}</span>}
              </p>
            </div>
            {aiFailure && (
              <div className="ai-recovery">
                <button className="game-button" type="button" onClick={retryAi}>
                  重試 AI
                </button>
                <span>也可以重新開始，或回到選單。</span>
              </div>
            )}
            <Board
              squares={observation.board}
              selectedSquare={selectedSquare}
              onSquareClick={clickSquare}
              disabled={isReview || finished || isAiTurn}
            />
            {isReview ? (
              <ReviewControls
                cursor={reviewCursor}
                total={totalActions}
                onSeek={seekReview}
                onExit={closeReview}
              />
            ) : (
              <GameControls
                canUndo={canUndo}
                finished={finished}
                history={history}
                captured={captured}
                onUndo={undo}
                onRestart={restartGame}
                onReview={canReview ? openReview : undefined}
              />
            )}
            <p className="board-note">
              {isReview
                ? '覆盤模式，棋盤僅供檢視。'
                : finished
                  ? '對局已結束。'
                  : observation.playerColors.P1 === null
                    ? '第一枚棋子，決定你的顏色。'
                    : selectedSquare !== null
                      ? '點選目的地，或直接翻開暗棋。'
                      : '翻暗棋，或選擇自己的明棋。'}
            </p>
          </section>
        )}
        {isReview && (
          <ReviewHistory
            events={reviewHistory}
            captured={captured}
            cursor={reviewCursor}
            onSeek={seekReview}
          />
        )}
        {observation === null && (
          <p className="entry-status" role="status">
            {error ? errorMessages[error.code] : turnText}
          </p>
        )}
      </main>
      <footer className="footer">專注一盤棋。</footer>
    </div>
  );
}
