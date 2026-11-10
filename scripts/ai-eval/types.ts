import type { AgentInput, GameAgent } from '../../packages/ai-agents/src/index';
import type { AcceptedAction } from '../../apps/web/src/game/reconstruct';
import type {
  ActionEvent,
  GameAction,
  GameResult,
  GameState,
  Piece,
  PlayerId,
} from '../../packages/game-core/src/index';

export interface MatchOptions {
  readonly deckSeed: number;
  readonly agentSeed: number;
  readonly agents: Readonly<Record<PlayerId, GameAgent>>;
  readonly initialDeck?: readonly Piece[];
  readonly agentConfiguration?: Readonly<Record<PlayerId, string>>;
}

export interface DecisionRequest {
  readonly requestId: number;
  readonly generation: number;
  readonly revision: number;
  readonly playerId: PlayerId;
  readonly input: AgentInput;
  readonly seed: number;
}

export interface DecisionResponse {
  readonly requestId: number;
  readonly generation: number;
  readonly revision: number;
  readonly playerId: PlayerId;
  readonly action: GameAction;
}

export interface MatchError {
  readonly code:
    | 'STALE_RESPONSE'
    | 'NO_PENDING_REQUEST'
    | 'MISMATCHED_RESPONSE'
    | 'INVALID_ACTION'
    | 'AGENT_ERROR'
    | 'RUNNER_ERROR';
  readonly message: string;
}

export type CommitResult =
  | { readonly ok: true; readonly event: ActionEvent }
  | { readonly ok: false; readonly error: MatchError };

export interface MatchSnapshot {
  readonly initialDeck: readonly Piece[];
  readonly state: GameState;
  readonly actions: readonly AcceptedAction[];
  readonly publicHistory: readonly ActionEvent[];
  readonly generation: number;
  readonly revision: number;
}

export type MatchOutcome =
  | { readonly type: 'COMPLETED'; readonly result: GameResult }
  | { readonly type: 'FAILED'; readonly error: MatchError }
  | { readonly type: 'TRUNCATED'; readonly reason: 'PLY_LIMIT' };

export interface MatchMetadata {
  readonly coreRevision: string;
  readonly deckSeed: number;
  readonly agentSeed: number;
  readonly randomAlgorithm: 'mulberry32-v1';
  readonly decisionSeedAlgorithm: string;
  readonly initialization: 'SEEDED_SHUFFLE' | 'EXPLICIT_DECK';
  readonly agentConfiguration: Readonly<Record<PlayerId, string>>;
  readonly maxPlies: number;
  readonly environment: {
    readonly node: string;
    readonly platform: string;
    readonly arch: string;
  };
}

export interface DecisionMetric {
  readonly playerId: PlayerId;
  readonly ply: number;
  readonly durationMs: number;
  readonly status: 'ACCEPTED' | 'INVALID_ACTION' | 'AGENT_ERROR' | 'RUNNER_ERROR' | 'REJECTED';
}

// Trusted artifact: includes the private deck and final state. Never pass to a policy.
export interface MatchReport {
  readonly metadata: MatchMetadata;
  readonly initialDeck: readonly Piece[];
  readonly actions: readonly AcceptedAction[];
  readonly publicHistory: readonly ActionEvent[];
  readonly finalState: GameState;
  readonly outcome: MatchOutcome;
  readonly decisions: readonly DecisionMetric[];
}
