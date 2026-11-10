import { describe, expect, it } from 'vitest';
import type { GameAgent } from '../../../packages/ai-agents/src/index';
import { randomAgent } from '../../../packages/ai-agents/src/index';
import { verifyReplay } from '../match';
import { runTournament } from '../tournament';
import type { EvaluatedAgent, TournamentOptions } from '../tournament-types';

function descriptor(id: string, policy: GameAgent = randomAgent): EvaluatedAgent {
  return {
    id,
    implementation: 'random-agent-v1',
    configuration: {},
    sourcePaths: ['packages/ai-agents/src/random-agent.ts'],
    policy,
  };
}

function options(): TournamentOptions {
  return {
    agents: { A: descriptor('random-a'), B: descriptor('random-b') },
    deckSeeds: [11, 29],
    agentSeed: 71,
    maxPlies: 6,
  };
}

describe('tournament runner integration', () => {
  it('retains every truncated leg and exactly replays each accepted prefix', async () => {
    const report = await runTournament(options());
    expect(report.matches).toHaveLength(4);
    expect(report.summary).toMatchObject({
      attemptedGames: 4,
      completedGames: 0,
      attemptedPairs: 2,
      completedPairs: 0,
      scores: {
        A: { wins: 0, draws: 0, losses: 0, averageScore: null },
        B: { wins: 0, draws: 0, losses: 0, averageScore: null },
      },
      failures: { TRUNCATED: 4 },
      performance: { totalDecisions: 24, illegalActions: 0, agentErrors: 0 },
      paired: { samples: 0, averageScoreA: null, lower: null, upper: null },
    });
    for (const match of report.matches) {
      expect(match.gameLength).toBe(6);
      expect(match.scoreA).toBeNull();
      expect(match.gameResult).toBeNull();
      expect(match.report).not.toBeNull();
      expect(verifyReplay(match.report!)).toEqual({ ok: true });
    }
    expect(() => JSON.parse(JSON.stringify(report))).not.toThrow();
  });

  it('keeps both Agent-exception legs visible and attributes failed decisions to the correct competitor', async () => {
    const throwing: GameAgent = {
      async chooseAction() {
        throw new Error('expected tournament policy failure');
      },
    };
    const report = await runTournament({
      ...options(),
      deckSeeds: [11],
      agents: { A: descriptor('broken', throwing), B: descriptor('random') },
    });
    expect(report.matches.map((match) => match.failure?.category)).toEqual([
      'AGENT_EXCEPTION',
      'AGENT_EXCEPTION',
    ]);
    expect(report.matches.map((match) => match.gameLength)).toEqual([0, 1]);
    expect(report.summary).toMatchObject({
      attemptedGames: 2,
      completedGames: 0,
      attemptedPairs: 1,
      completedPairs: 0,
      failures: { AGENT_EXCEPTION: 2 },
      performance: {
        totalDecisions: 3,
        agentErrors: 2,
        byAgent: { A: { decisions: 2, agentErrors: 2 }, B: { decisions: 1, agentErrors: 0 } },
      },
    });
    expect(report.matches.every((match) => match.gameResult === null)).toBe(true);
  });

  it.each([
    { deckSeeds: [] },
    { deckSeeds: [11, 11] },
    { deckSeeds: [-1] },
    { deckSeeds: [0.5] },
    { deckSeeds: [0x100000000] },
    { agentSeed: -1 },
    { maxPlies: -1 },
    { confidenceLevel: 1 },
    { confidenceLevel: 0 },
  ])('rejects invalid experiment configuration before starting games: %j', async (patch) => {
    await expect(runTournament({ ...options(), ...patch })).rejects.toThrow();
  });

  it('rejects indistinguishable competitor identities', async () => {
    await expect(
      runTournament({
        ...options(),
        agents: { A: descriptor('same'), B: descriptor('same') },
      }),
    ).rejects.toThrow('distinct');
  });

  it.each([
    { value: NaN },
    { value: Infinity },
    { value: undefined },
    { value: new Date(0) },
    { value: () => 1 },
  ])('rejects non-JSON configuration before executing policies: %j', async (configuration) => {
    const invalid = { ...descriptor('invalid'), configuration } as unknown as EvaluatedAgent;
    await expect(
      runTournament({
        ...options(),
        agents: { A: invalid, B: descriptor('random') },
      }),
    ).rejects.toThrow('JSON-safe');
  });

  it('rejects cyclic configuration', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const invalid = {
      ...descriptor('invalid'),
      configuration: cyclic,
    } as unknown as EvaluatedAgent;
    await expect(
      runTournament({
        ...options(),
        agents: { A: invalid, B: descriptor('random') },
      }),
    ).rejects.toThrow('JSON-safe');
  });
});
