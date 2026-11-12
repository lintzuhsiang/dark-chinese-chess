import type { GameResult, GameState, PlayerId } from './types';
// Evaluate the accepted candidate after its turn and counters have advanced.
// The callback shares chase-aware enumeration without recursively evaluating outcomes.
export function evaluateOutcome(
  state: GameState,
  hasLegalAction: () => boolean,
  hasOrdinaryAction: () => boolean = hasLegalAction,
): GameResult | null {
  const nextColor = state.playerColors[state.currentPlayer];
  return evaluateOutcomeFacts(
    {
      currentPlayer: state.currentPlayer,
      noProgressCount: state.noProgressCount,
      nextPlayerHasPieces:
        nextColor === null || state.board.some((square) => square?.piece.color === nextColor),
    },
    hasLegalAction,
    hasOrdinaryAction,
  );
}

// One outcome priority for authoritative states and public hypothetical branches.
export function evaluateOutcomeFacts(
  facts: {
    readonly currentPlayer: PlayerId;
    readonly noProgressCount: number;
    readonly nextPlayerHasPieces: boolean;
  },
  hasLegalAction: () => boolean,
  hasOrdinaryAction: () => boolean = hasLegalAction,
): GameResult | null {
  const winner = facts.currentPlayer === 'P1' ? 'P2' : 'P1';
  if (!facts.nextPlayerHasPieces) {
    return { type: 'WIN', winner, reason: 'NO_PIECES' };
  }
  if (!hasOrdinaryAction()) return { type: 'WIN', winner, reason: 'NO_LEGAL_ACTION' };
  if (!hasLegalAction()) return { type: 'DRAW', reason: 'CHASE_STALEMATE' };
  if (facts.noProgressCount >= 60) return { type: 'DRAW', reason: 'NO_PROGRESS' };
  return null;
}
