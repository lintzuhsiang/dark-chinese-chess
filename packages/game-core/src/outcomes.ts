import type { GameResult, GameState } from './types';
import { getActionError } from './validation';

function hasOrdinaryLegalAction(state: GameState): boolean {
  for (let from = 0; from < 32; from += 1) {
    if (getActionError(state, state.currentPlayer, { type: 'FLIP', position: from }) === null)
      return true;
    for (let to = 0; to < 32; to += 1) {
      if (getActionError(state, state.currentPlayer, { type: 'MOVE', from, to }) === null)
        return true;
    }
  }
  return false;
}

// Evaluate the accepted candidate after its turn and counters have advanced.
// Ordinary legality deliberately excludes chase policy: a prohibition never causes a loss.
export function evaluateOutcome(state: GameState): GameResult | null {
  const nextColor = state.playerColors[state.currentPlayer];
  const winner = state.currentPlayer === 'P1' ? 'P2' : 'P1';
  if (nextColor !== null && !state.board.some((square) => square?.piece.color === nextColor)) {
    return { type: 'WIN', winner, reason: 'NO_PIECES' };
  }
  if (!hasOrdinaryLegalAction(state)) return { type: 'WIN', winner, reason: 'NO_LEGAL_ACTION' };
  if (state.noProgressCount >= 60) return { type: 'DRAW', reason: 'NO_PROGRESS' };
  return null;
}
