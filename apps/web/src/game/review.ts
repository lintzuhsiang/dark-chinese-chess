import { getObservation } from '@dark-chess/game-core';
import type { ActionEvent, PlayerObservation, PublicPiece } from '@dark-chess/game-core';
import { reconstructGame } from './reconstruct';
import type { LocalGameSession } from './session';

export function isReviewCursor(cursor: number, actionCount: number): boolean {
  return Number.isInteger(cursor) && cursor >= 0 && cursor <= actionCount;
}

// Only public values cross this boundary. Board and captures follow this prefix.
// The hook separately memoizes the completed game's public history for seeking.
export function projectSession(
  session: LocalGameSession,
  reviewCursor: number | null,
): {
  readonly observation: PlayerObservation;
  readonly history: readonly ActionEvent[];
  readonly captured: readonly PublicPiece[];
} {
  if (
    reviewCursor !== null &&
    (session.currentState.status !== 'FINISHED' ||
      !isReviewCursor(reviewCursor, session.actions.length))
  ) {
    throw new Error('Invalid Review projection');
  }
  const actions = reviewCursor === null ? session.actions : session.actions.slice(0, reviewCursor);
  const reconstructed = reconstructGame(session.initialDeck, actions);
  return {
    observation: getObservation(reviewCursor === null ? session.currentState : reconstructed.state),
    history: reconstructed.events,
    captured: reconstructed.events.flatMap((event) =>
      event.type === 'MOVE' && event.captured ? [event.captured] : [],
    ),
  };
}
