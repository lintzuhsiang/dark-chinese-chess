import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { AgentInput, GameAgent } from '../../../packages/ai-agents/src/index';
import { randomAgent } from '../../../packages/ai-agents/src/index';
import type { GameResult, PlayerId } from '../../../packages/game-core/src/index';
import { CORE_REVISION } from '../baseline';
import { runMatch, verifyReplay } from '../match';
import { summarizeTournament } from '../metrics';
import { deriveDecisionSeed, derivePairSeed } from '../seeds';
import { runTournament } from '../tournament';
import type {
  EvaluatedAgent,
  FailureCategory,
  TournamentMatch,
  TournamentOptions,
} from '../tournament-types';
import type { DecisionMetric, MatchReport } from '../types';

function descriptor(id: string, policy: GameAgent = randomAgent): EvaluatedAgent {
  return {
    id,
    implementation: 'qa-random-v1',
    configuration: {},
    sourcePaths: ['packages/ai-agents/src/random-agent.ts'],
    policy,
  };
}

function options(
  agents = { A: descriptor('random-A'), B: descriptor('random-B') },
): TournamentOptions {
  return { agents, deckSeeds: [1543], agentSeed: 7 };
}

function metric(
  playerId: PlayerId,
  durationMs: number,
  status: DecisionMetric['status'] = 'ACCEPTED',
): DecisionMetric {
  return { playerId, ply: 0, durationMs, status };
}

// Synthetic records deliberately separate accounting from actual gameplay.
// Full-state currentPlayer is misleading; stored GameResult and seat maps are the oracle.
function accountingFixture(
  base: MatchReport,
  pairIndex: number,
  leg: 0 | 1,
  outcome: GameResult | FailureCategory,
  decisions: readonly DecisionMetric[] = [],
): TournamentMatch {
  const seats = leg === 0 ? ({ P1: 'A', P2: 'B' } as const) : ({ P1: 'B', P2: 'A' } as const);
  const result = typeof outcome === 'string' ? null : outcome;
  const failure = typeof outcome === 'string' ? { category: outcome, message: 'QA fixture' } : null;
  const executionOutcome =
    result !== null
      ? { type: 'COMPLETED' as const, result }
      : outcome === 'TRUNCATED'
        ? { type: 'TRUNCATED' as const, reason: 'PLY_LIMIT' as const }
        : {
            type: 'FAILED' as const,
            error: {
              code:
                outcome === 'INVALID_ACTION'
                  ? ('INVALID_ACTION' as const)
                  : outcome === 'AGENT_EXCEPTION'
                    ? ('AGENT_ERROR' as const)
                    : ('RUNNER_ERROR' as const),
              message: 'QA fixture',
            },
          };
  return {
    pairIndex,
    leg,
    seats,
    deckSeed: 100 + pairIndex,
    agentSeed: 700 + pairIndex,
    gameLength: (pairIndex * 2 + leg + 1) * 10,
    gameResult: result,
    scoreA:
      result === null ? null : result.type === 'DRAW' ? 0.5 : seats[result.winner] === 'A' ? 1 : 0,
    failure,
    report: {
      ...structuredClone(base),
      finalState: {
        ...structuredClone(base.finalState),
        status: result === null ? 'ACTIVE' : 'FINISHED',
        currentPlayer: result?.type === 'WIN' ? result.winner : 'P1',
        result,
      },
      outcome: executionOutcome,
      decisions,
    },
  };
}

