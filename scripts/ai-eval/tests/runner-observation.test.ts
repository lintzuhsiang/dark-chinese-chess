import { afterEach, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import * as core from '../../../packages/game-core/src/index';
import type { GameAgent } from '../../../packages/ai-agents/src/index';
import { runMatch } from '../match';

afterEach(() => vi.restoreAllMocks());

describe('Agent-only latency instrumentation', () => {
  it('excludes public-input preparation and Core execution using a controlled clock', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const legal = core.getLegalActions;
    const observation = core.getObservation;
    const apply = core.applyAction;
    vi.spyOn(core, 'getLegalActions').mockImplementation((...args) => {
      clock += 100;
      return legal(...args);
    });
    vi.spyOn(core, 'getObservation').mockImplementation((...args) => {
      clock += 100;
      return observation(...args);
    });
    vi.spyOn(core, 'applyAction').mockImplementation((...args) => {
      clock += 1000;
      return apply(...args);
    });
    const policy: GameAgent = {
      async chooseAction(input) {
        clock += 7;
        return input.legalActions[0]!;
      },
    };
    const report = await runMatch({
      deckSeed: 1,
      agentSeed: 2,
      agents: { P1: policy, P2: policy },
      maxPlies: 1,
    });
    expect(report.decisions).toEqual([
      { playerId: 'P1', ply: 0, durationMs: 7, status: 'ACCEPTED' },
    ]);
    expect(clock).toBe(1207);
  });

  it('records the latency and category of a rejected Promise without a domain result', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const policy: GameAgent = {
      async chooseAction() {
        clock += 11;
        throw new Error('Expected policy exception');
      },
    };
    const report = await runMatch({
      deckSeed: 1,
      agentSeed: 2,
      agents: { P1: policy, P2: policy },
    });
    expect(report.decisions).toEqual([
      { playerId: 'P1', ply: 0, durationMs: 11, status: 'AGENT_ERROR' },
    ]);
    expect(report.outcome).toMatchObject({ type: 'FAILED', error: { code: 'AGENT_ERROR' } });
    expect(report.finalState.result).toBeNull();
  });
});
