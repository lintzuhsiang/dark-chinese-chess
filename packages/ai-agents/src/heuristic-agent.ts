import type { ActionEvent, GameAction, PublicSquare } from '../../game-core/src/index';
import {
  evaluatePosition,
  resolveHeuristicConfiguration,
  type EvaluationBreakdown,
  type HeuristicConfiguration,
} from './heuristic-evaluation';
import { createSeededRandom } from './seeded-random';
import type { AgentInput, GameAgent } from './types';

type MoveAction = Extract<GameAction, { type: 'MOVE' }>;

export interface MoveEvaluation {
  readonly action: MoveAction;
  readonly evaluation: EvaluationBreakdown;
  readonly gain: number;
}

export interface HeuristicDecision {
  readonly selectedAction: GameAction;
  readonly reason: 'only-flips' | 'flip-fallback' | 'best-move';
  readonly currentEvaluation: EvaluationBreakdown;
  readonly moveEvaluations: readonly MoveEvaluation[];
}

function copyAction(action: GameAction): GameAction {
  return action.type === 'FLIP'
    ? { type: 'FLIP', position: action.position }
    : { type: 'MOVE', from: action.from, to: action.to };
}

function evaluateMove(
  input: AgentInput,
  action: MoveAction,
  configuration: HeuristicConfiguration,
): EvaluationBreakdown {
  const source = input.observation.board[action.from];
  const target = input.observation.board[action.to];
  if (source?.kind !== 'REVEALED' || target === undefined || target.kind === 'HIDDEN') {
    throw new RangeError('Permitted MOVE requires a revealed source and public destination.');
  }
  const board: PublicSquare[] = [...input.observation.board];
  board[action.from] = { kind: 'EMPTY' };
  board[action.to] = {
    kind: 'REVEALED',
    piece: { color: source.piece.color, rank: source.piece.rank },
  };
  const event: ActionEvent = {
    type: 'MOVE',
    ply: (input.publicHistory.at(-1)?.ply ?? 0) + 1,
    playerId: input.observation.currentPlayer,
    from: action.from,
    to: action.to,
    piece: { color: source.piece.color, rank: source.piece.rank },
    captured:
      target.kind === 'REVEALED' ? { color: target.piece.color, rank: target.piece.rank } : null,
  };
  // A structural patch, not an authoritative successor: outcomes/counters/chase stay in Core.
  return evaluatePosition(
    {
      observation: {
        ...input.observation,
        board,
        currentPlayer: input.observation.currentPlayer === 'P1' ? 'P2' : 'P1',
      },
      publicHistory: [...input.publicHistory, event],
      perspective: input.perspective,
    },
    configuration,
  );
}

/** FLIPs are an explicit fallback, never a fabricated expected-value estimate. */
export function explainDecision(
  input: AgentInput,
  { seed }: { readonly seed: number },
  configuration: HeuristicConfiguration = {},
): HeuristicDecision {
  const random = createSeededRandom(seed);
  if (input.observation.status !== 'ACTIVE')
    throw new RangeError('Heuristic Agent requires an active game.');
  if (input.observation.currentPlayer !== input.perspective)
    throw new RangeError('Heuristic Agent requires its assigned turn.');
  if (input.legalActions.length === 0)
    throw new RangeError('Heuristic Agent requires at least one permitted action.');
  const resolved = resolveHeuristicConfiguration(configuration);
  const currentEvaluation = evaluatePosition(input, resolved);
  const flips = input.legalActions.filter((action) => action.type === 'FLIP');
  const moveEvaluations = input.legalActions
    .filter((action): action is MoveAction => action.type === 'MOVE')
    .map((action): MoveEvaluation => {
      const evaluation = evaluateMove(input, action, resolved);
      return {
        action: { type: 'MOVE', from: action.from, to: action.to },
        evaluation,
        gain: evaluation.total - currentEvaluation.total,
      };
    });
  const bestScore = moveEvaluations.reduce(
    (best, move) => Math.max(best, move.evaluation.total),
    -Infinity,
  );
  const useFlip =
    flips.length > 0 && (moveEvaluations.length === 0 || bestScore <= currentEvaluation.total);
  const candidates = useFlip
    ? flips
    : moveEvaluations
        .filter((move) => move.evaluation.total === bestScore)
        .map((move) => move.action);
  const selectedAction = copyAction(candidates[Math.floor(random() * candidates.length)]!);
  return {
    selectedAction,
    reason: useFlip ? (moveEvaluations.length === 0 ? 'only-flips' : 'flip-fallback') : 'best-move',
    currentEvaluation,
    moveEvaluations,
  };
}

export function createHeuristicAgent(configuration: HeuristicConfiguration = {}): GameAgent {
  // Capture a frozen value copy so caller mutations cannot change later decisions.
  const resolved = resolveHeuristicConfiguration(configuration);
  return {
    async chooseAction(input, options) {
      return explainDecision(input, options, resolved).selectedAction;
    },
  };
}

export const heuristicAgent: GameAgent = createHeuristicAgent();
