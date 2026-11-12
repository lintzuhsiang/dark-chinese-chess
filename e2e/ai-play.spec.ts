import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { GameAction } from '../packages/game-core/src/types';
import { deriveDecisionSeed } from '../scripts/ai-eval/seeds';
import { fixtureDeck, shortFixture, shuffleSamples } from '../verification/fixtures';
import { cellsFor } from './support';

async function startAi(page: Page, seat = 'P1', agent = 'expected-value', deck = fixtureDeck()) {
  await page.goto('/');
  await page.evaluate((samples) => {
    let cursor = 0;
    Math.random = () => samples[cursor++] ?? 1 - Number.EPSILON;
  }, shuffleSamples(deck));
  await page.getByLabel('你的順序').selectOption(seat);
  await page.getByLabel('AI 策略').selectOption(agent);
  await page.getByRole('button', { name: '開始人機對弈' }).click();
}

type BrowserRequest = import('../apps/web/src/ai/protocol').WorkerDecisionRequest;
type BrowserResponse = import('../apps/web/src/ai/protocol').WorkerDecisionResponse;
type AuditWindow = Window & {
  aiWorkerAudit: {
    requests: BrowserRequest[];
    responses: BrowserResponse[];
    terminated: number;
    roundTrips: number[];
  };
};

async function trackWorkers(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (array: Uint32Array) => {
        array.fill(7);
        return array;
      },
    });
    const audit = {
      requests: [] as BrowserRequest[],
      responses: [] as BrowserResponse[],
      terminated: 0,
      roundTrips: [] as number[],
    };
    (window as unknown as AuditWindow).aiWorkerAudit = audit;
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        const post = worker.postMessage.bind(worker);
        const terminate = worker.terminate.bind(worker);
        let started = 0;
        worker.postMessage = (message: BrowserRequest) => {
          audit.requests.push(structuredClone(message));
          started = performance.now();
          post(message);
        };
        worker.terminate = () => {
          audit.terminated += 1;
          terminate();
        };
        worker.addEventListener('message', (event: MessageEvent<BrowserResponse>) => {
          audit.responses.push(structuredClone(event.data));
          audit.roundTrips.push(performance.now() - started);
        });
        return worker;
      },
    });
  });
}

type MockWindow = Window & {
  aiMock: {
    requests: BrowserRequest[];
    entries: {
      request?: BrowserRequest;
      terminated: boolean;
      port: {
        onmessage: ((event: MessageEvent<unknown>) => void) | null;
        onerror: ((event: { preventDefault: () => void }) => void) | null;
      };
    }[];
  };
};

async function mockWorkers(page: Page) {
  await page.addInitScript(() => {
    const audit: MockWindow['aiMock'] = { requests: [], entries: [] };
    (window as unknown as MockWindow).aiMock = audit;
    window.Worker = function () {
      const entry: MockWindow['aiMock']['entries'][number] = {
        terminated: false,
        port: { onmessage: null, onerror: null },
      };
      const port = {
        onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
        onerror: null as ((event: { preventDefault: () => void }) => void) | null,
        onmessageerror: null,
        postMessage(request: BrowserRequest) {
          entry.request = structuredClone(request);
          audit.requests.push(entry.request);
        },
        terminate() {
          entry.terminated = true;
        },
      };
      entry.port = port;
      audit.entries.push(entry);
      return port;
    } as unknown as typeof Worker;
  });
}

async function requestCount(page: Page, count: number) {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as MockWindow).aiMock.requests.length))
    .toBe(count);
}
async function deliver(page: Page, index: number, action?: GameAction) {
  await page.evaluate(
    ({ index, action }) => {
      const entry = (window as unknown as MockWindow).aiMock.entries[index]!;
      const request = entry.request!;
      entry.port.onmessage?.(
        new MessageEvent('message', {
          data: {
            type: 'ACTION',
            token: request.token,
            action: action ?? request.input.legalActions[0],
            durationMs: 1,
          },
        }),
      );
    },
    { index, action },
  );
}

test('setup remains readable on a narrow screen with both seats and all strategies', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.getByLabel('你的順序')).toHaveValue('P1');
  await expect(page.getByLabel('AI 策略')).toHaveValue('expected-value');
  await expect(page.getByLabel('AI 策略').locator('option')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const label of ['你的順序', 'AI 策略']) {
    const box = await page.getByLabel(label).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: testInfo.outputPath('setup.png'), fullPage: true });
});

