import { describe, expect, it } from 'vitest';
import { randomAgent } from '../../../packages/ai-agents/src/index';
import type { GameAgent } from '../../../packages/ai-agents/src/index';
import { CORE_REVISION } from '../baseline';
import { runMatch, verifyReplay } from '../match';
import { deriveDecisionSeed } from '../seeds';

describe('versioned decision seeds', () => {
  // Reference vectors independently calculated with Python's hmac/hashlib.
  it.each([
    [0, 'P1', 0, 1772395944],
    [0, 'P2', 1, 3997431822],
    [9017, 'P1', 0, 859607958],
    [9017, 'P2', 1, 1694444363],
    [0xffffffff, 'P2', 500, 4048366677],
  ] as const)('matches HMAC vector %i / %s / %i', (root, player, ply, expected) => {
    expect(deriveDecisionSeed(root, player, ply)).toBe(expected);
  });

  it.each([-1, 0.5, 0x100000000, NaN, Infinity])('rejects invalid root %s', (root) => {
    expect(() => deriveDecisionSeed(root, 'P1', 0)).toThrow(RangeError);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid ply %s',
    (ply) => {
      expect(() => deriveDecisionSeed(0, 'P1', ply)).toThrow(RangeError);
    },
  );
});

describe('trusted match execution failures', () => {
  it('retains the accepted prefix when an Agent later proposes an illegal action', async () => {
    let calls = 0;
    const faulty: GameAgent = {
      async chooseAction(input) {
        calls += 1;
        return calls === 1 ? input.legalActions[0]! : { type: 'FLIP', position: 32 };
      },
    };
    const report = await runMatch({
      deckSeed: 17,
      agentSeed: 29,
      agents: { P1: faulty, P2: faulty },
      agentConfiguration: { P1: 'qa-illegal-v1', P2: 'qa-illegal-v1' },
    });
    expect(report.outcome).toMatchObject({ type: 'FAILED', error: { code: 'INVALID_ACTION' } });
    expect(report.actions).toHaveLength(1);
    expect(report.publicHistory).toHaveLength(1);
    expect(report.finalState.plyCount).toBe(1);
    expect(report.finalState.result).toBeNull();
    expect(report.metadata).toMatchObject({
      coreRevision: CORE_REVISION,
      randomAlgorithm: 'mulberry32-v1',
      decisionSeedAlgorithm: 'hmac-sha256-u32le-v1',
      environment: { node: process.version, platform: process.platform, arch: process.arch },
    });
    expect(verifyReplay(report)).toEqual({ ok: true });
    expect(
      verifyReplay({
        ...report,
        metadata: { ...report.metadata, coreRevision: 'incorrect-revision' },
      }).ok,
    ).toBe(false);
  });

  it.each([-1, 0.5, NaN, Infinity])('rejects invalid administrative cap %s', async (maxPlies) => {
    await expect(
      runMatch({
        deckSeed: 0,
        agentSeed: 1,
        agents: { P1: randomAgent, P2: randomAgent },
        maxPlies,
      }),
    ).rejects.toThrow(RangeError);
  });
});
