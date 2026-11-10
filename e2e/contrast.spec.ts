import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { contrastRatio } from '../verification/contrast';
import { cellsFor, playActions, startGame } from './support';
import { shortFixture } from '../verification/fixtures';

test('rendered text, essential control borders, and focus meet contrast thresholds', async ({
  page,
  browser,
}, testInfo) => {
  const measurements: { stage: string; kind: string; label: string; ratio: number }[] = [];
  async function collect(stage: string) {
    const colors = await page.evaluate(() => {
      function background(element: Element | null): string {
        if (element === null) return 'rgb(255, 255, 255)';
        const color = getComputedStyle(element).backgroundColor;
        if (color === 'transparent' || color === 'rgba(0, 0, 0, 0)')
          return background(element.parentElement);
        return color;
      }
      const root = document.querySelector('dialog[open]') ?? document.body;
      const visible = [...root.querySelectorAll('*')].filter(
        (element) =>
          element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible',
      );
      const text = visible
        .filter((element) =>
          [...element.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          ),
        )
        .map((element) => ({
          label: element.textContent!.trim().slice(0, 50),
          color: getComputedStyle(element).color,
          background: background(element),
        }));
      const borders = visible
        .filter((element) =>
          element.matches('.square, .game-button:not(:disabled), .start-button, .review-step'),
        )
        .map((element) => ({
          label: element.getAttribute('aria-label') ?? element.textContent!.trim(),
          color: getComputedStyle(element).borderColor,
          fill: background(element),
          background: background(element.parentElement),
        }));
      return { text, borders };
    });
    measurements.push(
      ...colors.text.map((sample) => ({
        stage,
        kind: 'text',
        label: sample.label,
        ratio: contrastRatio(sample.color, sample.background),
      })),
      ...colors.borders.map((sample) => ({
        stage,
        kind: 'border',
        label: sample.label,
        ratio: Math.max(
          contrastRatio(sample.color, sample.background),
          contrastRatio(sample.fill, sample.background),
        ),
      })),
    );
  }
  await page.goto('/');
  await collect('welcome');
  await startGame(page);
  await collect('hidden board');
  await cellsFor(page).nth(0).click();
  await cellsFor(page).nth(16).click();
  await cellsFor(page).nth(0).click();
  await cellsFor(page).nth(5).click();
  await collect('revealed board');
  await page.getByRole('button', { name: /棋譜 ·/ }).click();
  await collect('history');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '重新開始', exact: true }).click();
  await collect('restart');
  await page.keyboard.press('Escape');
  await cellsFor(page).nth(0).focus();
  const focus = await cellsFor(page)
    .nth(0)
    .evaluate((element) => ({
      color: getComputedStyle(element).outlineColor,
      background: getComputedStyle(element.closest('.board')!).backgroundColor,
    }));
  measurements.push({
    stage: 'keyboard focus',
    kind: 'focus',
    label: 'board cell outline',
    ratio: contrastRatio(focus.color, focus.background),
  });
  await startGame(page, shortFixture.deck);
  await playActions(page, shortFixture.completed);
  await page.getByRole('button', { name: '覆盤', exact: true }).click();
  await collect('full Review history');
  await writeFile(testInfo.outputPath('contrast.json'), JSON.stringify(measurements, null, 2));
  await writeFile(
    testInfo.outputPath('environment.json'),
    JSON.stringify(
      {
        project: testInfo.project.name,
        browser: browser.version(),
        userAgent: await page.evaluate(() => navigator.userAgent),
      },
      null,
      2,
    ),
  );
  for (const sample of measurements)
    expect(sample.ratio, JSON.stringify(sample)).toBeGreaterThanOrEqual(
      sample.kind === 'text' ? 4.5 : 3,
    );
});
