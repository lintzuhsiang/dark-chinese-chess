import {
  getPublicOrdinaryMoves,
  createPublicProjectionContext,
  projectPublicAction,
  type PublicProjectionContext,
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

type MoveAction = Extract<GameAction, { type: 'MOVE' }>;

export interface SafetyTieCheck {
  readonly action: MoveAction;
  /** One legal opponent capture winning immediately, not a general reply search. */
  readonly winningReply: MoveAction | null;
}

export interface SafetyTieDecision extends ExpectedValueDecision {
  readonly safetyTie: {
    readonly applied: boolean;
    readonly checks: readonly SafetyTieCheck[];
  };
}

function copyAction(action: GameAction): GameAction {
  return action.type === 'MOVE'
    ? { type: 'MOVE', from: action.from, to: action.to }
    : { type: 'FLIP', position: action.position };
}

function validateExpectedValueInput(input: AgentInput): void {
  if (input.observation.status !== 'ACTIVE')
    throw new RangeError('Expected Value Agent requires an active game.');
  if (input.observation.currentPlayer !== input.perspective)
    throw new RangeError('Expected Value Agent requires its assigned turn.');
  if (input.legalActions.length === 0)
    throw new RangeError('Expected Value Agent requires at least one permitted action.');
}

/** Enumerate one-step public outcomes; no sampling, replies, search, or information bonus. */
export function explainExpectedValueDecision(
  input: AgentInput,
  options: { readonly seed: number },
  configuration: HeuristicConfiguration = {},
): ExpectedValueDecision {
  validateExpectedValueInput(input);
  return evaluateExpectedValueInContext(
    input,
    options,
    configuration,
    createPublicProjectionContext(input),
  );
}

// Internal reuse by Tactical's EV fallback; the caller owns this decision's root context.
export function evaluateExpectedValueInContext(
  input: AgentInput,
  { seed }: { readonly seed: number },
  configuration: HeuristicConfiguration,
  context: PublicProjectionContext,
): ExpectedValueDecision {
  const random = createSeededRandom(seed);
  validateExpectedValueInput(input);
  const resolved = resolveHeuristicConfiguration(configuration);
  const distribution = getHiddenPieceDistribution(input);
  const currentEvaluation = evaluatePosition(input, resolved);
  const evaluate = (action: GameAction, reveal?: PublicPiece): EvaluationBreakdown => {
    const projected = projectPublicAction(context, action, reveal);
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

function immediateWinningCapture(
  context: PublicProjectionContext,
  action: MoveAction,
): MoveAction | null {
  const projected = projectPublicAction(context, action);
  if (!projected.ok) throw new RangeError(`Core rejected a tied MOVE: ${projected.error.code}`);
  if (projected.observation.status === 'FINISHED') return null;
  const opponent = projected.observation.currentPlayer;
  const color = projected.observation.playerColors[opponent];
  if (color === null) return null;
  for (const reply of getPublicOrdinaryMoves(projected.observation.board, color)) {
    if (projected.observation.board[reply.to]?.kind !== 'REVEALED') continue;
    // Ordinary capture geometry is shared with Core. Captures preserve unrelated chase history and
    // still go through Core projection for legality and exact terminal priority.
    const response = projectPublicAction(projected.nextContext, reply);
    if (!response.ok) throw new RangeError(`Core rejected a capture reply: ${response.error.code}`);
    const result = response.observation.result;
    if (result?.type === 'WIN' && result.winner === opponent) {
      return { type: 'MOVE', from: reply.from, to: reply.to };
    }
  }
  return null;
}

/** SAFETY-TIE-1 preserves the legacy scorer and changes only all-MOVE top ties. */
export function explainSafetyTieDecision(
  input: AgentInput,
  options: { readonly seed: number },
  configuration: HeuristicConfiguration = {},
): SafetyTieDecision {
  const baseline = explainExpectedValueDecision(input, options, configuration);
  const bestScore = Math.max(
    ...baseline.actionEvaluations.map((candidate) => candidate.expectedScore),
  );
  const tied = baseline.actionEvaluations.filter(
    (candidate) => candidate.expectedScore === bestScore,
  );
  // A mixed tie keeps FLIP selection/probabilities exactly as in the baseline.
  if (tied.length < 2 || tied.some((candidate) => candidate.action.type !== 'MOVE')) {
    return { ...baseline, safetyTie: { applied: false, checks: [] } };
  }
  const context = createPublicProjectionContext(input);
  const checks = tied.map((candidate): SafetyTieCheck => {
    const action = candidate.action as MoveAction;
    return {
      action: { type: 'MOVE', from: action.from, to: action.to },
      winningReply: immediateWinningCapture(context, action),
    };
  });
  const remaining = checks.filter((check) => check.winningReply === null);
  if (remaining.length === 0 || remaining.length === checks.length) {
    return { ...baseline, safetyTie: { applied: false, checks } };
  }
  // Reuse the baseline's first seeded sample and original candidate order.
  // No presentation/deck RNG is read, and unsafe sets never become empty.
  const random = createSeededRandom(options.seed);
  return {
    ...baseline,
    selectedAction: copyAction(remaining[Math.floor(random() * remaining.length)]!.action),
    safetyTie: { applied: true, checks },
  };
}

export function createSafetyTieAgent(configuration: HeuristicConfiguration = {}): GameAgent {
  const resolved = resolveHeuristicConfiguration(configuration);
  return {
    async chooseAction(input, options) {
      return explainSafetyTieDecision(input, options, resolved).selectedAction;
    },
  };
}

export const safetyTieAgent: GameAgent = createSafetyTieAgent();
