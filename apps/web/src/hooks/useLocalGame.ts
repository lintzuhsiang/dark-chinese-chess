import { useMemo, useReducer } from 'react';
import { createShuffledDeck } from '../game/deck';
import { boardUiReducer, initialBoardUi } from '../game/interaction';
import { projectSession } from '../game/review';

export function useLocalGame() {
  const [ui, dispatch] = useReducer(boardUiReducer, initialBoardUi);
  const session = ui.local.session;
  const currentState = session?.currentState;
  // Public completed-game history is stable while seeking. The board and capture
  // summary still come from the selected prefix, never from this full timeline.
  const liveView = useMemo(() => session ? projectSession(session, null) : null, [session]);
  const view = useMemo(() => session && ui.reviewCursor !== null
    ? projectSession(session, ui.reviewCursor) : liveView, [session, ui.reviewCursor, liveView]);
  const isReview = ui.reviewCursor !== null;
  const totalActions = session?.actions.length ?? 0;
  const canUndo = !isReview && currentState?.status === 'ACTIVE' && totalActions > 0;
  const canReview = !isReview && currentState?.status === 'FINISHED';

  function startGame() {
    dispatch({ type: 'START', deck: createShuffledDeck() });
  }

  function clickSquare(position: number) {
    dispatch({ type: 'CLICK', position });
  }

  function undo() {
    dispatch({ type: 'UNDO' });
  }

  function restartGame(confirmed: boolean) {
    if (isReview || !currentState || (currentState.status === 'ACTIVE' && !confirmed)) return;
    dispatch({ type: 'RESTART', deck: createShuffledDeck(), confirmed });
  }

  // Rendering receives no session, deck, IDs, full state, or raw timeline.
  return { observation: view?.observation ?? null, history: view?.history ?? [], captured: view?.captured ?? [],
    reviewHistory: isReview ? liveView?.history ?? [] : [],
    canUndo, canReview, reviewCursor: ui.reviewCursor, totalActions, error: ui.local.error, selectedSquare: ui.selectedSquare,
    startGame, clickSquare, undo, restartGame,
    openReview: () => dispatch({ type: 'OPEN_REVIEW' }),
    closeReview: () => dispatch({ type: 'CLOSE_REVIEW' }),
    seekReview: (cursor: number) => dispatch({ type: 'REVIEW_TO', cursor }),
  };
}
