import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { getLegalActions, getObservation } from '../packages/game-core/src/index';
import { arrangedInitial } from '../packages/game-core/tests/public-projection-fixtures';
import { rebasedLegacy, sacrifice } from '../packages/ai-agents/tests/ai51-fixtures';
import {
  hiddenTacticalFixture,
  profitableFixture,
} from '../packages/ai-agents/tests/tactical-fixtures';
import type { WorkerDecisionRequest, WorkerDecisionResponse } from '../apps/web/src/ai/protocol';

test('real tactical Worker opening, hidden middlegame and endgame latency with live animation frames', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        (window as unknown as { tacticalWorkerUrl: string }).tacticalWorkerUrl = String(args[0]);
        return Reflect.construct(target, args);
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('你的順序').selectOption('P2');
  await page.getByLabel('AI 策略').selectOption('tactical-6a');
  await page.getByRole('button', { name: '開始人機對弈' }).click();
  await expect(page.getByRole('status')).toContainText('輪到你（玩家二）');
  const fixtures = [
    ['opening', arrangedInitial([])],
    ['hidden-tactics', hiddenTacticalFixture()],
    ['rebased-sacrifice', rebasedLegacy(sacrifice)],
    ['revealed-endgame', profitableFixture()],
  ] as const;
  const inputs = fixtures.map(([name, fixture]) => ({
    name,
    input: {
      observation: getObservation(fixture.state),
      legalActions: getLegalActions(fixture.state, fixture.state.currentPlayer),
      publicHistory: fixture.history,
      perspective: fixture.state.currentPlayer,
    },
  }));
  const measurements = await page.evaluate(async (inputs) => {
    const url = (window as unknown as { tacticalWorkerUrl: string }).tacticalWorkerUrl;
    const measurements: {
      name: string;
      policyMs: number[];
      roundTripMs: number[];
      paintedFrames: number;
    }[] = [];
    for (const fixture of inputs) {
      const policyMs: number[] = [],
        roundTripMs: number[] = [];
      let active = true,
        frames = 0;
      function tick() {
        if (active) {
          frames += 1;
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
      for (let seed = 0; seed < 6; seed += 1) {
        const request: WorkerDecisionRequest = {
          type: 'CHOOSE_ACTION',
          agent: 'tactical-6a',
          seed,
          input: fixture.input,
          token: {
            generation: 1,
            revision: seed,
            requestId: seed + 1,
            playerId: fixture.input.perspective,
          },
        };
        const worker = new Worker(url, { type: 'module' });
        const started = performance.now();
        const response = await new Promise<WorkerDecisionResponse>((resolve, reject) => {
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error('Worker deadline exceeded.'));
          }, 10000);
          worker.onerror = () => {
            clearTimeout(timer);
            worker.terminate();
            reject(new Error('Worker error.'));
          };
          worker.onmessage = (event: MessageEvent<WorkerDecisionResponse>) => {
            clearTimeout(timer);
            worker.terminate();
            resolve(event.data);
          };
          worker.postMessage(request);
        });
        roundTripMs.push(performance.now() - started);
        if (response.type !== 'ACTION') throw new Error('Agent failed.');
        if (
          !fixture.input.legalActions.some(
            (action) => JSON.stringify(action) === JSON.stringify(response.action),
          )
        )
          throw new Error('Illegal action.');
        policyMs.push(response.durationMs);
      }
      active = false;
      measurements.push({ name: fixture.name, policyMs, roundTripMs, paintedFrames: frames });
    }
    return measurements;
  }, inputs);
  for (const fixture of measurements) {
    expect(fixture.policyMs).toHaveLength(6);
    expect(fixture.paintedFrames).toBeGreaterThan(0);
  }
  await writeFile(
    testInfo.outputPath('tactical-worker-latency.json'),
    JSON.stringify(
      {
        browser: testInfo.project.name,
        samplesPerPosition: 6,
        measurements,
        note: 'Desktop browser engines, not physical phone evidence; samples are too few to estimate tail latency reliably.',
      },
      null,
      2,
    ),
  );
});
