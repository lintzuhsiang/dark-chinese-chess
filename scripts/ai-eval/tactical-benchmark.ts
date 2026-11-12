/** Fixed AI-6A pilot/held-out experiment; delegates matches/provenance to AI-2. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  DEFAULT_HEURISTIC_CONFIGURATION,
  expectedValueAgent,
  explainTacticalDecision,
  type TacticalDecision,
} from '../../packages/ai-agents/src/index';
import {
  applyAction,
  createInitialState,
  getLegalActions,
  type Piece,
} from '../../packages/game-core/src/index';
import { verifyReplay } from './match';
import { percentile } from './statistics';
import { runTournament, formatTournamentSummary } from './tournament';
import { tacticalDescriptor } from './tactical-descriptor';
import type { EvaluatedAgent, TournamentReport } from './tournament-types';
import { replay, sacrifice } from '../../packages/ai-agents/tests/ai51-fixtures';
import { createAgentInput } from './agent-input';

interface Sample {
  readonly ply: number;
  readonly playerId: string;
  diagnostics: TacticalDecision['diagnostics'] | null;
  rootActions: TacticalDecision['rootActions'];
  error: string | null;
}

function audit(report: TournamentReport) {
  const exposure = {
    A: { eligible: 0, immediateCaptureWinAvailable: 0 },
    B: { eligible: 0, immediateCaptureWinAvailable: 0 },
  };
  let replayed = 0;
  for (const match of report.matches) {
    if (match.report === null) continue;
    const verified = verifyReplay(match.report);
    if (!verified.ok) throw new Error(verified.error);
    replayed += 1;
    // Trusted offline oracle only. This state never enters either policy.
    // Reconstruct the initial state through the same authoritative initializer.
    let state = createInitialStateForAudit(match.report.initialDeck);
    for (const accepted of match.report.actions) {
      const applied = applyAction(state, accepted.playerId, accepted.action);
      if (!applied.ok) throw new Error(applied.error.code);
      state = applied.state;
      if (state.status === 'FINISHED') continue;
      const side = match.seats[accepted.playerId];
      exposure[side].eligible += 1;
      const unsafe = getLegalActions(state, state.currentPlayer).some((action) => {
        if (action.type !== 'MOVE' || state.board[action.to] === null) return false;
        const reply = applyAction(state, state.currentPlayer, action);
        if (!reply.ok) throw new Error(reply.error.code);
        return (
          reply.state.result?.type === 'WIN' && reply.state.result.winner === state.currentPlayer
        );
      });
      if (unsafe) exposure[side].immediateCaptureWinAvailable += 1;
    }
  }
  const latency = (side: 'A' | 'B') => {
    const values = report.matches.flatMap((match) =>
      (match.report?.decisions ?? [])
        .filter((decision) => match.seats[decision.playerId] === side)
        .map((decision) => decision.durationMs),
    );
    return {
      samples: values.length,
      p50Ms: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      p99Ms: percentile(values, 0.99),
    };
  };
  return {
    replayed,
    exposure,
    latency: { A: latency('A'), B: latency('B') },
    noProgressDraws: report.matches.filter(
      (match) => match.gameResult?.type === 'DRAW' && match.gameResult.reason === 'NO_PROGRESS',
    ).length,
    notes: [
      'Exposure counts accepted actions leaving an ACTIVE actual successor with a legal immediately winning opponent capture; denominator includes all such accepted actions. It is not a full tactical blunder or ex-ante FLIP risk metric.',
      'Audit runs after the tournament and is excluded from decision latency.',
    ],
  };
}

function createInitialStateForAudit(deck: readonly Piece[]) {
  const initial = createInitialState(deck);
  if (!initial.ok) throw new Error(initial.error.code);
  return initial.state;
}

async function main() {
  const { values } = parseArgs({ options: { phase: { type: 'string', default: 'pilot' } } });
  if (values.phase !== 'pilot' && values.phase !== 'heldout')
    throw new Error('Use --phase pilot or heldout.');
  // Predeclared before observing results; no seed/config selection by win rate.
  const pilot = values.phase === 'pilot';
  const count = pilot ? 2 : 16;
  const start = pilot ? 51000 : 51200;
  const samples: Sample[] = [];
  const policy = {
    async chooseAction(
      input: Parameters<typeof explainTacticalDecision>[0],
      options: { readonly seed: number },
    ) {
      const sample: Sample = {
        ply: input.publicHistory.length,
        playerId: input.perspective,
        diagnostics: null,
        rootActions: [],
        error: null,
      };
      samples.push(sample);
      if (samples.length % 100 === 0) console.log(`Tactical decisions: ${samples.length}`);
      try {
        const decision = explainTacticalDecision(input, options);
        sample.diagnostics = decision.diagnostics;
        sample.rootActions = decision.rootActions;
        return decision.selectedAction;
      } catch (error) {
        sample.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
  };
  const ev: EvaluatedAgent = {
    id: 'frozen-ev',
    implementation: 'expected-value-agent-v1',
    configuration: {
      pieceValues: { ...DEFAULT_HEURISTIC_CONFIGURATION.pieceValues },
      weights: { ...DEFAULT_HEURISTIC_CONFIGURATION.weights },
      flipModel: 'uniform-public-inventory-v1',
      projection: 'core-public-one-step-v1',
      tieBreaking: 'seeded-exact-score-ties',
    },
    sourcePaths: [
      'packages/ai-agents/src/expected-value-agent.ts',
      'packages/ai-agents/src/heuristic-evaluation.ts',
      'packages/ai-agents/src/hidden-piece-distribution.ts',
      'packages/ai-agents/src/seeded-random.ts',
    ],
    policy: expectedValueAgent,
  };
  const report = await runTournament({
    agents: { A: tacticalDescriptor('tactical-6a', policy), B: ev },
    deckSeeds: Array.from({ length: count }, (_, index) => start + index),
    agentSeed: 20261111,
    maxPlies: 1024,
  });
  const directory = resolve('benchmark-results');
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `ai6a-${values.phase}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  // Save raw diagnostics before analysis; preserve failure evidence even if audit fails.
  writeFileSync(
    resolve(directory, `ai6a-${values.phase}-decisions.json`),
    JSON.stringify(samples) + '\n',
  );
  const diagnostics = samples.flatMap((sample) =>
    sample.diagnostics === null ? [] : [sample.diagnostics],
  );
  const depths: Record<string, number> = {};
  for (const value of diagnostics)
    depths[value.completedDepth] = (depths[value.completedDepth] ?? 0) + 1;
  const analysis = {
    phase: values.phase,
    pairs: count,
    deckStart: start,
    sourceDigest: report.manifest.source.digest,
    sourceStableDuringRun: report.manifest.sourceStableDuringRun,
    samples: samples.length,
    depths,
    budgetExhaustions: diagnostics.filter((value) => value.budgetExhausted).length,
    rootAvailable: diagnostics.reduce((sum, value) => sum + value.rootAvailable, 0),
    rootRetained: diagnostics.reduce((sum, value) => sum + value.rootRetained, 0),
    interiorAvailable: diagnostics.reduce((sum, value) => sum + value.interiorAvailable, 0),
    interiorRetained: diagnostics.reduce((sum, value) => sum + value.interiorRetained, 0),
    excludedTacticalActions: diagnostics.reduce(
      (sum, value) => sum + value.excludedTacticalActions,
      0,
    ),
    projections: {
      p50: percentile(
        diagnostics.map((value) => value.projections),
        0.5,
      ),
      p95: percentile(
        diagnostics.map((value) => value.projections),
        0.95,
      ),
      max: Math.max(...diagnostics.map((value) => value.projections)),
    },
    ...audit(report),
  };
  writeFileSync(
    resolve(directory, `ai6a-${values.phase}-analysis.json`),
    JSON.stringify(analysis, null, 2) + '\n',
  );
  const fixture = replay(sacrifice);
  const publicInput = createAgentInput(fixture.state, fixture.history, fixture.state.currentPlayer);
  writeFileSync(
    resolve(directory, 'ai6a-tactical-example.json'),
    JSON.stringify(
      {
        input: publicInput,
        seed: sacrifice.seed,
        decision: explainTacticalDecision(publicInput, { seed: sacrifice.seed }),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(formatTournamentSummary(report));
  console.log(JSON.stringify(analysis, null, 2));
  if (
    !report.manifest.sourceStableDuringRun ||
    report.summary.completedGames !== report.summary.attemptedGames
  )
    process.exitCode = 2;
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
