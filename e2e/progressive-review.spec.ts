import { expect, test } from '@playwright/test';

test('completion → progressive prefixes → unchanged completed game', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Test-only no-op shuffle. Exercise the real entry/actions; no production seed
  // endpoint, state injection, or saved completed-game fixture is exposed.
  await page.addInitScript(() => {
    Math.random = () => 1 - Number.EPSILON;
  });
  await page.goto('/');
  await page.getByRole('button', { name: '本機雙人', exact: true }).click();
  const board = page.getByRole('list', { name: '暗棋棋盤，八列四欄' });
  const cells = board.getByRole('button');
  const status = page.getByRole('status');
  await expect(page.getByRole('button', { name: '覆盤', exact: true })).toHaveCount(0);
  await cells.nth(0).click();
  const step1Labels = await cells.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-label')),
  );
  await cells.nth(1).click();
  await page.getByRole('button', { name: '悔棋', exact: true }).click();
  await cells.nth(31).click(); // Discarded action 2 was a different reveal by P2.
  let step30Labels: (string | null)[] = [];
  for (let position = 1; position < 31; position += 1) {
    await cells.nth(position).click();
    if (position === 28)
      step30Labels = await cells.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label')),
      );
  }
  async function move(from: number, to: number) {
    await cells.nth(from).click();
    await cells.nth(to).click();
  }
  await move(12, 16); // Red Soldier captures Black General.
  await move(17, 16); // Black Advisor captures that Soldier.
  const quietCycle = [
    [13, 12],
    [16, 17],
    [12, 13],
    [17, 16],
  ] as const;
  for (let ply = 0; ply < 60; ply += 1) {
    const [from, to] = quietCycle[ply % 4]!;
    await move(from, to);
  }
  await expect(status).toHaveText('和棋：連續 60 手沒有翻棋或吃子。');
  const finalBoard = await board.innerHTML();
  await page.getByRole('button', { name: '覆盤', exact: true }).click();
  await expect(status).toContainText('覆盤 · 第 0/94 手');
  await expect(status).not.toContainText('和棋');
  await expect(page.getByText('尚未分色')).toHaveCount(2);
  await expect(cells).toHaveCount(32);
  await expect(board.locator('button:disabled')).toHaveCount(32);
  await expect(board.locator('button[aria-label$="，暗棋"]')).toHaveCount(32);
  await expect(page.getByRole('button', { name: '回到開局' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '前一步' })).toBeDisabled();
  const history = page.getByRole('complementary', { name: '棋譜 · 94 手' });
  await expect(history).toBeVisible();
  await expect(history.getByRole('listitem')).toHaveCount(95); // Opening plus all accepted actions.
  await expect(history).toContainText('翻棋 · 紅方帥');
  await expect(history).toContainText('吃掉黑方將');
  await expect(history).toContainText('紅方被吃：無'); // Selected-position summary, not final captures.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(status).toContainText('第 1/94 手');
  await expect(board.locator('button[aria-label$="，暗棋"]')).toHaveCount(31);
  await expect(cells.nth(0)).toHaveAttribute('aria-label', '第 1 列，第 1 欄，紅方帥');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(cells.nth(1)).toHaveAttribute('aria-label', '第 1 列，第 2 欄，暗棋');
  await expect(cells.nth(31)).toHaveAttribute('aria-label', '第 8 列，第 4 欄，黑方卒');
  await expect(history.getByRole('listitem')).toHaveCount(95);
  await expect(history.getByRole('button', { name: '檢視第 2 手', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(history).toContainText('紅方被吃：無');
  // Direct nonsequential selection reproduces the real earlier boards.
  await history.getByRole('button', { name: '檢視第 30 手', exact: true }).click();
  await expect(status).toContainText('第 30/94 手');
  expect(
    await cells.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')),
    ),
  ).toEqual(step30Labels);
  await history.getByRole('button', { name: '檢視第 1 手', exact: true }).press('Enter');
  await expect(status).toContainText('第 1/94 手');
  expect(
    await cells.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')),
    ),
  ).toEqual(step1Labels);
  await history.getByRole('button', { name: '檢視第 30 手', exact: true }).press('Space');
  await expect(status).toContainText('第 30/94 手');
  await history.getByRole('button', { name: '檢視第 2 手', exact: true }).click();
  await page.getByRole('button', { name: '前一步' }).click();
  await expect(status).toContainText('第 1/94 手');
  await page.getByRole('button', { name: '最終局面' }).click();
  await expect(status).toContainText('第 94/94 手');
  await expect(status).toContainText('和棋');
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '最終局面' })).toBeDisabled();
  await expect(board).toHaveJSProperty('innerHTML', finalBoard);
  await expect(history.getByRole('listitem')).toHaveCount(95);
  await expect(history).toContainText('吃掉黑方將');
  await page.getByRole('button', { name: '回到開局' }).click();
  await expect(status).toContainText('第 0/94 手');
  await page.screenshot({ path: testInfo.outputPath('review-initial.png') });
  await page.getByRole('button', { name: '結束覆盤' }).click();
  await expect(page.getByRole('button', { name: '覆盤', exact: true })).toBeFocused();
  await expect(status).toHaveText('和棋：連續 60 手沒有翻棋或吃子。');
  await expect(board).toHaveJSProperty('innerHTML', finalBoard);
  await expect(page.getByRole('button', { name: '棋譜 · 94', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新開始', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
