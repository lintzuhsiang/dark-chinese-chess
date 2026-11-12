import {
  getPublicOrdinaryMoves,
  createPublicProjectionContext,
  projectPublicAction,
  type PublicProjectionContext,
  type GameAction,
  type GameResult,
  type PlayerId,
  type PublicPiece,
} from '../../game-core/src/index';
import { evaluateExpectedValueInContext, type ExpectedValueDecision } from './expected-value-agent';
import {
  evaluatePosition,
  type EvaluationBreakdown,
  type PositionEvaluationInput,
  type HeuristicConfiguration,
} from './heuristic-evaluation';
import { getHiddenPieceDistribution } from './hidden-piece-distribution';
import { createSeededRandom } from './seeded-random';
import type { AgentInput } from './types';

export interface SearchLimits {
  readonly maxDepth: number;
  readonly projectionBudget: number;
  readonly rootWidth: number;
  readonly interiorWidth: number;
  readonly alphaBeta: boolean;
}
export const DEFAULT_SEARCH_LIMITS: SearchLimits = Object.freeze({
  maxDepth: 6,
  projectionBudget: 8192,
  rootWidth: 8,
  interiorWidth: 4,
  alphaBeta: true,
});
export type PublicLeafEvaluator = (position: PositionEvaluationInput) => number;
export type TacticalTag = 'WIN' | 'TERMINAL' | 'RECAPTURE' | 'DEFENSE' | 'CAPTURE' | 'THREAT';
export interface SearchBranchReport {
  readonly nodeId: number;
  readonly probability: number;
  readonly reveal: PublicPiece | null;
  readonly staticScore: number;
  readonly result: GameResult | null;
}
export interface SearchActionReport {
  readonly action: GameAction;
  readonly onePlyScore: number;
  readonly tactics: readonly TacticalTag[];
  readonly retained: boolean;
  readonly branches: readonly SearchBranchReport[];
}
export interface SearchNodeReport {
  readonly nodeId: number;
  readonly ply: number;
  readonly player: PlayerId;
  readonly actions: readonly SearchActionReport[];
}
export interface SearchIteration {
  readonly depth: number;
  readonly scores: readonly { readonly action: GameAction; readonly score: number }[];
}
export interface TacticalDecision {
  readonly selectedAction: GameAction;
  readonly baseline: ExpectedValueDecision;
  readonly rootActions: readonly {
    readonly action: GameAction;
    readonly baselineScore: number;
    readonly tactics: readonly TacticalTag[];
    readonly retained: boolean;
    readonly completedDepth: number;
    readonly chanceOutcomes: number;
    readonly searchScore: number | null;
  }[];
  readonly iterations: readonly SearchIteration[];
  readonly nodes: readonly SearchNodeReport[];
  readonly diagnostics: {
    readonly completedDepth: number;
    readonly maximumVisitedPly: number;
    readonly visitedNodes: number;
    readonly generatedNodes: number;
    readonly projections: number;
    readonly baselineProjections: number;
    readonly cacheHits: number;
    readonly leafEvaluations: number;
    readonly terminalVisits: number;
    readonly alphaBetaCutoffs: number;
    readonly budgetExhausted: boolean;
    readonly rootAvailable: number;
    readonly rootRetained: number;
    readonly rootFlipsAvailable: number;
    readonly rootFlipsRetained: number;
    readonly interiorAvailable: number;
    readonly interiorRetained: number;
    readonly incompleteInteriorExpansions: number;
    readonly excludedTacticalActions: number;
    readonly fallback: 'EV' | null;
    readonly limits: SearchLimits;
  };
}

export function resolveSearchLimits(configuration: Partial<SearchLimits> = {}): SearchLimits {
  const limits = { ...DEFAULT_SEARCH_LIMITS, ...configuration };
  for (const [key, ceiling] of [
    ['maxDepth', 6],
    ['projectionBudget', 8192],
    ['rootWidth', 1024],
    ['interiorWidth', 1024],
  ] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > ceiling) {
      throw new RangeError(`Invalid search ${key}.`);
    }
  }
  if (typeof limits.alphaBeta !== 'boolean') throw new RangeError('Invalid alphaBeta option.');
  return Object.freeze(limits);
}

interface Node {
  readonly id: number;
  readonly ply: number;
  readonly position: PositionEvaluationInput;
  readonly context: PublicProjectionContext;
  readonly evaluation: EvaluationBreakdown;
  readonly leafScore: number;
  actions?: Candidate[];
}
interface Branch {
  readonly probability: number;
  readonly reveal: PublicPiece | null;
  readonly node: Node;
}
interface Candidate {
  readonly action: GameAction;
  readonly ordinal: number;
  readonly score: number;
  readonly tactics: readonly TacticalTag[];
  branches: Branch[] | null;
  retained: boolean;
}
const exhausted = Symbol('projection budget exhausted');
const copy = (action: GameAction): GameAction =>
  action.type === 'MOVE'
    ? { type: 'MOVE', from: action.from, to: action.to }
    : { type: 'FLIP', position: action.position };

