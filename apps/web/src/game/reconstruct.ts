import { applyAction, createInitialState } from '@dark-chess/game-core';
import type { ActionEvent, GameAction, GameState, Piece, PlayerId } from '@dark-chess/game-core';

export interface AcceptedAction {
  readonly playerId: PlayerId;
  readonly action: GameAction;
}

// Trusted session inputs: a failure means the canonical timeline is corrupt.
// Keep it observable rather than displaying a silently shortened game/history.
export function reconstructGame(initialDeck: readonly Piece[], actions: readonly AcceptedAction[]): {
  readonly state: GameState;
  readonly events: readonly ActionEvent[];
} {
  const initial = createInitialState(initialDeck);
  if (!initial.ok) throw new Error(`Cannot reconstruct game: ${initial.error.code}`);
  let state = initial.state;
  const events: ActionEvent[] = [];
  for (const [index, entry] of actions.entries()) {
    const result = applyAction(state, entry.playerId, entry.action);
    if (!result.ok) throw new Error(`Cannot reconstruct action ${index + 1}: ${result.error.code}`);
    state = result.state;
    events.push(result.event);
  }
  return { state, events };
}
