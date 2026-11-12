import {
  DEFAULT_HEURISTIC_CONFIGURATION,
  DEFAULT_SEARCH_LIMITS,
  tacticalAgent,
  type GameAgent,
} from '../../packages/ai-agents/src/index';
import type { EvaluatedAgent } from './tournament-types';

export function tacticalDescriptor(id: string, policy: GameAgent = tacticalAgent): EvaluatedAgent {
  return {
    id,
    implementation: 'selective-expectiminimax-6a-v1',
    configuration: {
      search: { ...DEFAULT_SEARCH_LIMITS },
      pieceValues: { ...DEFAULT_HEURISTIC_CONFIGURATION.pieceValues },
      weights: { ...DEFAULT_HEURISTIC_CONFIGURATION.weights },
      chanceModel: 'all-positive-public-inventory-outcomes-v1',
      ordering: 'win-recapture-defense-capture-threat-ev-v1',
      rootReserves: 'best-ev-and-best-flip-plus-all-terminal-actions',
      fallback: 'unchanged-exact-ev-completed-iterations-only',
    },
    sourcePaths: [
      'packages/ai-agents/src/tactical-agent.ts',
      'packages/ai-agents/src/tactical-search.ts',
      'packages/ai-agents/src/expected-value-agent.ts',
      'packages/ai-agents/src/heuristic-evaluation.ts',
      'packages/ai-agents/src/hidden-piece-distribution.ts',
      'packages/ai-agents/src/seeded-random.ts',
      'packages/game-core/src/public-projection.ts',
    ],
    policy,
  };
}
