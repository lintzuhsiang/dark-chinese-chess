/** Small predeclared feature ablations. Reuse AI-2 matches, manifests and replay. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  explainTacticalDecision,
  explainProgressDecision,
  evaluatePosition,
  getProgressState,
  countPublicPositionReturns,
  type TacticalDecision,
} from '../../packages/ai-agents/src/index';
import {
  applyAction,
  createInitialState,
  getObservation,
} from '../../packages/game-core/src/index';
import { runTournament, formatTournamentSummary } from './tournament';
import { verifyReplay } from './match';
import { percentile } from './statistics';
import { tacticalDescriptor } from './tactical-descriptor';
import type { EvaluatedAgent, TournamentReport } from './tournament-types';

function audit(report: TournamentReport) {
  const metrics = () => ({
    flips: 0,
    captures: 0,
    quietMoves: 0,
    lateFlips: 0,
    returns: 0,
    ledGames: 0,
    ledWins: 0,
    noProgressDraws: 0,
    hiddenAtDraw: [] as number[],
  });
  const sides = { A: metrics(), B: metrics() };
  for (const match of report.matches) {
    if (!match.report) continue;
    const verified = verifyReplay(match.report);
    if (!verified.ok) throw Error(verified.error);
    const initial = createInitialState(match.report.initialDeck);
    if (!initial.ok) throw Error(initial.error.code);
    let state = initial.state;
    const history = [];
    const leading = new Set<'A' | 'B'>();
    for (const accepted of match.report.actions) {
      const side = match.seats[accepted.playerId];
      const input = {
        observation: getObservation(state),
        publicHistory: history,
        perspective: accepted.playerId,
      };
      if (evaluatePosition(input).material.raw >= 2) leading.add(side);
      sides[side].returns += countPublicPositionReturns(input) > 0 ? 1 : 0;
      if (accepted.action.type === 'FLIP') {
        sides[side].flips++;
        if (getProgressState(input).quietPlies >= 40) sides[side].lateFlips++;
      } else if (state.board[accepted.action.to] !== null) sides[side].captures++;
      else sides[side].quietMoves++;
      const next = applyAction(state, accepted.playerId, accepted.action);
      if (!next.ok) throw Error(next.error.code);
      state = next.state;
      history.push(next.event);
    }
    for (const side of leading) {
      sides[side].ledGames++;
      if (state.result?.type === 'WIN' && match.seats[state.result.winner] === side)
        sides[side].ledWins++;
    }
    if (state.result?.type === 'DRAW' && state.result.reason === 'NO_PROGRESS') {
      for (const side of ['A', 'B'] as const) {
        sides[side].noProgressDraws++;
        sides[side].hiddenAtDraw.push(state.board.filter((s) => s && !s.revealed).length);
      }
    }
  }
  return sides;
}

async function main() {
  const phase = process.argv[2] ?? '6b-pilot';
  const schedule =
    phase === '6b-pilot'
      ? { start: 62000, count: 1 }
      : phase === '6b-heldout'
        ? { start: 62100, count: 4 }
        : null;
  if (!schedule) throw Error('Use 6b-pilot or 6b-heldout.');
  const directory = resolve('benchmark-results/ai6bc-v4');
  const path = resolve(directory, phase + '.json');
  if (existsSync(path)) throw Error('Refusing to overwrite ' + path);
  const samples: Record<'A' | 'B', TacticalDecision['diagnostics'][]> = { A: [], B: [] };
  function descriptor(side: 'A' | 'B'): EvaluatedAgent {
    const base = tacticalDescriptor(side === 'A' ? 'progress-6b' : 'frozen-tactical-6a', {
      async chooseAction(input, options) {
        const decision =
          side === 'A'
            ? explainProgressDecision(input, options)
            : explainTacticalDecision(input, options);
        samples[side].push(decision.diagnostics);
        return decision.selectedAction;
      },
    });
    return {
      ...base,
      implementation: side === 'A' ? 'progress-6b-v1' : base.implementation,
      configuration: { ...base.configuration, progress: side === 'A' },
      sourcePaths: [...base.sourcePaths, 'packages/ai-agents/src/progress-agent.ts'],
    };
  }
  const report = await runTournament({
    agents: { A: descriptor('A'), B: descriptor('B') },
    deckSeeds: Array.from({ length: schedule.count }, (_, i) => schedule.start + i),
    agentSeed: 20261112,
    maxPlies: 512,
  });
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const latency = (side: 'A' | 'B') => {
    const values = report.matches.flatMap((m) =>
      (m.report?.decisions ?? [])
        .filter((d) => m.seats[d.playerId] === side)
        .map((d) => d.durationMs),
    );
    return {
      samples: values.length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
    };
  };
  const coverage = (side: 'A' | 'B') => ({
    samples: samples[side].length,
    depths: Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((depth) => [
        depth,
        samples[side].filter((d) => d.completedDepth === depth).length,
      ]),
    ),
    projections: samples[side].reduce((n, d) => n + d.projections, 0),
    budgetExhaustions: samples[side].filter((d) => d.budgetExhausted).length,
  });
  const analysis = {
    phase,
    coreRevision: report.manifest.coreRevision,
    summary: report.summary,
    replayed: report.matches.filter((m) => m.report !== null).length,
    stable: report.manifest.sourceStableDuringRun,
    metrics: audit(report),
    latency: { A: latency('A'), B: latency('B') },
    coverage: { A: coverage('A'), B: coverage('B') },
    notes: [
      'Lead conversion denominator counts games where the acting agent held a material lead of at least one Soldier; it is not proof of a forced win.',
      'Returns count decisions at a repeated public position, not an extra draw rule.',
    ],
  };
  writeFileSync(
    resolve(directory, phase + '-analysis.json'),
    JSON.stringify(analysis, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(formatTournamentSummary(report));
  console.log(JSON.stringify(analysis, null, 2));
  if (!analysis.stable || report.summary.completedGames !== report.summary.attemptedGames)
    process.exitCode = 2;
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
