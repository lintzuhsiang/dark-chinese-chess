import { useMemo, useReducer } from 'react';
import { getObservation } from '@dark-chess/game-core';
import { createShuffledDeck } from '../game/deck';
import { boardUiReducer, initialBoardUi } from '../game/interaction';
import { reconstructGame } from '../game/reconstruct';

export function useLocalGame() {
  const [ui, dispatch] = useReducer(boardUiReducer, initialBoardUi);
  const currentState = ui.local.session?.currentState;
  const initialDeck = ui.local.session?.initialDeck;
  const actions = ui.local.session?.actions;
  const observation = useMemo(() => currentState ? getObservation(currentState) : null, [currentState]);
  const history = useMemo(() => initialDeck && actions
    ? reconstructGame(initialDeck, actions).events : [], [initialDeck, actions]);
  const captured = useMemo(() => history.flatMap(event => event.type === 'MOVE' && event.captured
    ? [event.captured] : []), [history]);
  const canUndo = currentState?.status === 'ACTIVE' && (actions?.length ?? 0) > 0;

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
    if (!currentState || (currentState.status === 'ACTIVE' && !confirmed)) return;
    dispatch({ type: 'RESTART', deck: createShuffledDeck(), confirmed });
  }

  // Rendering receives no session, deck, IDs, full state, or raw timeline.
  return { observation, history, captured, canUndo, error: ui.local.error, selectedSquare: ui.selectedSquare,
    startGame, clickSquare, undo, restartGame };
}
