import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { GameControls } from '../src/components/GameControls';
import { projectSession } from '../src/game/review';
import * as localGame from '../src/hooks/useLocalGame';
import { finishedBranchGame } from './review-fixtures';

const session = finishedBranchGame().final.session!;
afterEach(() => vi.restoreAllMocks());

function renderReview(cursor: number): string {
  vi.spyOn(localGame, 'useLocalGame').mockReturnValue({
    ...projectSession(session, cursor),
    reviewHistory: projectSession(session, null).history,
    canUndo: false, canReview: false, reviewCursor: cursor, totalActions: session.actions.length,
    error: null, selectedSquare: null,
    startGame: () => {}, clickSquare: () => {}, undo: () => {}, restartGame: () => {},
    openReview: () => {}, closeReview: () => {}, seekReview: () => {},
  });
  return renderToStaticMarkup(createElement(App));
}

describe('rendered Review boundary', () => {
  it.each([0, 1, 2, 32, 33, 34, 93, 94])('renders cursor %i with a full selectable history and a read-only historical board', cursor => {
    const html = renderReview(cursor);
    expect(html).toContain(`覆盤 · 第 ${cursor}/94 手`);
    expect(html).toContain('棋譜 · 94 手');
    const rows = html.match(/<li>/g) ?? [];
    expect(rows).toHaveLength(32 + 95); // Board, opening, and the entire completed timeline.
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain(`aria-label="${cursor === 0 ? '檢視開局' : `檢視第 ${cursor} 手`}" aria-current="step"`);
    expect(html).not.toContain('<dialog');
    expect(html.match(/class="square [^"]*"[^>]*disabled=""/g)).toHaveLength(32);
    expect(html.match(/aria-pressed="true"/g) ?? []).toHaveLength(0);
    expect(html.includes('和棋：')).toBe(cursor === 94);
    expect(html).not.toMatch(/重新開始|悔棋|RED-|BLACK-|positionCounts|attackerId|initialDeck|data-id/);
    expect(html).toContain('結束覆盤');
  });

  it('keeps future identities out of the board while allowing public completed history at every cursor', () => {
    const zero = renderReview(0);
    expect(zero.match(/，暗棋"/g)).toHaveLength(32);
    expect(zero.match(/尚未分色/g)).toHaveLength(2);
    const boardMarkup = (html: string) => html.slice(html.indexOf('<section class="game"'), html.indexOf('<aside'));
    expect(boardMarkup(zero)).not.toMatch(/紅方帥|紅方仕|黑方卒|黑方將|吃掉/);
    expect(zero).toContain('翻棋 · 黑方卒'); // Full completed public list is intentional.
    expect(zero).toContain('紅方被吃：無');
    expect(zero).toContain('黑方被吃：無');
    const one = renderReview(1);
    expect(boardMarkup(one)).toContain('紅方帥');
    expect(boardMarkup(one)).not.toMatch(/紅方仕|黑方卒|黑方將/);
    const two = renderReview(2);
    expect(two).toContain('翻棋 · 黑方卒');
    expect(boardMarkup(two)).not.toMatch(/紅方仕|黑方將|吃掉/);
    expect(two).toContain('第 1 列，第 2 欄，暗棋');
  });

  it.each([0, 10, 94])('renders the correct navigation boundaries at %i', cursor => {
    const html = renderReview(cursor);
    for (const label of ['回到開局', '前一步']) {
      expect(html.includes(`aria-label="${label}" disabled=""`)).toBe(cursor === 0);
    }
    for (const label of ['下一步', '最終局面']) {
      expect(html.includes(`aria-label="${label}" disabled=""`)).toBe(cursor === 94);
    }
  });

  it('shows a Review entry only on the completed live screen', () => {
    for (const finished of [false, true]) {
      const html = renderToStaticMarkup(createElement(GameControls, {
        canUndo: !finished, finished, history: [], captured: [], onUndo: () => {}, onRestart: () => {}, onReview: () => {},
      }));
      expect(html.includes('>覆盤</button>')).toBe(finished);
    }
  });
});
