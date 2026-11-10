import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { assertBoardFits, cellsFor } from './support';

test('physical-phone console procedure uses legal UI actions and trusted activations', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  const script = await readFile(new URL('../verification/phone-check.js', import.meta.url), 'utf8');
  await page.evaluate(script);
  // Here trusted browser clicks verify the procedure. This is not a physical-phone result.
  const result = page.evaluate(async () => {
    const run = (
      window as unknown as { runPhoneVerification: (device: string) => Promise<unknown> }
    ).runPhoneVerification;
    return run('automated procedure check; not a physical device');
  });
  async function ready(instruction: string) {
    await page.waitForFunction(
      (expected) =>
        (window as unknown as { phoneVerificationStage: string }).phoneVerificationStage ===
        expected,
      instruction,
    );
  }
  for (const active of [7, 547]) {
    const name = active === 7 ? 'short' : 'long';
    await expect(page.getByRole('button', { name: `棋譜 · ${active}`, exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await assertBoardFits(page); // Also checks a real three-digit live history count on the smallest viewport.
    for (let sample = 0; sample < 5; sample += 1) {
      await ready(
        `${name} ${sample + 1}/5: tap the empty square 第 2 列，第 2 欄 (selected Horse is ready).`,
      );
      await expect(cellsFor(page).nth(4)).toHaveAttribute('aria-pressed', 'true');
      await cellsFor(page).nth(5).click();
      await expect(
        page.getByRole('button', { name: `棋譜 · ${active + 1}`, exact: true }),
      ).toBeVisible();
      await ready(`${name} ${sample + 1}/5: now tap 悔棋.`);
      await page.getByRole('button', { name: '悔棋', exact: true }).click();
      await expect(
        page.getByRole('button', { name: `棋譜 · ${active}`, exact: true }),
      ).toBeVisible();
    }
    const total = active === 7 ? 66 : 607;
    await expect(page.getByRole('button', { name: '最終局面' })).toBeEnabled({ timeout: 30_000 });
    for (let sample = 0; sample < 5; sample += 1) {
      await ready(`${name} Review ${sample + 1}/5: tap 終局.`);
      await page.getByRole('button', { name: '最終局面' }).click();
      if (sample < 4) await expect(page.getByRole('status')).toContainText(`第 0/${total} 手`);
    }
  }
  const report = (await result) as {
    runs: {
      activeActions: number;
      completedActions: number;
      actionMs: number[];
      undoMs: number[];
      reviewMs: number[];
    }[];
  };
  expect(report.runs.map((run) => [run.activeActions, run.completedActions])).toEqual([
    [7, 66],
    [547, 607],
  ]);
  for (const run of report.runs)
    for (const samples of [run.actionMs, run.undoMs, run.reviewMs]) {
      expect(samples).toHaveLength(5);
      expect(samples.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    }
});
