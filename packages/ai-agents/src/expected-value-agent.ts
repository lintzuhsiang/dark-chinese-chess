import {
  projectPermittedPublicAction,
  type GameAction,
  type PublicPiece,
} from '../../game-core/src/index';
import {
  evaluatePosition,
  resolveHeuristicConfiguration,
  type EvaluationBreakdown,
  type HeuristicConfiguration,
} from './heuristic-evaluation';
import {
  getHiddenPieceDistribution,
  type HiddenPieceDistribution,
} from './hidden-piece-distribution';
import { createSeededRandom } from './seeded-random';
import type { AgentInput, GameAgent } from './types';

export interface FlipOutcomeEvaluation {
  readonly piece: PublicPiece;
  readonly count: number;
  readonly probability: number;
  readonly evaluation: EvaluationBreakdown;
  readonly contribution: number;
}

export type ExpectedValueActionEvaluation =
  | {
      readonly action: Extract<GameAction, { type: 'MOVE' }>;
      readonly expectedScore: number;
      readonly evaluation: EvaluationBreakdown;
    }
  | {
      readonly action: Extract<GameAction, { type: 'FLIP' }>;
      readonly expectedScore: number;
      readonly outcomes: readonly FlipOutcomeEvaluation[];
    };

export interface ExpectedValueDecision {
  readonly selectedAction: GameAction;
  readonly currentEvaluation: EvaluationBreakdown;
  readonly distribution: HiddenPieceDistribution;
  readonly actionEvaluations: readonly ExpectedValueActionEvaluation[];
}

function copyAction(action: GameAction): GameAction {
  return action.type === 'MOVE'
    ? { type: 'MOVE', from: action.from, to: action.to }
    : { type: 'FLIP', position: action.position };
}

/** Enumerate one-step public outcomes; no sampling, replies, search, or information bonus. */
export function explainExpectedValueDecision(
  input: AgentInput,
  { seed }: { readonly seed: number },
  configuration: HeuristicConfiguration = {},
): ExpectedValueDecision {
  const random = createSeededRandom(seed);
  if (input.observation.status !== 'ACTIVE')
    throw new RangeError('Expected Value Agent requires an active game.');
  if (input.observation.currentPlayer !== input.perspective)
    throw new RangeError('Expected Value Agent requires its assigned turn.');
  if (input.legalActions.length === 0)
    throw new RangeError('Expected Value Agent requires at least one permitted action.');
  const resolved = resolveHeuristicConfiguration(configuration);
  const distribution = getHiddenPieceDistribution(input);
  const currentEvaluation = evaluatePosition(input, resolved);
  const evaluate = (action: GameAction, reveal?: PublicPiece): EvaluationBreakdown => {
    const projected = projectPermittedPublicAction(input, action, reveal);
    if (!projected.ok)
      throw new RangeError(
        `Supplied permitted action rejected by Core projection: ${projected.error.code}`,
      );
    return evaluatePosition(
      {
        observation: projected.observation,
        publicHistory: [...input.publicHistory, projected.event],
        perspective: input.perspective,
      },
      resolved,
    );
  };
  const actionEvaluations = input.legalActions.map((action): ExpectedValueActionEvaluation => {
    if (action.type === 'MOVE') {
      const evaluation = evaluate(action);
      return {
        action: { type: 'MOVE', from: action.from, to: action.to },
        expectedScore: evaluation.total,
        evaluation,
      };
    }
    if (distribution.outcomes.length === 0)
      throw new RangeError('A supplied FLIP requires at least one hidden outcome.');
    const outcomes = distribution.outcomes.map(({ piece, count, probability }) => {
      const evaluation = evaluate(action, piece);
      return {
        piece: { ...piece },
        count,
        probability,
        evaluation,
        contribution: probability * evaluation.total,
      };
    });
    return {
      action: { type: 'FLIP', position: action.position },
      expectedScore: outcomes.reduce((sum, outcome) => sum + outcome.contribution, 0),
      outcomes,
    };
  });
  const bestScore = actionEvaluations.reduce(
    (best, action) => Math.max(best, action.expectedScore),
    -Infinity,
  );
  const candidates = actionEvaluations.filter((action) => action.expectedScore === bestScore);
  return {
    selectedAction: copyAction(candidates[Math.floor(random() * candidates.length)]!.action),
    currentEvaluation,
    distribution,
    actionEvaluations,
  };
}

export function createExpectedValueAgent(configuration: HeuristicConfiguration = {}): GameAgent {
  const resolved = resolveHeuristicConfiguration(configuration);
  return {
    async chooseAction(input, options) {
      return explainExpectedValueDecision(input, options, resolved).selectedAction;
    },
  };
}

export const expectedValueAgent: GameAgent = createExpectedValueAgent();
