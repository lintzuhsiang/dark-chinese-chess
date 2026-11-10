import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GameAction, Piece } from '../packages/game-core/src/types';
import { fixtureDeck, shuffleSamples } from '../verification/fixtures';

export const cellsFor = (page: Page) =>
  page.getByRole('list', { name: '暗棋棋盤，八列四欄' }).getByRole('button');
export async function startGame(page: Page, deck: readonly Piece[] = fixtureDeck()) {
  await page.goto('/');
  await page.getByRole('button', { name: '本機雙人', exact: true }).waitFor();
  await page.evaluate((samples) => {
    let cursor = 0;
    Math.random = () => samples[cursor++] ?? 1 - Number.EPSILON;
  }, shuffleSamples(deck));
  await page.getByRole('button', { name: '本機雙人', exact: true }).click();
}
export async function playActions(page: Page, actions: readonly GameAction[]) {
  const cells = cellsFor(page);
  for (const action of actions) {
    if (action.type === 'FLIP') await cells.nth(action.position).click();
    else {
      await cells.nth(action.from).click();
      await cells.nth(action.to).click();
    }
  }
}
export async function assertBoardFits(page: Page, allowPageScroll = false) {
  const geometry = await page.evaluate(() => {
    const targets = [
      ...document.querySelectorAll<HTMLButtonElement>('.board button, .game-controls > button'),
    ].filter((element) => element.getClientRects().length > 0);
    const rectangles = targets.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.getAttribute('aria-label') ?? element.textContent,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      rectangles,
      header: document.querySelector('.masthead')?.getBoundingClientRect().toJSON(),
      title: document.querySelector('h1')?.getBoundingClientRect().toJSON(),
    };
  });
  expect(geometry.scrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.width);
  if (!allowPageScroll)
    expect(geometry.scrollHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.height);
  for (const rect of geometry.rectangles) {
    expect(rect.width, rect.label ?? '').toBeGreaterThanOrEqual(44);
    expect(rect.height, rect.label ?? '').toBeGreaterThanOrEqual(44);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(geometry.width);
    expect(rect.bottom).toBeLessThanOrEqual(geometry.height);
  }
  for (let index = 0; index < geometry.rectangles.length; index += 1) {
    const a = geometry.rectangles[index]!;
    for (const b of geometry.rectangles.slice(index + 1)) {
      expect(
        Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0.5 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0.5,
        `${a.label} overlaps ${b.label}`,
      ).toBe(false);
    }
  }
  return geometry;
}
