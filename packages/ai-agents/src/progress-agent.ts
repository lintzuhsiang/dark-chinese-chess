import {
  evaluatePosition,
  type EvaluationBreakdown,
  type PositionEvaluationInput,
} from './heuristic-evaluation';
import { searchPublicPosition } from './tactical-search';
import type { AgentInput, GameAgent } from './types';

export function getProgressState(input: PositionEvaluationInput) {
  let quietPlies = 0;
  for (let i = input.publicHistory.length - 1; i >= 0 && quietPlies < 60; i--) {
    const event = input.publicHistory[i]!;
    if (event.type === 'FLIP' || event.captured !== null) break;
    quietPlies++;
  }
  return { quietPlies, remainingPlies: Math.max(0, 60 - quietPlies) };
}

// Diagnostic only: reverse the quiet public suffix without hidden identities or Core replay.
export function countPublicPositionReturns(input: PositionEvaluationInput): number {
  const quiet = getProgressState(input).quietPlies;
  if (quiet === 0) return 0;
  const board = [...input.observation.board];
  const key = (player: string) => JSON.stringify([board, player, input.observation.playerColors]);
  const current = key(input.observation.currentPlayer);
  let returns = 0;
  for (const event of input.publicHistory.slice(-quiet).reverse()) {
    if (event.type !== 'MOVE') break;
    board[event.from] = board[event.to]!;
    board[event.to] = { kind: 'EMPTY' };
    if (key(event.playerId) === current) returns++;
  }
  return returns;
}

export function evaluateProgressPosition(
  input: PositionEvaluationInput,
  base: EvaluationBreakdown = evaluatePosition(input),
) {
  const progress = getProgressState(input);
  const pressure = Math.max(0, Math.min(1, (progress.quietPlies - 40) / 20));
  const adjustment = base.terminal || pressure === 0 ? 0 : -base.material.contribution * pressure;
  return { base, ...progress, pressure, adjustment, total: base.total + adjustment };
}

export function explainProgressDecision(input: AgentInput, options: { readonly seed: number }) {
  return searchPublicPosition(
    input,
    options,
    {},
    {},
    (position, base) => evaluateProgressPosition(position, base).total,
  );
}

export const progressAgent: GameAgent = {
  async chooseAction(input, options) {
    return explainProgressDecision(input, options).selectedAction;
  },
};
