import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState, getObservation } from '@dark-chess/game-core';
import type { GameResult } from '@dark-chess/game-core';
import { App, gameStatusText } from '../src/App';
import { Board } from '../src/components/Board';
import { createShuffledDeck } from '../src/game/deck';

function initial() {
  const result = createInitialState(createShuffledDeck(() => 1 - Number.EPSILON));
  if (!result.ok) throw new Error('Expected valid deck.');
  return result.state;
}

describe('player-facing render boundary', () => {
  it('offers the local two-player entry without deferred controls', () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('本機雙人');
    expect(html).not.toMatch(/悔棋|覆盤|重新開始|登入|AI/);
  });

  it('renders exactly 32 generic, keyboard-activatable hidden cells with coordinate labels', () => {
    const html = renderToStaticMarkup(
      createElement(Board, { squares: getObservation(initial()).board, onSquareClick: () => {} }),
    );
    expect(html.match(/<button\b/g)).toHaveLength(32);
    expect(html.match(/，暗棋"/g)).toHaveLength(32);
    expect(html).toContain('第 1 列，第 1 欄');
    expect(html).toContain('第 8 列，第 4 欄');
    expect(html).not.toMatch(/GENERAL|SOLDIER|RED|BLACK|帥|將|兵|卒|data-piece|data-id/);
  });

  it('renders only the piece actually flipped; hidden ranks and IDs stay absent', () => {
    const result = applyAction(initial(), 'P1', { type: 'FLIP', position: 0 });
    if (!result.ok) throw new Error('Expected first flip.');
    const html = renderToStaticMarkup(
      createElement(Board, {
        squares: getObservation(result.state).board,
        onSquareClick: () => {},
      }),
    );
    expect(html).toContain('第 1 列，第 1 欄，紅方帥');
    expect(html.match(/，暗棋"/g)).toHaveLength(31);
    expect(html).not.toMatch(/RED-GENERAL|BLACK-|ADVISOR|HORSE|士|象|卒/);
  });

  it('communicates selection accessibly with a static selected class and no move hints', () => {
    const result = applyAction(initial(), 'P1', { type: 'FLIP', position: 0 });
    if (!result.ok) throw new Error('Expected first flip.');
    const html = renderToStaticMarkup(
      createElement(Board, {
        squares: getObservation(result.state).board,
        selectedSquare: 0,
        onSquareClick: () => {},
      }),
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('revealed red selected');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(31);
    expect(html).not.toMatch(/legal-move|suggest|data-piece|data-id/);
  });

  it('keeps empty destinations keyboard-activatable and generically labeled', () => {
    const html = renderToStaticMarkup(
      createElement(Board, {
        squares: [{ kind: 'EMPTY' }],
        onSquareClick: () => {},
      }),
    );
    expect(html).toContain('第 1 列，第 1 欄，空格');
    expect(html).toContain('<button');
    expect(html).not.toContain('disabled');
  });

  it.each([
    [{ type: 'WIN', winner: 'P1', reason: 'NO_PIECES' }, 'P2', '玩家一獲勝：對手已無棋子。'],
    [{ type: 'WIN', winner: 'P2', reason: 'NO_LEGAL_ACTION' }, 'P1', '玩家二獲勝：對手無法行動。'],
    [{ type: 'DRAW', reason: 'NO_PROGRESS' }, 'P2', '和棋：連續 60 手沒有翻棋或吃子。'],
  ] as const)(
    'uses the stored result rather than terminal currentPlayer: %j',
    (result, currentPlayer, expected) => {
      const observation = {
        ...getObservation(initial()),
        status: 'FINISHED' as const,
        result: result as GameResult,
        currentPlayer,
      };
      expect(gameStatusText(observation)).toBe(expected);
    },
  );

  it('keeps active turn text and disables every finished board cell without exposing hidden data', () => {
    const observation = getObservation(initial());
    expect(gameStatusText(observation)).toBe('輪到玩家一');
    const html = renderToStaticMarkup(
      createElement(Board, {
        squares: observation.board,
        disabled: true,
        onSquareClick: () => {},
      }),
    );
    expect(html.match(/disabled=""/g)).toHaveLength(32);
    expect(html).not.toMatch(/GENERAL|SOLDIER|RED-GENERAL|BLACK-/);
  });
});
