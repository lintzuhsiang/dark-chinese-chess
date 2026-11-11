export type { AgentInput, GameAgent } from './types';
export { createSeededRandom } from './seeded-random';
export { randomAgent } from './random-agent';
export {
  DEFAULT_HEURISTIC_CONFIGURATION,
  evaluatePosition,
  resolveHeuristicConfiguration,
} from './heuristic-evaluation';
export type {
  EvaluationBreakdown,
  FeatureBreakdown,
  HeuristicConfiguration,
  HeuristicWeights,
  PositionEvaluationInput,
  ResolvedHeuristicConfiguration,
} from './heuristic-evaluation';
export { createHeuristicAgent, explainDecision, heuristicAgent } from './heuristic-agent';
export type { HeuristicDecision, MoveEvaluation } from './heuristic-agent';
export { getHiddenPieceDistribution } from './hidden-piece-distribution';
export type { HiddenPieceDistribution, HiddenPieceOutcome } from './hidden-piece-distribution';
export {
  createExpectedValueAgent,
  expectedValueAgent,
  explainExpectedValueDecision,
  createSafetyTieAgent,
  safetyTieAgent,
  explainSafetyTieDecision,
} from './expected-value-agent';
export type {
  ExpectedValueActionEvaluation,
  ExpectedValueDecision,
  FlipOutcomeEvaluation,
  SafetyTieCheck,
  SafetyTieDecision,
} from './expected-value-agent';
