import type { GameAgent } from '../../packages/ai-agents/src/index';
import type { GameResult, PlayerId } from '../../packages/game-core/src/index';
import type { BenchmarkManifest } from './manifest';
import type { MatchReport } from './types';

export type Competitor = 'A' | 'B';
export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface EvaluatedAgent {
  readonly id: string;
  readonly implementation: string;
  readonly configuration: Readonly<Record<string, JsonValue>>;
  readonly sourcePaths: readonly string[];
  readonly policy: GameAgent;
}

export interface TournamentOptions {
  readonly agents: Readonly<Record<Competitor, EvaluatedAgent>>;
  readonly deckSeeds: readonly number[];
  readonly agentSeed: number;
  readonly maxPlies?: number;
  readonly confidenceLevel?: number;
}

export type FailureCategory =
  'INVALID_ACTION' | 'AGENT_EXCEPTION' | 'RUNNER_INVARIANT' | 'TRUNCATED';

export interface TournamentMatch {
  readonly pairIndex: number;
  readonly leg: 0 | 1;
  readonly deckSeed: number;
  readonly agentSeed: number;
  readonly seats: Readonly<Record<PlayerId, Competitor>>;
  readonly gameLength: number;
  readonly gameResult: GameResult | null;
  readonly scoreA: number | null;
  readonly failure: { readonly category: FailureCategory; readonly message: string } | null;
  readonly report: MatchReport | null;
}

export interface ScoreSummary {
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly averageScore: number | null;
}

export interface LatencySummary {
  readonly decisions: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly illegalActions: number;
  readonly agentErrors: number;
}

export interface PairedConfidence {
  readonly samples: number;
  readonly averageScoreA: number | null;
  readonly confidenceLevel: number;
  readonly lower: number | null;
  readonly upper: number | null;
  readonly method: 'hoeffding-independent-pairs';
}

export interface TournamentSummary {
  readonly attemptedGames: number;
  readonly completedGames: number;
  readonly attemptedPairs: number;
  readonly completedPairs: number;
  readonly scores: Readonly<Record<Competitor, ScoreSummary>>;
  readonly averageGameLength: number | null;
  readonly performance: {
    readonly totalDecisions: number;
    readonly illegalActions: number;
    readonly agentErrors: number;
    readonly budgetOverruns: null;
    readonly byAgent: Readonly<Record<Competitor, LatencySummary>>;
  };
  readonly failures: Readonly<Record<FailureCategory, number>>;
  readonly paired: PairedConfidence;
}

export interface TournamentReport {
  readonly schemaVersion: 1;
  readonly configuration: {
    readonly agents: Readonly<Record<Competitor, Omit<EvaluatedAgent, 'policy'>>>;
    readonly deckSeeds: readonly number[];
    readonly agentSeed: number;
    readonly maxPlies: number;
    readonly confidenceLevel: number;
  };
  readonly manifest: BenchmarkManifest;
  readonly matches: readonly TournamentMatch[];
  readonly summary: TournamentSummary;
}
