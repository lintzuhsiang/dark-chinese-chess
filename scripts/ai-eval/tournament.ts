import { assertCoreBaseline } from './baseline';
import { captureManifest, finalizeManifest } from './manifest';
import { runMatch } from './match';
import { scoreAFromResult, summarizeTournament } from './metrics';
import { derivePairSeed } from './seeds';
import { pairedConfidence } from './statistics';
import type {
  Competitor,
  EvaluatedAgent,
  TournamentMatch,
  TournamentOptions,
  TournamentReport,
} from './tournament-types';
import type { MatchReport } from './types';

function assertJsonValue(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (
    typeof value !== 'object' ||
    value === null ||
    (!Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    ancestors.has(value)
  ) {
    throw new TypeError('Agent configuration must contain only finite, acyclic JSON-safe values.');
  }
  ancestors.add(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    assertJsonValue(entry, ancestors);
  }
  ancestors.delete(value);
}

function snapshotAgent(agent: EvaluatedAgent): EvaluatedAgent {
  if (!agent.id.trim() || !agent.implementation.trim() || agent.sourcePaths.length === 0) {
    throw new Error('Agents require nonempty identity, implementation, and source paths.');
  }
  if (
    agent.configuration === null ||
    Array.isArray(agent.configuration) ||
    typeof agent.configuration !== 'object'
  ) {
    throw new TypeError('Agent configuration must be a JSON-safe object.');
  }
  assertJsonValue(agent.configuration);
  return {
    id: agent.id,
    implementation: agent.implementation,
    configuration: structuredClone(agent.configuration),
    sourcePaths: [...agent.sourcePaths],
    policy: { chooseAction: agent.policy.chooseAction.bind(agent.policy) },
  };
}

function completedRecord(
  report: MatchReport,
  setup: Pick<TournamentMatch, 'pairIndex' | 'leg' | 'deckSeed' | 'agentSeed' | 'seats'>,
): TournamentMatch {
  const common = { ...setup, report, gameLength: report.actions.length };
  if (report.outcome.type === 'COMPLETED') {
    const gameResult = report.outcome.result;
    return {
      ...common,
      gameResult,
      scoreA: scoreAFromResult({ gameResult, seats: setup.seats }),
      failure: null,
    };
  }
  if (report.outcome.type === 'TRUNCATED') {
    return {
      ...common,
      gameResult: null,
      scoreA: null,
      failure: { category: 'TRUNCATED', message: 'Administrative accepted-ply limit reached.' },
    };
  }
  const category =
    report.outcome.error.code === 'INVALID_ACTION'
      ? 'INVALID_ACTION'
      : report.outcome.error.code === 'AGENT_ERROR'
        ? 'AGENT_EXCEPTION'
        : 'RUNNER_INVARIANT';
  return {
    ...common,
    gameResult: null,
    scoreA: null,
    failure: { category, message: report.outcome.error.message },
  };
}

export async function runTournament(options: TournamentOptions): Promise<TournamentReport> {
  assertCoreBaseline();
  const deckSeeds = [...options.deckSeeds];
  if (
    deckSeeds.length === 0 ||
    deckSeeds.some((seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
  ) {
    throw new RangeError('Provide at least one unsigned 32-bit deck seed.');
  }
  if (new Set(deckSeeds).size !== deckSeeds.length) {
    throw new Error(
      'Deck seeds must be distinct; repeated openings require a separate clustering policy.',
    );
  }
  const agentSeed = options.agentSeed;
  derivePairSeed(agentSeed, 0);
  const maxPlies = options.maxPlies ?? 4096;
  if (!Number.isSafeInteger(maxPlies) || maxPlies < 0) throw new RangeError('Invalid maxPlies.');
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  pairedConfidence([], confidenceLevel);
  const agents = { A: snapshotAgent(options.agents.A), B: snapshotAgent(options.agents.B) };
  if (agents.A.id === agents.B.id) throw new Error('Competitor IDs must be distinct.');
  const capturedOptions = { agents, deckSeeds, agentSeed, maxPlies, confidenceLevel };
  const manifest = captureManifest(capturedOptions);
  const matches: TournamentMatch[] = [];
  for (const [pairIndex, deckSeed] of deckSeeds.entries()) {
    const pairSeed = derivePairSeed(agentSeed, pairIndex);
    for (const leg of [0, 1] as const) {
      const seats: Readonly<Record<'P1' | 'P2', Competitor>> =
        leg === 0 ? { P1: 'A', P2: 'B' } : { P1: 'B', P2: 'A' };
      const setup = { pairIndex, leg, deckSeed, agentSeed: pairSeed, seats };
      try {
        const report = await runMatch({
          deckSeed,
          agentSeed: pairSeed,
          maxPlies,
          agents: { P1: agents[seats.P1].policy, P2: agents[seats.P2].policy },
          agentConfiguration: { P1: agents[seats.P1].id, P2: agents[seats.P2].id },
        });
        matches.push(completedRecord(report, setup));
      } catch (cause) {
        matches.push({
          ...setup,
          report: null,
          gameLength: 0,
          gameResult: null,
          scoreA: null,
          failure: {
            category: 'RUNNER_INVARIANT',
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
      }
    }
  }
  function descriptor(agent: EvaluatedAgent): Omit<EvaluatedAgent, 'policy'> {
    const { id, implementation, configuration, sourcePaths } = agent;
    return { id, implementation, configuration, sourcePaths };
  }
  return {
    schemaVersion: 1,
    configuration: {
      agents: { A: descriptor(agents.A), B: descriptor(agents.B) },
      deckSeeds,
      agentSeed,
      maxPlies,
      confidenceLevel,
    },
    manifest: finalizeManifest(manifest),
    matches,
    summary: summarizeTournament(matches, confidenceLevel),
  };
}

export function formatTournamentSummary(report: TournamentReport): string {
  const { summary } = report;
  const paired = summary.paired;
  const average = summary.scores.A.averageScore;
  const interval =
    paired.lower === null || paired.upper === null
      ? 'unavailable'
      : `[${paired.lower.toFixed(3)}, ${paired.upper.toFixed(3)}]`;
  const pairedMean = paired.averageScoreA === null ? 'unscored' : paired.averageScoreA.toFixed(3);
  function latency(competitor: Competitor): string {
    const { p50Ms, p95Ms } = summary.performance.byAgent[competitor];
    return p50Ms === null || p95Ms === null
      ? 'unavailable'
      : `${p50Ms.toFixed(3)}/${p95Ms.toFixed(3)}`;
  }
  return [
    `Games: ${summary.completedGames}/${summary.attemptedGames} completed; pairs: ${summary.completedPairs}/${summary.attemptedPairs}`,
    `A (${report.configuration.agents.A.id}) W/D/L: ${summary.scores.A.wins}/${summary.scores.A.draws}/${summary.scores.A.losses}; average: ${average === null ? 'unscored' : average.toFixed(3)}`,
    `Paired mean A: ${pairedMean}; ${(paired.confidenceLevel * 100).toFixed(1)}% CI: ${interval}; pair observations: ${paired.samples}`,
    `Agent decisions: ${summary.performance.totalDecisions}; illegal actions: ${summary.performance.illegalActions}; Agent errors: ${summary.performance.agentErrors}`,
    `Agent latency p50/p95 ms: A=${latency('A')}; B=${latency('B')}`,
    `Failures/truncations: ${Object.entries(summary.failures)
      .map(([category, count]) => `${category}=${count}`)
      .join(', ')}`,
  ].join('\n');
}
