import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getObservation } from '@dark-chess/game-core';
import { Board } from '../src/components/Board';
import { GameControls } from '../src/components/GameControls';
import { History } from '../src/components/History';
import { boardUiReducer, initialBoardUi } from '../src/game/interaction';
import type { BoardUiState } from '../src/game/interaction';
import { reconstructGame } from '../src/game/reconstruct';
import { cycle, flip, freeze, opening, pairDeck, recordedGame } from './history-fixtures';

const click = (state: BoardUiState, position: number) => boardUiReducer(freeze(state), { type: 'CLICK', position });
const start = () => boardUiReducer(initialBoardUi, { type: 'START', deck: pairDeck() });
function historyHtml(ui: BoardUiState): string {
  const session = ui.local.session!;
  const { events } = reconstructGame(session.initialDeck, session.actions);
  const captured = events.flatMap(event => event.type === 'MOVE' && event.captured ? [event.captured] : []);
  return renderToStaticMarkup(createElement(History, { events, captured }));
}

describe('history and session controls', () => {
  it('shows accepted action numbers, actors, types, coordinates, and captures in order', () => {
    const game = recordedGame(pairDeck(), opening);
    const ui = { ...initialBoardUi, local: game.final };
    const html = historyHtml(ui);
    expect(html.match(/<li>/g)).toHaveLength(7);
    expect(html).toContain('第 1 手 · 玩家一');
    expect(html).toContain('翻棋 · 紅方俥');
    expect(html).toContain('第 2 手 · 玩家二');
    expect(html.indexOf('第 1 手')).toBeLessThan(html.indexOf('第 2 手'));
    expect(html.indexOf('第 5 手')).toBeLessThan(html.indexOf('第 6 手'));
    expect(html).toContain('第 1 列，第 1 欄 → 第 1 列，第 2 欄');
    expect(html).toContain('吃子 · 紅方俥');
    expect(html).toContain('吃掉黑方卒');
    expect(html).toContain('移動 · 紅方俥');
    expect(html).toContain('紅方被吃：紅方兵');
    expect(html).toContain('黑方被吃：黑方卒');
    expect(html).not.toMatch(/RED-|BLACK-|pieceId|data-id|positionCounts|前一步|下一步|覆盤/);
  });

  it('excludes rejected attempts/selection and removes undone captures and revelations from markup', () => {
    const game = recordedGame(pairDeck(), opening.slice(0, 5));
    let ui: BoardUiState = { ...initialBoardUi, local: game.final };
    const before = historyHtml(ui);
    ui = click(ui, 4); // Revealed opponent piece without selection: rejected.
    expect(historyHtml(ui)).toBe(before);
    ui = click(ui, 5); // Select Black Horse without creating an entry.
    expect(historyHtml(ui)).toBe(before);
    ui = boardUiReducer(ui, { type: 'UNDO' });
    expect(historyHtml(ui)).not.toContain('吃掉黑方卒');
    expect(historyHtml(ui)).toContain('黑方被吃：無');
    for (let index = 0; index < 4; index += 1) ui = boardUiReducer(ui, { type: 'UNDO' });
    const html = historyHtml(ui) + renderToStaticMarkup(createElement(Board, {
      squares: getObservation(ui.local.session!.currentState).board, onSquareClick: () => {},
    }));
    expect(html).toContain('尚無行動紀錄。');
    expect(html.match(/，暗棋"/g)).toHaveLength(32);
    expect(html).not.toMatch(/紅方俥|黑方馬|黑方卒|紅方兵|RED-|BLACK-|第 1 手/);
  });

  it('clears selection/error after a successful undo while preserving them on rejected undo', () => {
    let ui = click(click(start(), 0), 1);
    ui = click(click(ui, 0), 32);
    expect(ui.local.error?.code).toBe('INVALID_DESTINATION');
    ui = boardUiReducer(freeze(ui), { type: 'UNDO' });
    expect(ui.selectedSquare).toBeNull();
    expect(ui.local.error).toBeNull();
    expect(ui.local.session!.actions).toHaveLength(1);
    expect(getObservation(ui.local.session!.currentState).board[1]).toEqual({ kind: 'HIDDEN' });
    const empty = start();
    const rejected = boardUiReducer(freeze(empty), { type: 'UNDO' });
    expect(rejected.local.session).toBe(empty.local.session);
    expect(rejected.selectedSquare).toBe(empty.selectedSquare);
    expect(rejected.local.error?.code).toBe('INVALID_ACTION');
  });

  it('preserves selection on failed replacement and clears all game/UI data after a valid restart', () => {
    let ui: BoardUiState = { ...initialBoardUi, local: recordedGame(pairDeck(), [...opening, ...cycle]).final };
    ui = click(click(ui, 4), 32); // P2 selects its Horse, then submits an invalid destination.
    expect(ui.selectedSquare).toBe(4);
    const before = freeze(ui);
    const unconfirmed = boardUiReducer(before, { type: 'RESTART', deck: pairDeck(), confirmed: false });
    expect(unconfirmed.local.session).toBe(before.local.session);
    expect(unconfirmed.selectedSquare).toBe(4);
    const invalid = boardUiReducer(before, { type: 'RESTART', deck: [], confirmed: true });
    expect(invalid.local.error?.code).toBe('INVALID_DECK');
    expect(invalid.local.session).toBe(before.local.session);
    expect(invalid.selectedSquare).toBe(4);
    ui = boardUiReducer(before, { type: 'RESTART', deck: pairDeck(), confirmed: true });
    expect(ui.selectedSquare).toBeNull();
    expect(ui.local.error).toBeNull();
    expect(ui.local.session!.currentState).toEqual(start().local.session!.currentState);
    expect(historyHtml(ui)).toContain('尚無行動紀錄。');
    ui = click(click(ui, 0), 1);
    ui = click(click(ui, 0), 2); // The existing selected-source hidden FLIP UX still works.
    expect(ui.local.session!.actions.at(-1)!.action).toEqual(flip(2));
    expect(ui.selectedSquare).toBeNull();
    expect(ui.local.error).toBeNull();
  });

  it.each([
    ['initial', false, false], ['finished', false, true], ['active with history', true, false],
    ['finished despite a stale availability flag', true, true],
  ] as const)('renders native undo guards and read-only history access: %s', (_name, canUndo, finished) => {
    const html = renderToStaticMarkup(createElement(GameControls, {
      canUndo, finished, history: [], captured: [], onUndo: () => {}, onRestart: () => {},
    }));
    expect(html.includes('disabled=""')).toBe(!canUndo || finished);
    expect(html).toContain('悔棋');
    expect(html).toContain('重新開始');
    expect(html).toContain('棋譜 · 0');
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-labelledby="history-title"');
    expect(html).not.toMatch(/覆盤|前一步|下一步|建議|data-id/);
  });
});
