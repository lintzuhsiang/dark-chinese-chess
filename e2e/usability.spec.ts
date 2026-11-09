import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { shortFixture } from '../verification/fixtures';
import { assertBoardFits, cellsFor, playActions, startGame } from './support';

for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`normal layout and targets at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await startGame(page, shortFixture.deck);
    await assertBoardFits(page);
    await cellsFor(page).nth(0).click();
    await cellsFor(page).nth(1).click();
    const play = await assertBoardFits(page);
    await page.screenshot({ path: testInfo.outputPath('play.png') });
    await playActions(page, shortFixture.completed.slice(2));
    await page.getByRole('button', { name: '覆盤', exact: true }).press('Enter');
    await expect(page.getByRole('button', { name: '下一步' })).toBeFocused();
    const review = await assertBoardFits(page, viewport.width <= 720);
    const boardBounds = await page.locator('.board').boundingBox();
    const historyBounds = await page.locator('.review-history').boundingBox();
    expect(boardBounds).not.toBeNull();
    expect(historyBounds).not.toBeNull();
    if (viewport.width > 720) expect(historyBounds!.x).toBeGreaterThanOrEqual(boardBounds!.x + boardBounds!.width);
    else expect(historyBounds!.y).toBeGreaterThanOrEqual(boardBounds!.y + boardBounds!.height);
    const navigation = await page.locator('.review-navigation button').evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, right: rect.right };
    }));
    expect(Math.max(...navigation.map(button => button.width)) - Math.min(...navigation.map(button => button.width))).toBeLessThan(1);
    expect(Math.abs(navigation[3]!.right - (boardBounds!.x + boardBounds!.width))).toBeLessThan(1);
    await expect(page.getByRole('button', { name: '檢視開局', exact: true })).toHaveAttribute('aria-current', 'step');
    await page.getByRole('button', { name: '最終局面' }).click();
    const selectedVisible = await page.locator('.review-history-list').evaluate(list => {
      const container = list.getBoundingClientRect();
      const selected = list.querySelector('[aria-current="step"]')!.getBoundingClientRect();
      return selected.top >= container.top - 1 && selected.bottom <= container.bottom + 1;
    });
    expect(selectedVisible).toBe(true);
    if (viewport.width > 720) await expect(page.getByRole('button', { name: '檢視第 66 手', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: '回到開局' }).click();
    await expect(page.getByRole('button', { name: '檢視開局', exact: true })).toHaveAttribute('aria-current', 'step');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true });
    await writeFile(testInfo.outputPath('geometry.json'), JSON.stringify({ viewport, play, review }, null, 2));
  });
}

test('keyboard operation, modal focus, and live rejection announcements', async ({ page }) => {
  await startGame(page);
  const cells = cellsFor(page);
  await cells.nth(0).focus();
  await page.keyboard.press('Enter');
  await expect(cells.nth(0)).toHaveAttribute('aria-label', '第 1 列，第 1 欄，紅方帥');
  await page.keyboard.press('Tab');
  await expect(cells.nth(1)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '棋譜 · 2', exact: true })).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(cells.nth(0)).toBeFocused();
  const focus = await cells.nth(0).evaluate(element => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(focus.style).toBe('solid');
  await cells.nth(16).click(); // Hidden Black General; any player may flip.
  await cells.nth(0).click(); // P2 cannot select Red General.
  await expect(page.getByRole('status')).toContainText('請先選擇自己的明棋。');
  await expect(page.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  await page.getByRole('button', { name: '棋譜 · 3', exact: true }).focus();
  await page.keyboard.press('Enter');
  const close = page.getByRole('button', { name: '返回棋盤' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused(); // Native dialogs may include browser chrome in the Tab cycle.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '棋譜 · 3', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '重新開始', exact: true })).toBeFocused();
});

test('200% text size preserves readable and reachable cells, controls, and dialogs', async ({ page }) => {
  await startGame(page);
  const before = await page.locator('.player-name').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const after = await page.locator('.player-name').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(after).toBeGreaterThanOrEqual(before * 2 - 0.1);
  for (const cell of await cellsFor(page).all()) {
    await cell.scrollIntoViewIfNeeded();
    await expect(cell).toBeInViewport();
  }
  await page.getByRole('button', { name: '重新開始', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '確定重新開始', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '棋譜 · 0', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回棋盤' })).toBeInViewport();
  await page.keyboard.press('Escape');
  await startGame(page, shortFixture.deck);
  await playActions(page, shortFixture.completed);
  await page.getByRole('button', { name: '覆盤', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.locator('.review-history-list').evaluate(list => list.clientHeight)).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: '檢視第 30 手', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('第 30/66 手');
});

test('200% zoom-equivalent reflow keeps the board and controls reachable', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('Missing verification base URL.');
  // Half the 1280×800 CSS viewport at double pixel density. This is emulated
  // reflow evidence; actual browser zoom remains on the physical-device checklist.
  const context = await browser.newContext({ baseURL, viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    await startGame(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(640);
    for (const cell of await cellsFor(page).all()) {
      await cell.scrollIntoViewIfNeeded();
      await expect(cell).toBeInViewport();
    }
    for (const name of ['棋譜 · 0', '重新開始']) {
      const button = page.getByRole('button', { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }
  } finally { await context.close(); }
});
