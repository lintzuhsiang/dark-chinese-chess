import { expect, test } from '@playwright/test';

test('production /replay retains the ordinary game and does not load developer tooling', async ({
  page,
}) => {
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.goto('/replay?seed=70000&leg=0&ply=6');
  await expect(page.getByRole('heading', { name: /暗棋/ })).toBeVisible();
  await expect(page.getByText('Tournament Replay Inspector', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Tournament JSON')).toHaveCount(0);
  expect(workers.some((url) => url.includes('replay.worker'))).toBe(false);
});
