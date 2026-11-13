import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { replayFixture } from '../apps/web/tests/replay-fixtures';

test('offline diagnostic attachment is fingerprint-bound, follows reached ply, and never runs AI', async ({
  page,
}) => {
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));
  const report = JSON.stringify(replayFixture().tournament);
  await page.goto('/replay');
  await page.getByLabel('Tournament JSON', { exact: true }).setInputFiles({
    name: 'test.json',
    mimeType: 'application/json',
    buffer: Buffer.from(report),
  });
  await expect(page.getByLabel('Ply slider')).toHaveValue('0');
  const trace = {
    schema: 'ai-search-diagnostics-v1',
    mode: 'diagnostic-only',
    reportSha256: createHash('sha256').update(report).digest('hex'),
    sourceStableDuringRun: false,
    traces: [
      {
        seed: 70000,
        leg: 0,
        actionPly: 1,
        agreesWithRecorded: true,
        evaluationSource: 'test fixture evaluator',
        roots: [{ action: { type: 'FLIP', position: 0 }, orderingScore: 0, retained: true }],
      },
    ],
  };
  const upload = async (value: unknown) =>
    page.getByLabel('Offline trace JSON', { exact: true }).setInputFiles({
      name: 'trace.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(value)),
    });
  await upload(trace);
  const panel = page.getByRole('region', { name: 'Offline search diagnostics', exact: true });
  await expect(panel).toContainText('Not recorded.');
  await expect(panel).not.toContainText('test fixture evaluator');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(panel).toContainText('test fixture evaluator');
  await expect(page.getByText('EV scores: Not recorded.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(panel).not.toContainText('test fixture evaluator');
  await upload({ ...trace, reportSha256: '0'.repeat(64) });
  await expect(panel).toContainText('does not match');
  await upload({ schema: 'bad' });
  await expect(panel).toContainText('Unsupported');
  expect(workers.every((w) => w.includes('replay.worker'))).toBe(true);
});