function priority(candidate: Candidate): number {
  for (const [index, tag] of (
    ['WIN', 'RECAPTURE', 'DEFENSE', 'CAPTURE', 'THREAT'] as const
  ).entries()) {
    if (candidate.tactics.includes(tag)) return index;
  }
  return 5;
}
function tags(
  position: PositionEvaluationInput,
  action: GameAction,
  evaluations: readonly EvaluationBreakdown[],
  before: EvaluationBreakdown,
): TacticalTag[] {
  const result: TacticalTag[] = [];
  const actorIsUs = position.observation.currentPlayer === position.perspective;
  if (evaluations.every((value) => value.terminal && value.total === (actorIsUs ? 2 : -2)))
    result.push('WIN');
  if (evaluations.some((value) => value.terminal)) result.push('TERMINAL');
  if (action.type === 'MOVE') {
    if (position.observation.board[action.to]?.kind === 'REVEALED') {
      result.push('CAPTURE');
      const last = position.publicHistory.at(-1);
      if (last?.type === 'MOVE' && last.captured !== null && last.to === action.to)
        result.push('RECAPTURE');
    }
    const after = evaluations[0]!;
    const friendly = actorIsUs ? 'friendly' : 'enemy';
    const enemy = actorIsUs ? 'enemy' : 'friendly';
    // Existing shared-rule exposure measurements are used for ordering only.
    if (after.threat[friendly] < before.threat[friendly]) result.push('DEFENSE');
    if (after.threat[enemy] > before.threat[enemy]) result.push('THREAT');
  }
  return result;
}

