import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { replayFixture } from '../apps/web/tests/replay-fixtures';

const tournament = replayFixture().tournament;
async function upload(page: Page, value: unknown = tournament) {
  await page.getByLabel('Tournament JSON').setInputFiles({
    name: 'tournament.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
}
async function jump(page: Page, ply: number) {
  await page.getByLabel('Jump to ply', { exact: true }).fill(String(ply));
  await page.getByRole('button', { name: 'Jump', exact: true }).click();
  await expect(page.getByLabel('Ply slider')).toHaveValue(String(ply));
}

async function assertBoardGeometry(page: Page) {
  const boxes = await page.locator('.board .square').evaluateAll((cells) =>
    cells.map((cell) => {
      const box = cell.getBoundingClientRect();
      return { x: Math.round(box.x), y: Math.round(box.y), width: box.width, height: box.height };
    }),
  );
  expect(new Set(boxes.map((box) => box.x)).size).toBe(4);
  expect(new Set(boxes.map((box) => box.y)).size).toBe(8);
  expect(boxes.every((box) => box.width >= 44 && box.height >= 44)).toBe(true);
}

test('import, hidden visibility, capture, all navigation controls, playback, match selection and incident links', async ({
  page,
}) => {
  const workers: string[] = [];
  const errors: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/replay');
  await upload(page);
  await expect(page.getByLabel('Ply slider')).toHaveValue('0');
  const board = page.getByRole('list', { name: '暗棋棋盤，八列四欄' });
  await expect(board.getByRole('button', { name: /，暗棋$/ })).toHaveCount(32);
  await assertBoardGeometry(page);
  const moves = page.getByRole('region', { name: 'Move list', exact: true });
  await expect(moves).not.toContainText('翻棋');
  await expect(page.getByText('EV scores: Not recorded.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Source changed during/)).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByLabel('Ply slider')).toHaveValue('1');
  await expect(board.getByRole('button', { name: /紅方帥/ })).toHaveCount(1);
  await expect(board.locator('.replay-flip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(board.getByRole('button', { name: /，暗棋$/ })).toHaveCount(32);
  await jump(page, 33);
  await expect(board.locator('.replay-capture')).toHaveCount(1);
  await expect(board.locator('.replay-from')).toHaveCount(1);
  await expect(moves).toContainText('CAPTURE (MOVE)');
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.getByLabel('Ply slider')).toHaveValue('94');
  await expect(
    page.getByText('Position result: DRAW · NO_PROGRESS', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByLabel('Ply slider')).toHaveValue('0');
  await page.getByLabel('Ply slider').fill('34');
  await expect(page.getByLabel('Ply slider')).toHaveValue('34');
  await page.getByRole('button', { name: 'Go to ply 5', exact: true }).click();
  await expect(page.getByLabel('Ply slider')).toHaveValue('5');
  await page.getByLabel('Playback speed').selectOption('200');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(async () => Number(await page.getByLabel('Ply slider').inputValue()))
    .toBeGreaterThan(6);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await page.getByLabel('Ply slider').inputValue();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.getByLabel('Match', { exact: true }).selectOption('1');
  await expect(page.getByLabel('Ply slider')).toHaveValue('0');
  await expect(page).toHaveURL(/leg=1/);
  await page.getByLabel('Deck seed', { exact: true }).fill('70000');
  await page.getByLabel('Leg', { exact: true }).selectOption('0');
  await page.getByLabel('Incident ply', { exact: true }).fill('33');
  await page.getByRole('button', { name: 'Go to incident' }).click();
  await expect(page).toHaveURL(/seed=70000&leg=0&ply=33/);
  await expect(page.getByLabel('Ply slider')).toHaveValue('33');
  expect(Number(paused)).toBeGreaterThan(6);
  expect(workers.some((url) => url.includes('agent.worker'))).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath('desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(board).toBeVisible();
  await assertBoardGeometry(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('mobile.png'),
    fullPage: true,
  });
  await page.reload();
  await upload(page);
  await expect(page.getByLabel('Ply slider')).toHaveValue('33');
});

test('rejects malformed/incompatible transcripts at their exact failing ply', async ({ page }) => {
  await page.goto('/replay');
  await upload(page, { schemaVersion: 2 });
  await expect(page.getByRole('alert')).toContainText('Expected schemaVersion');
  const incompatible = structuredClone(tournament);
  incompatible.manifest.coreRevision = 'wrong';
  await upload(page, incompatible);
  await expect(page.getByRole('alert')).toContainText('stopped at ply 0');
  await expect(page.locator('.board')).toHaveCount(0);
  const invalid = structuredClone(tournament);
  invalid.matches[0]!.report.actions = [
    ...invalid.matches[0]!.report.actions.slice(0, 2),
    { playerId: 'P1', action: { type: 'FLIP', position: 0 } },
    ...invalid.matches[0]!.report.actions.slice(3),
  ];
  await upload(page, invalid);
  await expect(page.getByRole('alert')).toContainText('stopped at ply 3');
  await expect(page.getByRole('alert')).toContainText('INVALID_FLIP');
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.getByLabel('Ply slider')).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
});

test('imports a real 100-game benchmark and seeks a known incident without mounting AI', async ({
  page,
}) => {
  await page.goto('/replay?seed=70000&leg=0&ply=6');
  const started = Date.now();
  await page
    .getByLabel('Tournament JSON')
    .setInputFiles('benchmark-results/tactical-6a-vs-progress-6b-20261112-221918.json');
  await expect(page.getByLabel('Match', { exact: true }).locator('option')).toHaveCount(101);
  await expect(page.getByLabel('Ply slider')).toHaveValue('6');
  const importAndSelectMs = Date.now() - started;
  const workerImport = await page.getByText(/100 matches · worker import/).textContent();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.replay-capture')).toHaveCount(1);
  const seekStarted = Date.now();
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.getByLabel('Ply slider')).toHaveValue('349');
  await expect(
    page.getByText('Position result: DRAW · NO_PROGRESS', { exact: true }),
  ).toBeVisible();
  expect(
    await page.getByRole('region', { name: 'Move list', exact: true }).locator('li').count(),
  ).toBeLessThanOrEqual(80);
  await test.info().attach('replay-benchmark.json', {
    body: JSON.stringify({
      browser: test.info().project.name,
      importAndSelectMs,
      workerImport,
      seekToEndMs: Date.now() - seekStarted,
      matches: 100,
      selectedPlies: 349,
    }),
    contentType: 'application/json',
  });
});