for (const agent of ['expected-value', 'heuristic', 'random', 'safety-tie-1', 'tactical-6a']) {
  test(`real ${agent} Worker responds to human actions with only public inputs`, async ({
    page,
  }, testInfo) => {
    await trackWorkers(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await startAi(page, 'P1', agent);
    await cellsFor(page).nth(0).click();
    await expect(page.getByRole('button', { name: '棋譜 · 2', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('輪到你（玩家一）');
    await expect(page.getByRole('button', { name: '悔棋', exact: true })).toBeDisabled();
    await page.locator('.board .hidden').first().click();
    await expect(page.getByRole('button', { name: '棋譜 · 4', exact: true })).toBeVisible();
    const audit = await page.evaluate(() => (window as unknown as AuditWindow).aiWorkerAudit);
    expect(audit.requests).toHaveLength(2);
    expect(audit.responses).toHaveLength(2);
    expect(audit.terminated).toBe(2);
    for (const request of audit.requests) {
      expect(request.seed).toBe(
        deriveDecisionSeed(7, request.token.playerId, request.input.publicHistory.length),
      );
      expect(Object.keys(request).sort()).toEqual(['agent', 'input', 'seed', 'token', 'type']);
      expect(Object.keys(request.input).sort()).toEqual([
        'legalActions',
        'observation',
        'perspective',
        'publicHistory',
      ]);
      expect(JSON.stringify(request)).not.toMatch(
        /"id"|initialDeck|agentSeed|positionCounts|noProgressCount/,
      );
      for (const square of request.input.observation.board) {
        if (square.kind === 'HIDDEN') expect(Object.keys(square)).toEqual(['kind']);
        if (square.kind === 'REVEALED')
          expect(Object.keys(square.piece).sort()).toEqual(['color', 'rank']);
      }
    }
    expect(await page.locator('main').innerHTML()).not.toMatch(/RED-|BLACK-|initialDeck|data-id/);
    await writeFile(
      testInfo.outputPath('ai-worker-metrics.json'),
      JSON.stringify(
        {
          agent,
          browser: testInfo.project.name,
          requests: audit.requests.length,
          policyMs: audit.responses.map((r) => r.durationMs),
          roundTripMs: audit.roundTrips,
        },
        null,
        2,
      ),
    );
    await page.screenshot({ path: testInfo.outputPath('human-vs-ai.png') });
  });
}

test('AI opens as P1 when the human chooses P2, assigning opposite colors', async ({ page }) => {
  await trackWorkers(page);
  await startAi(page, 'P2');
  await expect(page.getByRole('button', { name: '棋譜 · 1', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('輪到你（玩家二）');
  await expect(page.getByText('尚未分色')).toHaveCount(0);
  const audit = await page.evaluate(() => (window as unknown as AuditWindow).aiWorkerAudit);
  expect(audit.requests[0]!.input.perspective).toBe('P1');
  expect(audit.requests[0]!.input.observation.playerColors).toEqual({ P1: null, P2: null });
  expect(await page.locator('.assignment.red').count()).toBe(1);
  expect(await page.locator('.assignment.black').count()).toBe(1);
});

test('blocks pending human input and duplicate/stale replies across restart and mode changes', async ({
  page,
}) => {
  await mockWorkers(page);
  await startAi(page);
  await cellsFor(page).nth(0).click();
  await requestCount(page, 1);
  await expect(cellsFor(page).nth(1)).toBeDisabled();
  await page
    .locator('.board button')
    .nth(1)
    .evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await expect(page.getByRole('button', { name: '棋譜 · 1', exact: true })).toBeVisible();
  await deliver(page, 0, { type: 'FLIP', position: 1 });
  await expect(page.getByRole('button', { name: '棋譜 · 2', exact: true })).toBeVisible();
  await deliver(page, 0, { type: 'FLIP', position: 1 });
  await cellsFor(page).nth(2).click();
  await requestCount(page, 2);
  await page.getByRole('button', { name: '重新開始', exact: true }).click();
  await page.getByRole('button', { name: '確定重新開始', exact: true }).click();
  await deliver(page, 1, { type: 'FLIP', position: 3 });
  await expect(page.getByRole('button', { name: '棋譜 · 0', exact: true })).toBeVisible();
  await expect(page.locator('.board .hidden')).toHaveCount(32);
  await cellsFor(page).nth(4).click();
  await requestCount(page, 3);
  await deliver(page, 1, { type: 'FLIP', position: 3 });
  await expect(cellsFor(page).nth(5)).toBeDisabled();
  await deliver(page, 2, { type: 'FLIP', position: 5 });
  await expect(page.getByRole('button', { name: '棋譜 · 2', exact: true })).toBeVisible();
  await cellsFor(page).nth(6).click();
  await requestCount(page, 4);
  await page.getByRole('button', { name: '回到選單', exact: true }).click();
  await page.getByRole('button', { name: '確定回到選單', exact: true }).click();
  await deliver(page, 3, { type: 'FLIP', position: 7 });
  await page.getByRole('button', { name: '本機雙人', exact: true }).click();
  await cellsFor(page).nth(0).click();
  await expect(page.getByRole('button', { name: '悔棋', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '悔棋', exact: true }).click();
  await expect(page.getByRole('button', { name: '棋譜 · 0', exact: true })).toBeVisible();
});

for (const failure of ['runtime', 'timeout', 'malformed']) {
  test(`pauses on ${failure} and retries the same public input/seed with a fresh request`, async ({
    page,
  }) => {
    await mockWorkers(page);
    await startAi(page, 'P2');
    await requestCount(page, 1);
    if (failure === 'timeout') {
      await page.clock.install();
      // Reissue after installing the clock so this timer is controlled.
      await page.getByRole('button', { name: '重新開始', exact: true }).click();
      await page.getByRole('button', { name: '確定重新開始', exact: true }).click();
      await requestCount(page, 2);
      await page.clock.fastForward(10001);
    } else if (failure === 'runtime') {
      await page.evaluate(() =>
        (window as unknown as MockWindow).aiMock.entries[0]!.port.onerror?.({
          preventDefault() {},
        }),
      );
    } else {
      await page.evaluate(() =>
        (window as unknown as MockWindow).aiMock.entries[0]!.port.onmessage?.(
          new MessageEvent('message', { data: { invalid: true } }),
        ),
      );
    }
    await expect(page.getByRole('button', { name: '重試 AI', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('暫停');
    await expect(page.getByRole('button', { name: '棋譜 · 0', exact: true })).toBeVisible();
    const count = failure === 'timeout' ? 2 : 1;
    await page.getByRole('button', { name: '重試 AI', exact: true }).click();
    await requestCount(page, count + 1);
    const requests = await page.evaluate(() => (window as unknown as MockWindow).aiMock.requests);
    expect(requests[count]!.seed).toBe(requests[count - 1]!.seed);
    expect(requests[count]!.input).toEqual(requests[count - 1]!.input);
    expect(requests[count]!.token.requestId).toBeGreaterThan(requests[count - 1]!.token.requestId);
    await deliver(page, count);
    if (failure === 'timeout') await page.clock.runFor(1200);
    await expect(page.getByRole('button', { name: '棋譜 · 1', exact: true })).toBeVisible();
    await deliver(page, count - 1);
    await expect(page.getByRole('button', { name: '棋譜 · 1', exact: true })).toBeVisible();
  });
}

test('completes an AI-mode game and keeps terminal Review read-only without more requests', async ({
  page,
}) => {
  await mockWorkers(page);
  await startAi(page, 'P1', 'expected-value', shortFixture.deck);
  let requests = 0;
  for (const [index, action] of shortFixture.completed.entries()) {
    if (index % 2 === 1) {
      await requestCount(page, ++requests);
      await deliver(page, requests - 1, action);
    } else if (action.type === 'FLIP') await cellsFor(page).nth(action.position).click();
    else {
      await cellsFor(page).nth(action.from).click();
      await cellsFor(page).nth(action.to).click();
    }
    await expect(
      page.getByRole('button', { name: `棋譜 · ${index + 1}`, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByRole('status')).toContainText('和棋');
  await page.getByRole('button', { name: '覆盤', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('第 0/66 手');
  await expect(cellsFor(page).nth(0)).toBeDisabled();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await requestCount(page, requests);
  await page.getByRole('button', { name: '結束覆盤', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('和棋');
});

test('keeps main-thread controls responsive while a Worker is busy', async ({ page }) => {
  await page.route('**/agent.worker-*.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `onmessage = ({data}) => { const start = performance.now(); while (performance.now() - start < 1500) {} postMessage({type:'ACTION',token:data.token,action:data.input.legalActions[0],durationMs:performance.now()-start}); };`,
    }),
  );
  await startAi(page, 'P2');
  await expect(page.getByRole('status')).toContainText('AI 思考中');
  await page.getByRole('button', { name: '回到選單', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '棋譜 · 1', exact: true })).toBeVisible();
});

async function freezePresentationClock(page: Page) {
  await page.clock.install();
  const freezeAt = await page.evaluate(() => Date.now() + 1000);
  await page.clock.pauseAt(freezeAt);
}

async function activate(page: Page, name: string) {
  await page
    .getByRole('button', { name, exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
}

test('fast AI results preserve visible human FLIP, CAPTURE, and MOVE dwell before committing', async ({
  page,
}) => {
  await mockWorkers(page);
  await page.addInitScript(() =>
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (array: Uint32Array) => {
        array.fill(0);
        return array;
      },
    }),
  );
  await startAi(
    page,
    'P1',
    'expected-value',
    fixtureDeck([
      [0, 'RED', 'CHARIOT'],
      [1, 'BLACK', 'SOLDIER'],
      [4, 'BLACK', 'HORSE'],
    ]),
  );
  await freezePresentationClock(page);
  const cells = cellsFor(page);
  // Native activation avoids Playwright actionability rAFs advancing this test's
  // deliberately frozen presentation clock. Real keyboard/touch paths have separate tests.
  const cell = (position: number) =>
    cells.nth(position).evaluate((button) => (button as HTMLButtonElement).click());
  for (const [index, human, ai, beforeDeadline] of [
    [0, [{ type: 'FLIP', position: 0 }], { type: 'FLIP', position: 1 }, 400],
    [1, [{ type: 'MOVE', from: 0, to: 1 }], { type: 'FLIP', position: 4 }, 350],
    [2, [{ type: 'MOVE', from: 1, to: 0 }], { type: 'FLIP', position: 2 }, 250],
  ] as const) {
    for (const action of human) {
      if (action.type === 'FLIP') await cell(action.position);
      else {
        await cell(action.from);
        await cell(action.to);
      }
    }
    await requestCount(page, index + 1);
    await page.clock.runFor(50); // Both paint-opportunity frames happen here.
    await deliver(page, index, ai);
    await expect(
      page.getByRole('button', { name: `棋譜 · ${index * 2 + 1}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('status')).toContainText('AI 思考中');
    expect(
      await page.evaluate(
        (i) => (window as unknown as MockWindow).aiMock.entries[i]!.terminated,
        index,
      ),
    ).toBe(true);
    await page.clock.runFor(beforeDeadline);
    await expect(
      page.getByRole('button', { name: `棋譜 · ${index * 2 + 1}`, exact: true }),
    ).toBeVisible();
    await page.clock.runFor(200);
    await expect(
      page.getByRole('button', { name: `棋譜 · ${index * 2 + 2}`, exact: true }),
    ).toBeVisible();
    await deliver(page, index, ai); // A duplicate cannot present a second action.
    await expect(
      page.getByRole('button', { name: `棋譜 · ${index * 2 + 2}`, exact: true }),
    ).toBeVisible();
  }
});

for (const change of ['restart', 'mode']) {
  test(`cancels an already-computed AI proposal during presentation wait on ${change}`, async ({
    page,
  }) => {
    await mockWorkers(page);
    await page.addInitScript(() =>
      Object.defineProperty(crypto, 'getRandomValues', {
        value: (array: Uint32Array) => {
          array.fill(0);
          return array;
        },
      }),
    );
    await startAi(page);
    await freezePresentationClock(page);
    await cellsFor(page)
      .nth(0)
      .evaluate((button) => (button as HTMLButtonElement).click());
    await requestCount(page, 1);
    await page.clock.runFor(50);
    await deliver(page, 0, { type: 'FLIP', position: 1 });
    await expect(page.getByRole('button', { name: '棋譜 · 1', exact: true })).toBeVisible();
    if (change === 'restart') {
      await activate(page, '重新開始');
      await activate(page, '確定重新開始');
    } else {
      await activate(page, '回到選單');
      await activate(page, '確定回到選單');
      await activate(page, '本機雙人');
    }
    await page.clock.runFor(2000);
    await deliver(page, 0, { type: 'FLIP', position: 1 });
    await expect(page.getByRole('button', { name: '棋譜 · 0', exact: true })).toBeVisible();
    await expect(page.locator('.board .hidden')).toHaveCount(32);
  });
}
