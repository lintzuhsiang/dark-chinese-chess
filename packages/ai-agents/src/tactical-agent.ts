import { resolveHeuristicConfiguration, type HeuristicConfiguration } from './heuristic-evaluation';
import { resolveSearchLimits, searchPublicPosition, type SearchLimits } from './tactical-search';
import type { AgentInput, GameAgent } from './types';

export interface TacticalAgentConfiguration {
  readonly search?: Partial<SearchLimits>;
  readonly evaluation?: HeuristicConfiguration;
}

export function explainTacticalDecision(
  input: AgentInput,
  options: { readonly seed: number },
  configuration: TacticalAgentConfiguration = {},
) {
  return searchPublicPosition(input, options, configuration.search, configuration.evaluation);
}

export function createTacticalAgent(configuration: TacticalAgentConfiguration = {}): GameAgent {
  const search = resolveSearchLimits(configuration.search);
  const evaluation = resolveHeuristicConfiguration(configuration.evaluation);
  return {
    async chooseAction(input, options) {
      return searchPublicPosition(input, options, search, evaluation).selectedAction;
    },
  };
}
export const tacticalAgent: GameAgent = createTacticalAgent();
