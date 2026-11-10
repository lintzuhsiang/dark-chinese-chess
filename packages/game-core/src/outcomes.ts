import type { GameResult, GameState } from './types';
// Evaluate the accepted candidate after its turn and counters have advanced.
// The callback shares chase-aware enumeration without recursively evaluating outcomes.
export function evaluateOutcome(
  state: GameState,
  hasLegalAction: () => boolean,
): GameResult | null {
  const nextColor = state.playerColors[state.currentPlayer];
  const winner = state.currentPlayer === 'P1' ? 'P2' : 'P1';
  if (nextColor !== null && !state.board.some((square) => square?.piece.color === nextColor)) {
    return { type: 'WIN', winner, reason: 'NO_PIECES' };
  }
  if (!hasLegalAction()) return { type: 'WIN', winner, reason: 'NO_LEGAL_ACTION' };
  if (state.noProgressCount >= 60) return { type: 'DRAW', reason: 'NO_PROGRESS' };
  return null;
}