describe('independent tournament accounting oracle', () => {
  it('keeps incomplete games visible and separates game and complete-pair denominators', async () => {
    const base = await runMatch({
      deckSeed: 1,
      agentSeed: 2,
      agents: { P1: randomAgent, P2: randomAgent },
      maxPlies: 0,
    });
    const winP1 = { type: 'WIN', winner: 'P1', reason: 'NO_PIECES' } as const;
    const winP2 = { type: 'WIN', winner: 'P2', reason: 'NO_LEGAL_ACTION' } as const;
    const draw = { type: 'DRAW', reason: 'NO_PROGRESS' } as const;
    const matches = [
      accountingFixture(base, 0, 0, winP1, [metric('P1', 1), metric('P2', 9)]),
      accountingFixture(base, 0, 1, winP1, [metric('P1', 3), metric('P2', 7)]),
      accountingFixture(base, 1, 0, draw),
      accountingFixture(base, 1, 1, winP2),
      accountingFixture(base, 2, 0, winP2),
      accountingFixture(base, 2, 1, 'INVALID_ACTION', [metric('P2', 4, 'INVALID_ACTION')]),
      accountingFixture(base, 3, 0, 'AGENT_EXCEPTION', [metric('P1', 11, 'AGENT_ERROR')]),
      accountingFixture(base, 3, 1, 'RUNNER_INVARIANT'),
      accountingFixture(base, 4, 0, 'TRUNCATED'),
      accountingFixture(base, 4, 1, 'TRUNCATED'),
    ];
    const summary = summarizeTournament(matches);
    expect(summary).toMatchObject({
      attemptedGames: 10,
      completedGames: 5,
      attemptedPairs: 5,
      completedPairs: 2,
      averageGameLength: 55,
      scores: {
        A: { wins: 2, draws: 1, losses: 2, averageScore: 0.5 },
        B: { wins: 2, draws: 1, losses: 2, averageScore: 0.5 },
      },
      paired: { samples: 2, averageScoreA: 0.625 },
      failures: { INVALID_ACTION: 1, AGENT_EXCEPTION: 1, RUNNER_INVARIANT: 1, TRUNCATED: 2 },
      performance: {
        totalDecisions: 6,
        illegalActions: 1,
        agentErrors: 1,
        budgetOverruns: null,
        byAgent: {
          A: { decisions: 4, p50Ms: 4, p95Ms: 11, illegalActions: 1, agentErrors: 1 },
          B: { decisions: 2, p50Ms: 3, p95Ms: 9, illegalActions: 0, agentErrors: 0 },
        },
      },
    });
    expect(matches).toHaveLength(10);
  });

  it('rejects duplicate legs, mismatched paired seeds, and contradictory score records', async () => {
    const base = await runMatch({
      deckSeed: 1,
      agentSeed: 2,
      agents: { P1: randomAgent, P2: randomAgent },
      maxPlies: 0,
    });
    const result = { type: 'WIN', winner: 'P1', reason: 'NO_PIECES' } as const;
    const first = accountingFixture(base, 0, 0, result);
    const second = accountingFixture(base, 0, 1, result);
    expect(() => summarizeTournament([first, first])).toThrow();
    expect(() => summarizeTournament([first, { ...second, deckSeed: 300 }])).toThrow();
    expect(() => summarizeTournament([first, { ...second, agentSeed: 900 }])).toThrow();
    expect(() => summarizeTournament([{ ...first, scoreA: 0 }])).toThrow();
  });

  it('reports empty and entirely unscored tournaments without inventing draws or NaN', () => {
    const summary = summarizeTournament([]);
    expect(summary).toMatchObject({
      attemptedGames: 0,
      completedGames: 0,
      attemptedPairs: 0,
      completedPairs: 0,
      scores: {
        A: { wins: 0, draws: 0, losses: 0, averageScore: null },
        B: { wins: 0, draws: 0, losses: 0, averageScore: null },
      },
      paired: { samples: 0, averageScoreA: null, lower: null, upper: null },
      performance: {
        totalDecisions: 0,
        byAgent: { A: { p50Ms: null, p95Ms: null }, B: { p50Ms: null, p95Ms: null } },
      },
    });
    expect(JSON.stringify(summary)).not.toMatch(/NaN|Infinity/);
  });
});

