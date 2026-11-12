import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomAgent, type GameAgent } from '../../../packages/ai-agents/src/index';
import * as matchRunner from '../match';
import { formatTournamentProgress, runTournament } from '../tournament';
import type { EvaluatedAgent, TournamentOptions, TournamentProgress } from '../tournament-types';
import type { MatchOutcome, MatchReport } from '../types';

const descriptor = (id: string, policy: GameAgent = randomAgent): EvaluatedAgent => ({
  id,
  implementation: 'random-agent-v1',
  configuration: {},
  sourcePaths: ['packages/ai-agents/src/random-agent.ts'],
  policy,
});
const options = (): TournamentOptions => ({
  agents: { A: descriptor('a'), B: descriptor('b') },
  deckSeeds: [11],
  agentSeed: 71,
  maxPlies: 0,
});
afterEach(() => vi.restoreAllMocks());

describe('per-game tournament progress', () => {
  it('counts both seats, draws, failures and truncations through the existing summary', async () => {
    const base = (await runTournament(options())).matches[0]!.report!;
    const completed = (winner: 'P1' | 'P2'): MatchOutcome => ({
      type: 'COMPLETED',
      result: { type: 'WIN', winner, reason: 'NO_PIECES' },
    });
    // Mock only the match/accounting boundary, not the Core replay oracle.
    const outcomes: (MatchOutcome | Error)[] = [
      completed('P1'),
      completed('P1'),
      completed('P2'),
      completed('P2'),
      { type: 'COMPLETED', result: { type: 'DRAW', reason: 'NO_PROGRESS' } },
      { type: 'FAILED', error: { code: 'INVALID_ACTION', message: 'invalid' } },
      { type: 'FAILED', error: { code: 'AGENT_ERROR', message: 'agent' } },
      new Error('runner'),
      { type: 'TRUNCATED', reason: 'PLY_LIMIT' },
      { type: 'TRUNCATED', reason: 'PLY_LIMIT' },
    ];
    const run = vi.spyOn(matchRunner, 'runMatch');
    for (const outcome of outcomes) {
      if (outcome instanceof Error) run.mockRejectedValueOnce(outcome);
      else run.mockResolvedValueOnce({ ...base, outcome });
    }
    const events: TournamentProgress[] = [];
    const report = await runTournament(
      { ...options(), deckSeeds: [11, 29, 40, 51, 67] },
      (progress) => {
        events.push(progress);
        expect(Object.isFrozen(progress)).toBe(true);
        expect(Reflect.set(progress, 'wins', 999)).toBe(false);
      },
    );
    expect(events.map((p) => p.processedGames)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(events.every((p) => p.totalGames === 10)).toBe(true);
    expect(events.map((p) => [p.wins, p.draws, p.losses, p.failedGames, p.truncatedGames])).toEqual(
      [
        [1, 0, 0, 0, 0],
        [1, 0, 1, 0, 0],
        [1, 0, 2, 0, 0],
        [2, 0, 2, 0, 0],
        [2, 1, 2, 0, 0],
        [2, 1, 2, 1, 0],
        [2, 1, 2, 2, 0],
        [2, 1, 2, 3, 0],
        [2, 1, 2, 3, 1],
        [2, 1, 2, 3, 2],
      ],
    );
    expect(report.summary.scores.A).toMatchObject({ wins: 2, draws: 1, losses: 2 });
    expect(report.summary.failures).toEqual({
      INVALID_ACTION: 1,
      AGENT_EXCEPTION: 1,
      RUNNER_INVARIANT: 1,
      TRUNCATED: 2,
    });
    expect(formatTournamentProgress(events.at(-1)!)).toBe(
      '已處理 10/10 局 | A 勝/和/負: 2/1/2 | 失敗: 3 | 截斷: 2',
    );
    expect(events[0]!.wins).toBe(1);
  });

  it('notifies before the next game starts and preserves seeded actual games and replays', async () => {
    const off = await runTournament({ ...options(), deckSeeds: [11, 29], maxPlies: 3 });
    const events: TournamentProgress[] = [];
    let started = 0;
    const policy: GameAgent = {
      async chooseAction(input, opts) {
        if (input.publicHistory.length === 0) {
          expect(events).toHaveLength(started);
          started++;
        }
        return randomAgent.chooseAction(input, opts);
      },
    };
    const on = await runTournament(
      {
        ...options(),
        deckSeeds: [11, 29],
        maxPlies: 3,
        agents: { A: descriptor('a', policy), B: descriptor('b', policy) },
      },
      (progress) => events.push(progress),
    );
    expect(started).toBe(4);
    expect(events).toHaveLength(4);
    expect(on.configuration).toEqual(off.configuration);
    const canonical = (report: MatchReport) => ({
      metadata: report.metadata,
      actions: report.actions,
      publicHistory: report.publicHistory,
      initialDeck: report.initialDeck,
      finalState: report.finalState,
      outcome: report.outcome,
      decisions: report.decisions.map(({ durationMs: _, ...decision }) => decision),
    });
    expect(on.matches.map((m) => canonical(m.report!))).toEqual(
      off.matches.map((m) => canonical(m.report!)),
    );
    for (const match of on.matches)
      expect(matchRunner.verifyReplay(match.report!)).toEqual({ ok: true });
    expect(on.summary.scores).toEqual(off.summary.scores);
    expect(on.summary.paired).toEqual(off.summary.paired);
    expect(on.summary.failures).toEqual(off.summary.failures);
    expect(Object.keys(on)).toEqual(Object.keys(off));
  });

  it('does not turn a progress sink exception into an extra failed game', async () => {
    const run = vi.spyOn(matchRunner, 'runMatch');
    await expect(
      runTournament(options(), () => {
        throw new Error('progress sink');
      }),
    ).rejects.toThrow('progress sink');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
