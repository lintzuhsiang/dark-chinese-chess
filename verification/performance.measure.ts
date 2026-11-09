import { writeFile } from 'node:fs/promises';
import { arch, cpus, platform } from 'node:os';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { cellsFor, playActions, startGame } from '../e2e/support';
import { longFixture, shortFixture } from './fixtures';

declare global {
  interface Window { verificationSample: number | null }
}

// Installed in the test browser only. Timing starts at click activation and ends
// after an intervening paint (two rAF callbacks), excluding automation RPC time.
async function measure(page: Page, target: Locator): Promise<number> {
  await target.evaluate(element => {
    window.verificationSample = null;
    element.addEventListener('click', () => {
      const started = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => { window.verificationSample = performance.now() - started; }));
    }, { once: true, capture: true });
  });
  await target.click();
  await page.waitForFunction(() => window.verificationSample !== null);
  return page.evaluate(() => window.verificationSample!);
}

const median = (samples: readonly number[]) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;

test('record five-sample production interaction baselines; no timing threshold in CI', async ({ page, browser }, testInfo) => {
  const runs = [];
  for (const [name, fixture] of [['short', shortFixture], ['long', longFixture]] as const) {
    await startGame(page, fixture.deck);
    await playActions(page, fixture.active);
    await expect(page.getByRole('button', { name: `棋譜 · ${fixture.active.length}`, exact: true })).toBeVisible();
    const actionMs: number[] = [];
    const undoMs: number[] = [];
    const reviewMs: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await cellsFor(page).nth(4).click();
      actionMs.push(await measure(page, cellsFor(page).nth(5)));
      await expect(page.getByRole('button', { name: `棋譜 · ${fixture.active.length + 1}`, exact: true })).toBeVisible();
      undoMs.push(await measure(page, page.getByRole('button', { name: '悔棋', exact: true })));
      await expect(page.getByRole('button', { name: `棋譜 · ${fixture.active.length}`, exact: true })).toBeVisible();
    }
    await playActions(page, fixture.completed.slice(fixture.active.length));
    await expect(page.getByRole('status')).toContainText('和棋');
    await page.getByRole('button', { name: '覆盤', exact: true }).click();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      reviewMs.push(await measure(page, page.getByRole('button', { name: '最終局面' })));
      await expect(page.getByRole('status')).toContainText(`第 ${fixture.completed.length}/${fixture.completed.length} 手`);
      await page.getByRole('button', { name: '回到開局' }).click();
    }
    runs.push({ name, activeActions: fixture.active.length, completedActions: fixture.completed.length,
      actionMs, undoMs, reviewMs, medians: { action: median(actionMs), undo: median(undoMs), review: median(reviewMs) } });
  }
  const report = {
    project: testInfo.project.name, browser: browser.version(), userAgent: await page.evaluate(() => navigator.userAgent),
    node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
    viewport: page.viewportSize(), physicalDevice: false, productionBuild: true,
    method: 'click capture listener → two requestAnimationFrame callbacks; five samples; no pass/fail timing assertion', runs,
  };
  await writeFile(testInfo.outputPath('measurements.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
