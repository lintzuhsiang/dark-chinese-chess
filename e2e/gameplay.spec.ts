import { expect, test } from '@playwright/test';
import { cycle, fixtureDeck, flip, move, opening, pairDeck } from '../verification/fixtures';
import { cellsFor, playActions, startGame } from './support';

test('selection, rejected capture, direct hidden flip, capture/move undo, and restart', async ({
  page,
}) => {
  await startGame(
    page,
    fixtureDeck([
      [0, 'RED', 'CHARIOT'],
      [1, 'BLACK', 'HORSE'],
      [2, 'RED', 'HORSE'],
      [3, 'BLACK', 'GENERAL'],
      [4, 'BLACK', 'SOLDIER'],
      [8, 'RED', 'SOLDIER'],
    ]),
  );
  const cells = cellsFor(page);
  const status = page.getByRole('status');
  await playActions(page, [0, 1, 2, 3, 4, 8].map(flip));
  await cells.nth(0).click();
  await cells.nth(2).click();
  await expect(cells.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await cells.nth(3).click();
  await expect(status).toContainText('這一步無法移動或吃子。');
  await expect(page.getByRole('button', { name: '棋譜 · 6', exact: true })).toBeVisible();
  await expect(cells.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await cells.nth(5).click();
  await expect(cells.nth(2)).toHaveAttribute('aria-pressed', 'false');
  await playActions(page, [flip(6), move(0, 1), move(4, 0)]);
  await expect(page.getByRole('button', { name: '棋譜 · 10', exact: true })).toBeVisible();
  await expect(cells.nth(0)).toHaveAttribute('aria-label', '第 1 列，第 1 欄，黑方卒');
  await page.getByRole('button', { name: '悔棋', exact: true }).click();
  await expect(cells.nth(0)).toHaveAttribute('aria-label', '第 1 列，第 1 欄，空格');
  await expect(cells.nth(0)).toBeEnabled();
  await page.getByRole('button', { name: '悔棋', exact: true }).click();
  await expect(cells.nth(0)).toHaveAttribute('aria-label', '第 1 列，第 1 欄，紅方俥');
  await expect(cells.nth(1)).toHaveAttribute('aria-label', '第 1 列，第 2 欄，黑方馬');
  await page.getByRole('button', { name: '悔棋', exact: true }).click();
  await cells.nth(1).click();
  const before = await page.locator('main').innerHTML();
  await page.getByRole('button', { name: '重新開始', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('main')).toHaveJSProperty('innerHTML', before);
  await expect(page.getByRole('button', { name: '重新開始', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '重新開始', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(cells.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '棋譜 · 7', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('listitem')).toHaveCount(7);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '重新開始', exact: true }).click();
  await page.getByRole('button', { name: '確定重新開始', exact: true }).click();
  await expect(page.getByText('尚未分色')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '棋譜 · 0', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '悔棋', exact: true })).toBeDisabled();
  await expect(page.locator('.board button[aria-label$="，暗棋"]')).toHaveCount(32);
  expect(await page.locator('main').innerHTML()).not.toMatch(/RED-|BLACK-|data-id|initialDeck/);
});

test('chase rejection recurs on a later pattern and survives undo of a reset', async ({ page }) => {
  await startGame(page, pairDeck('CHARIOT'));
  await playActions(page, [...opening, ...cycle, ...cycle, ...cycle.slice(0, -1)]);
  const cells = cellsFor(page);
  await cells.nth(1).click();
  const before = await page.locator('.board').innerHTML();
  await cells.nth(0).click();
  await expect(page.getByRole('status')).toContainText('長捉，請改走其他步。');
  await expect(page.locator('.board')).toHaveJSProperty('innerHTML', before);
  await expect(page.getByRole('button', { name: '棋譜 · 18', exact: true })).toBeVisible();
  await cells.nth(4).click(); // A different invalid attempt must not clear rule tracking.
  await expect(page.getByRole('status')).toContainText('這一步無法移動或吃子。');
  await cells.nth(0).click();
  await expect(page.getByRole('status')).toContainText('長捉，請改走其他步。');
  await cells.nth(5).click(); // A permitted renewal on another route.
  const later = [move(4, 0), move(5, 1), move(0, 4), move(1, 5)];
  await playActions(page, [...later, ...later, ...later.slice(0, -1)]);
  await cells.nth(1).click();
  await cells.nth(5).click();
  await expect(page.getByRole('status')).toContainText('長捉，請改走其他步。');
  await expect(page.getByRole('button', { name: '棋譜 · 30', exact: true })).toBeVisible();
  await cells.nth(31).click();
  await expect(page.getByRole('button', { name: '棋譜 · 31', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '悔棋', exact: true }).click();
  await playActions(page, [move(1, 5)]);
  await expect(page.getByRole('status')).toContainText('長捉，請改走其他步。');
  await expect(page.getByRole('button', { name: '棋譜 · 30', exact: true })).toBeVisible();
});
