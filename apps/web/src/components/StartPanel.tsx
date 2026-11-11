import { useState } from 'react';
import type { PlayerId } from '@dark-chess/game-core';
import { AGENT_LABELS, type AgentKind } from '../ai/protocol';

export function StartPanel({
  onLocal,
  onAi,
}: {
  readonly onLocal: () => void;
  readonly onAi: (humanSeat: PlayerId, agent: AgentKind) => void;
}) {
  const [humanSeat, setHumanSeat] = useState<PlayerId>('P1');
  const [agent, setAgent] = useState<AgentKind>('expected-value');
  return (
    <section className="start-panel" aria-labelledby="start-title">
      <p className="eyebrow">一盤棋，隨時開局</p>
      <h2 id="start-title">翻開，開始對弈。</h2>
      <p className="start-copy">與朋友輪流下棋，或讓 AI 陪你對弈。</p>
      <button className="start-button" type="button" tabIndex={0} onClick={onLocal}>
        本機雙人<span aria-hidden="true"> →</span>
      </button>
      <fieldset className="ai-setup">
        <legend>與 AI 對弈</legend>
        <label>
          你的順序
          <select
            value={humanSeat}
            onChange={(event) => setHumanSeat(event.currentTarget.value as PlayerId)}
          >
            <option value="P1">先手（玩家一）</option>
            <option value="P2">後手（玩家二）</option>
          </select>
        </label>
        <label>
          AI 策略
          <select
            value={agent}
            onChange={(event) => setAgent(event.currentTarget.value as AgentKind)}
          >
            {Object.entries(AGENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="start-button ai-start"
          type="button"
          onClick={() => onAi(humanSeat, agent)}
        >
          開始人機對弈<span aria-hidden="true"> →</span>
        </button>
        <p className="start-note">首枚翻棋決定顏色 · 人機對局不提供悔棋</p>
      </fieldset>
      <p className="start-note">無須帳號 · 所有運算都在你的裝置上</p>
    </section>
  );
}