/** Bounded selective public expectiminimax. No private state or determinization. */
export function searchPublicPosition(
  input: AgentInput,
  options: { readonly seed: number },
  searchConfiguration: Partial<SearchLimits> = {},
  evaluationConfiguration: HeuristicConfiguration = {},
  evaluateLeaf?: PublicLeafEvaluator,
): TacticalDecision {
  const limits = resolveSearchLimits(searchConfiguration);
  const distribution = getHiddenPieceDistribution(input);
  // The unchanged baseline makes exactly one Core call per MOVE / positive FLIP outcome.
  // Reserve those calls before invoking it; no uncounted fallback call is made later.
  const baselineProjections = input.legalActions.reduce(
    (sum, action) => sum + (action.type === 'MOVE' ? 1 : distribution.outcomes.length),
    0,
  );
  if (baselineProjections > limits.projectionBudget)
    throw new RangeError('Search budget cannot cover the complete EV fallback.');
  const context = createPublicProjectionContext(input);
  const baseline = evaluateExpectedValueInContext(input, options, evaluationConfiguration, context);
  let projections = baselineProjections;
  let nextId = 0,
    visitedNodes = 0,
    cacheHits = 0,
    leafEvaluations = 0,
    terminalVisits = 0,
    alphaBetaCutoffs = 0,
    maximumVisitedPly = 0;
  let budgetExhausted = false;
  let interiorExpansionsAttempted = 0;
  const expanded: Node[] = [];

  function node(
    position: PositionEvaluationInput,
    ply: number,
    context: PublicProjectionContext,
  ): Node {
    const evaluation = evaluatePosition(position, evaluationConfiguration);
    const score =
      evaluation.terminal || evaluateLeaf === undefined ? evaluation.total : evaluateLeaf(position);
    if (!Number.isFinite(score) || (!evaluation.terminal && Math.abs(score) > 1))
      throw new RangeError('Active leaf scores must be finite and within [-1,1].');
    leafEvaluations += 1;
    return { id: nextId++, ply, position, context, evaluation, leafScore: score };
  }
  const root = node(input, 0, context);
  function project(parent: Node, action: GameAction, reveal?: PublicPiece): Node | null {
    if (projections >= limits.projectionBudget) throw exhausted;
    projections += 1;
    const result = projectPublicAction(parent.context, action, reveal);
    if (!result.ok) {
      if (result.error.code === 'PERPETUAL_CHASE' && action.type === 'MOVE') return null;
      throw new RangeError(`Public search projection rejected: ${result.error.code}`);
    }
    return node(
      {
        observation: result.observation,
        publicHistory: [...parent.position.publicHistory, result.event],
        perspective: input.perspective,
      },
      parent.ply + 1,
      result.nextContext,
    );
  }
  function branches(parent: Node, action: GameAction): Branch[] | null {
    if (action.type === 'MOVE') {
      const child = project(parent, action);
      return child === null ? null : [{ probability: 1, reveal: null, node: child }];
    }
    const outcomes = getHiddenPieceDistribution(parent.position).outcomes;
    if (outcomes.length === 0) throw new RangeError('FLIP has no positive outcomes.');
    return outcomes.map((outcome) => {
      const child = project(parent, action, outcome.piece);
      if (child === null) throw new Error('Unexpected prohibited FLIP.');
      return { probability: outcome.probability, reveal: { ...outcome.piece }, node: child };
    });
  }
  function select(parent: Node, actions: Candidate[], width: number): Candidate[] {
    const maximize = parent.position.observation.currentPlayer === input.perspective;
    const byScore = [...actions].sort(
      (a, b) => (maximize ? b.score - a.score : a.score - b.score) || a.ordinal - b.ordinal,
    );
    const ordered = [...actions].sort(
      (a, b) =>
        priority(a) - priority(b) ||
        (maximize ? b.score - a.score : a.score - b.score) ||
        a.ordinal - b.ordinal,
    );
    const chosen = new Set(actions.filter((candidate) => candidate.tactics.includes('TERMINAL')));
    // Protect the strongest EV alternative and, at the root, a best-EV FLIP.
    if (byScore[0]) chosen.add(byScore[0]);
    if (parent === root && width > 1) {
      const flip = byScore.find((candidate) => candidate.action.type === 'FLIP');
      if (flip) chosen.add(flip);
    }
    for (const candidate of ordered) {
      if (chosen.size >= width) break;
      chosen.add(candidate);
    }
    for (const candidate of actions) candidate.retained = chosen.has(candidate);
    parent.actions = actions;
    expanded.push(parent);
    return ordered.filter((candidate) => candidate.retained);
  }
  function expand(parent: Node): Candidate[] {
    if (parent.actions) {
      cacheHits += 1;
      return [...parent.actions]
        .filter((candidate) => candidate.retained)
        .sort(
          (a, b) =>
            priority(a) - priority(b) ||
            (parent.position.observation.currentPlayer === input.perspective
              ? b.score - a.score
              : a.score - b.score) ||
            a.ordinal - b.ordinal,
        );
    }
    interiorExpansionsAttempted += 1;
    const color =
      parent.position.observation.playerColors[parent.position.observation.currentPlayer];
    const candidates: GameAction[] =
      color === null ? [] : [...getPublicOrdinaryMoves(parent.position.observation.board, color)];
    parent.position.observation.board.forEach((square, position) => {
      if (square.kind === 'HIDDEN') candidates.push({ type: 'FLIP', position });
    });
    const actions: Candidate[] = [];
    for (const [ordinal, action] of candidates.entries()) {
      const children = branches(parent, action);
      if (children === null) continue;
      actions.push({
        action: copy(action),
        ordinal,
        score: children.reduce(
          (sum, branch) => sum + branch.probability * branch.node.evaluation.total,
          0,
        ),
        tactics: tags(
          parent.position,
          action,
          children.map((branch) => branch.node.evaluation),
          parent.evaluation,
        ),
        branches: children,
        retained: false,
      });
    }
    if (actions.length === 0)
      throw new Error('Core supplied an active public node with no permitted actions.');
    return select(parent, actions, limits.interiorWidth);
  }
  function children(parent: Node, candidate: Candidate): Branch[] {
    if (candidate.branches !== null) {
      cacheHits += 1;
      return candidate.branches;
    }
    const value = branches(parent, candidate.action);
    if (value === null) throw new Error('Supplied root MOVE is prohibited.');
    candidate.branches = value;
    return value;
  }
  function actionValue(
    parent: Node,
    candidate: Candidate,
    depth: number,
    alpha: number,
    beta: number,
  ): number {
    const values = children(parent, candidate);
    if (candidate.action.type === 'MOVE') return visit(values[0]!.node, depth - 1, alpha, beta);
    // Each chance child must return an exact value of its selective subtree.
    // Never average alpha-beta bounds or only the completed probability mass.
    return values.reduce(
      (sum, branch) =>
        sum + branch.probability * visit(branch.node, depth - 1, -Infinity, Infinity),
      0,
    );
  }
  function visit(current: Node, depth: number, alpha: number, beta: number): number {
    visitedNodes += 1;
    maximumVisitedPly = Math.max(maximumVisitedPly, current.ply);
    if (current.evaluation.terminal) {
      terminalVisits += 1;
      return current.evaluation.total;
    }
    if (depth === 0) return current.leafScore;
    const maximize = current.position.observation.currentPlayer === input.perspective;
    let best = maximize ? -Infinity : Infinity;
    for (const candidate of expand(current)) {
      const score = actionValue(current, candidate, depth, alpha, beta);
      best = maximize ? Math.max(best, score) : Math.min(best, score);
      if (maximize) alpha = Math.max(alpha, best);
      else beta = Math.min(beta, best);
      if (limits.alphaBeta && alpha >= beta) {
        alphaBetaCutoffs += 1;
        break;
      }
    }
    return best;
  }
  const rootCandidates: Candidate[] = baseline.actionEvaluations.map((candidate, ordinal) => {
    const evaluations =
      'evaluation' in candidate
        ? [candidate.evaluation]
        : candidate.outcomes.map((outcome) => outcome.evaluation);
    return {
      action: copy(candidate.action),
      ordinal,
      score: candidate.expectedScore,
      tactics: tags(input, candidate.action, evaluations, baseline.currentEvaluation),
      branches: null,
      retained: false,
    };
  });
  const retained = select(root, rootCandidates, limits.rootWidth);
  const iterations: SearchIteration[] = [];
  let selectedAction = baseline.selectedAction;
  for (let depth = 2; depth <= limits.maxDepth; depth += 1) {
    try {
      const scores = retained.map((candidate) => ({
        action: copy(candidate.action),
        score: actionValue(root, candidate, depth, -Infinity, Infinity),
      }));
      const best = Math.max(...scores.map((candidate) => candidate.score));
      const tied = scores
        .filter((candidate) => candidate.score === best)
        .sort(
          (a, b) =>
            rootCandidates.findIndex(
              (candidate) => JSON.stringify(candidate.action) === JSON.stringify(a.action),
            ) -
            rootCandidates.findIndex(
              (candidate) => JSON.stringify(candidate.action) === JSON.stringify(b.action),
            ),
        );
      selectedAction = copy(
        tied[Math.floor(createSeededRandom(options.seed)() * tied.length)]!.action,
      );
      iterations.push({ depth, scores });
    } catch (error) {
      if (error !== exhausted) throw error;
      budgetExhausted = true;
      break;
    }
  }
  const completedDepth = iterations.at(-1)?.depth ?? 1;
  const interior = expanded.filter((current) => current !== root);
  return {
    selectedAction: copy(selectedAction),
    baseline,
    rootActions: rootCandidates.map((candidate) => ({
      action: copy(candidate.action),
      baselineScore: candidate.score,
      tactics: candidate.tactics,
      retained: candidate.retained,
      completedDepth: candidate.retained ? completedDepth : 1,
      chanceOutcomes: candidate.action.type === 'FLIP' ? distribution.outcomes.length : 1,
      searchScore:
        iterations
          .at(-1)
          ?.scores.find(
            (value) => JSON.stringify(value.action) === JSON.stringify(candidate.action),
          )?.score ?? null,
    })),
    iterations,
    nodes: expanded.map((current) => ({
      nodeId: current.id,
      ply: current.ply,
      player: current.position.observation.currentPlayer,
      actions: current.actions!.map((candidate) => ({
        action: copy(candidate.action),
        onePlyScore: candidate.score,
        tactics: candidate.tactics,
        retained: candidate.retained,
        branches: (candidate.branches ?? []).map((branch) => ({
          nodeId: branch.node.id,
          probability: branch.probability,
          reveal: branch.reveal,
          staticScore: branch.node.evaluation.total,
          result: branch.node.position.observation.result,
        })),
      })),
    })),
    diagnostics: {
      completedDepth,
      maximumVisitedPly,
      visitedNodes,
      generatedNodes: nextId,
      projections,
      baselineProjections,
      cacheHits,
      leafEvaluations,
      terminalVisits,
      alphaBetaCutoffs,
      budgetExhausted,
      rootAvailable: rootCandidates.length,
      rootRetained: retained.length,
      rootFlipsAvailable: rootCandidates.filter((candidate) => candidate.action.type === 'FLIP')
        .length,
      rootFlipsRetained: retained.filter((candidate) => candidate.action.type === 'FLIP').length,
      interiorAvailable: interior.reduce((sum, current) => sum + current.actions!.length, 0),
      interiorRetained: interior.reduce(
        (sum, current) => sum + current.actions!.filter((candidate) => candidate.retained).length,
        0,
      ),
      excludedTacticalActions: expanded.reduce(
        (sum, current) =>
          sum +
          current.actions!.filter(
            (candidate) => !candidate.retained && candidate.tactics.length > 0,
          ).length,
        0,
      ),
      incompleteInteriorExpansions: interiorExpansionsAttempted - interior.length,
      fallback: iterations.length === 0 ? 'EV' : null,
      limits,
    },
  };
}
