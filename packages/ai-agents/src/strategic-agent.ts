import {
  getPublicOrdinaryMoves,
  PIECE_DISTRIBUTION,
  type PieceColor,
  type PublicSquare,
} from '../../game-core/src/index';
import {
  DEFAULT_HEURISTIC_CONFIGURATION,
  type EvaluationBreakdown,
  type PositionEvaluationInput,
} from './heuristic-evaluation';
import { evaluateProgressPosition } from './progress-agent';
import { searchPublicPosition } from './tactical-search';
import type { AgentInput, GameAgent } from './types';

export interface StrategicFeatures {
  readonly proximity: boolean;
  readonly blockers: boolean;
  readonly cannon: boolean;
}
export const STRATEGIC_FEATURE_WEIGHT = 0.03;
export const STRATEGIC_PRESETS: Readonly<Record<keyof StrategicFeatures, StrategicFeatures>> =
  Object.freeze({
    proximity: Object.freeze({ proximity: true, blockers: false, cannon: false }),
    blockers: Object.freeze({ proximity: false, blockers: true, cannon: false }),
    cannon: Object.freeze({ proximity: false, blockers: false, cannon: true }),
  });
const values = DEFAULT_HEURISTIC_CONFIGURATION.pieceValues;
const materialScale = Object.entries(PIECE_DISTRIBUTION).reduce(
  (sum, [rank, count]) => sum + count * values[rank as keyof typeof values],
  0,
);
const clamp = (n: number) => Math.max(-1, Math.min(1, n));
const other = (color: PieceColor): PieceColor => (color === 'RED' ? 'BLACK' : 'RED');

function conversionProximity(board: readonly PublicSquare[], material: number): number {
  let distance = 10;
  for (const [a, left] of board.entries()) {
    if (left.kind !== 'REVEALED') continue;
    for (const [b, right] of board.entries()) {
      if (right.kind !== 'REVEALED' || right.piece.color === left.piece.color) continue;
      distance = Math.min(
        distance,
        Math.abs(Math.floor(a / 4) - Math.floor(b / 4)) + Math.abs((a % 4) - (b % 4)),
      );
    }
  }
  return material * (1 - distance / 10);
}

// Structural multi-step access, not a legal-action or capture evaluator.
function reachableEmpty(board: readonly PublicSquare[], color: PieceColor): number {
  const queue = board.flatMap((s, i) =>
    s.kind === 'REVEALED' && s.piece.color === color ? [i] : [],
  );
  const seen = new Set(queue);
  let empty = 0;
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i]!;
    for (const to of [from - 4, from + 4, from - 1, from + 1]) {
      if (
        to < 0 ||
        to >= 32 ||
        Math.abs(Math.floor(from / 4) - Math.floor(to / 4)) + Math.abs((from % 4) - (to % 4)) !==
          1 ||
        seen.has(to) ||
        board[to]!.kind !== 'EMPTY'
      )
        continue;
      seen.add(to);
      queue.push(to);
      empty++;
    }
  }
  return empty;
}

function latentCannonValue(board: readonly PublicSquare[], color: PieceColor): number {
  const ordinary = getPublicOrdinaryMoves(board, color);
  const current = new Set(
    ordinary.filter((a) => board[a.to]!.kind === 'REVEALED').map((a) => a.to),
  );
  const latent = new Set<number>();
  for (const action of ordinary) {
    const source = board[action.from]!;
    if (
      source.kind !== 'REVEALED' ||
      source.piece.rank !== 'CANNON' ||
      board[action.to]!.kind !== 'EMPTY'
    )
      continue;
    const after = [...board];
    after[action.from] = { kind: 'EMPTY' };
    after[action.to] = source;
    for (const next of getPublicOrdinaryMoves(after, color)) {
      if (next.from === action.to && after[next.to]!.kind === 'REVEALED' && !current.has(next.to))
        latent.add(next.to);
    }
  }
  let total = 0;
  for (const position of latent) {
    const target = board[position]!;
    if (target.kind === 'REVEALED') total += values[target.piece.rank];
  }
  return total;
}

export function evaluateStrategicPosition(
  input: PositionEvaluationInput,
  features: Partial<StrategicFeatures> = {},
  base?: EvaluationBreakdown,
) {
  const progress = evaluateProgressPosition(input, base);
  const color = input.observation.playerColors[input.perspective];
  let proximity = 0,
    blockers = 0,
    cannon = 0;
  if (!progress.base.terminal && color !== null) {
    const board = input.observation.board;
    if (features.proximity)
      proximity = conversionProximity(board, progress.base.material.normalized);
    if (features.blockers)
      blockers = (reachableEmpty(board, color) - reachableEmpty(board, other(color))) / 32;
    if (features.cannon)
      cannon =
        (latentCannonValue(board, color) - latentCannonValue(board, other(color))) / materialScale;
  }
  const adjustment =
    STRATEGIC_FEATURE_WEIGHT * (clamp(proximity) + clamp(blockers) + clamp(cannon));
  return {
    progress,
    proximity,
    blockers,
    cannon,
    adjustment,
    total: progress.base.terminal ? progress.total : clamp(progress.total + adjustment),
  };
}

export function explainStrategicDecision(
  input: AgentInput,
  options: { readonly seed: number },
  features: Partial<StrategicFeatures> = {},
) {
  return searchPublicPosition(
    input,
    options,
    {},
    {},
    (position, base) => evaluateStrategicPosition(position, features, base).total,
  );
}

export function createStrategicAgent(features: Partial<StrategicFeatures> = {}): GameAgent {
  const fixed = Object.freeze({ ...features });
  return {
    async chooseAction(input, options) {
      return explainStrategicDecision(input, options, fixed).selectedAction;
    },
  };
}