describe('independent tournament scheduling and trust boundary', () => {
  it('swaps Agents while preserving each deck and seat-level random schedule', async () => {
    const calls: { competitor: string; input: AgentInput; seed: number; keys: string[] }[] = [];
    const recorder = (competitor: string): GameAgent => ({
      async chooseAction(input, decisionOptions) {
        calls.push({
          competitor,
          input,
          seed: decisionOptions.seed,
          keys: Object.keys(decisionOptions),
        });
        return randomAgent.chooseAction(input, decisionOptions);
      },
    });
    const report = await runTournament({
      ...options({ A: descriptor('A', recorder('A')), B: descriptor('B', recorder('B')) }),
      maxPlies: 4,
    });
    expect(report.matches).toHaveLength(2);
    const first = report.matches[0]!;
    const second = report.matches[1]!;
    expect(first.seats).toEqual({ P1: 'A', P2: 'B' });
    expect(second.seats).toEqual({ P1: 'B', P2: 'A' });
    expect(first.report?.initialDeck).toEqual(second.report?.initialDeck);
    expect(first.agentSeed).toBe(derivePairSeed(7, 0));
    expect(second.agentSeed).toBe(first.agentSeed);
    expect(calls.map((call) => call.competitor)).toEqual(['A', 'B', 'A', 'B', 'B', 'A', 'B', 'A']);
    for (const [index, call] of calls.entries()) {
      expect(call.keys).toEqual(['seed']);
      expect(call.seed).toBe(
        deriveDecisionSeed(first.agentSeed, call.input.perspective, index % 4),
      );
      expect(Object.keys(call.input).sort()).toEqual([
        'legalActions',
        'observation',
        'perspective',
        'publicHistory',
      ]);
      expect(call.input.publicHistory).toHaveLength(index % 4);
      expect(JSON.stringify(call.input)).not.toMatch(
        /deckSeed|agentSeed|masterSeed|"id"|initialDeck|positionCounts/,
      );
    }
    expect(calls[0]!.input.observation.playerColors).toEqual({ P1: null, P2: null });
    for (const match of report.matches) {
      expect(match.report).not.toBeNull();
      if (!match.report) throw new Error('Expected retained match report.');
      expect(verifyReplay(match.report)).toEqual({ ok: true });
      expect(match.gameResult).toBeNull();
      expect(match.scoreA).toBeNull();
      expect(match.failure?.category).toBe('TRUNCATED');
    }
    expect(report.summary).toMatchObject({
      attemptedGames: 2,
      completedGames: 0,
      attemptedPairs: 1,
      completedPairs: 0,
      failures: { TRUNCATED: 2 },
    });
  });

  it('finishes reproducible paired games with complementary scores for identical seeded policies', async () => {
    const first = await runTournament(options());
    const second = await runTournament(options());
    expect(first.summary.completedGames).toBe(2);
    expect(first.summary.completedPairs).toBe(1);
    expect(first.summary.paired).toMatchObject({
      samples: 1,
      averageScoreA: 0.5,
      lower: 0,
      upper: 1,
    });
    expect(first.matches.map((match) => match.report?.actions)).toEqual(
      second.matches.map((match) => match.report?.actions),
    );
    expect(first.matches.map((match) => match.gameResult)).toEqual(
      second.matches.map((match) => match.gameResult),
    );
    expect(first.matches.map((match) => match.scoreA)).toEqual(
      second.matches.map((match) => match.scoreA),
    );
    for (const match of first.matches) {
      if (!match.report) throw new Error('Completed match report missing.');
      expect(match.report.finalState.result).toEqual(match.gameResult);
      expect(verifyReplay(match.report)).toEqual({ ok: true });
    }
    expect(first.matches[0]!.report?.initialDeck).toEqual(first.matches[1]!.report?.initialDeck);
    const parsed: unknown = JSON.parse(JSON.stringify(first));
    expect(parsed).toBeTypeOf('object');
    expect(JSON.stringify(first.manifest)).toContain(CORE_REVISION);
    expect(JSON.stringify(first.manifest)).toContain('sha256');
    expect(first.manifest.git.head).toMatch(/^[a-f0-9]{40}$/);
    expect(first.manifest.runner.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      first.manifest.source.files.some((file) => file.path === 'packages/game-core/src/index.ts'),
    ).toBe(true);
    expect(first.manifest.seedSchedule).toMatchObject({
      deckSeeds: [1543],
      agentSeedRoot: 7,
      pairAgentSeeds: [derivePairSeed(7, 0)],
    });
    for (const archived of first.manifest.source.untrackedFiles) {
      const actualHash = createHash('sha256')
        .update(Buffer.from(archived.contentBase64, 'base64'))
        .digest('hex');
      expect(actualHash).toBe(archived.sha256);
      expect(first.manifest.source.files).toContainEqual({
        path: archived.path,
        sha256: archived.sha256,
      });
    }
  });

  it('retains invalid actions, Agent exceptions, and unexpected runner failures as separate categories', async () => {
    const invalid: GameAgent = {
      async chooseAction() {
        return { type: 'FLIP', position: 32 };
      },
    };
    const exception: GameAgent = {
      async chooseAction() {
        throw new Error('QA Agent exception');
      },
    };
    const first = await runTournament(
      options({
        A: descriptor('invalid', invalid),
        B: descriptor('exception', exception),
      }),
    );
    expect(first.matches.map((match) => match.failure?.category)).toEqual([
      'INVALID_ACTION',
      'AGENT_EXCEPTION',
    ]);
    expect(first.summary).toMatchObject({
      attemptedGames: 2,
      completedGames: 0,
      attemptedPairs: 1,
      completedPairs: 0,
      scores: { A: { draws: 0, averageScore: null }, B: { draws: 0, averageScore: null } },
      performance: { totalDecisions: 2, illegalActions: 1, agentErrors: 1 },
    });
    const unexpected: GameAgent = {
      async chooseAction() {
        return Object.defineProperty({ type: 'FLIP' as const, position: 0 }, 'type', {
          get() {
            throw new Error('QA unexpected commit failure');
          },
        });
      },
    };
    const second = await runTournament(
      options({
        A: descriptor('unexpected', unexpected),
        B: descriptor('invalid', invalid),
      }),
    );
    expect(second.matches.map((match) => match.failure?.category)).toEqual([
      'RUNNER_INVARIANT',
      'INVALID_ACTION',
    ]);
    expect(second.matches.every((match) => match.report !== null)).toBe(true);
    expect(second.summary.failures.RUNNER_INVARIANT).toBe(1);
  });

  it('rejects repeated deck blocks before attempting a statistically ambiguous schedule', async () => {
    await expect(runTournament({ ...options(), deckSeeds: [3, 3] })).rejects.toThrow();
  });

  it('rejects directory-declared Agent sources rather than hashing an empty set', async () => {
    const agent = { ...descriptor('directory-agent'), sourcePaths: ['packages/ai-agents/src'] };
    await expect(
      runTournament({
        ...options({ A: agent, B: descriptor('file-agent') }),
        maxPlies: 0,
      }),
    ).rejects.toThrow();
  });

  it.each([NaN, Infinity, -Infinity])(
    'rejects configuration value %s that JSON would misidentify as null',
    async (value) => {
      const invalid = { ...descriptor('invalid-config'), configuration: { parameter: value } };
      await expect(
        runTournament({
          ...options({ A: invalid, B: descriptor('valid-config') }),
          maxPlies: 0,
        }),
      ).rejects.toThrow();
    },
  );
});
