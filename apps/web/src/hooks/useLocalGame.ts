import { useMemo, useReducer } from 'react';
import { getObservation } from '@dark-chess/game-core';
import { createShuffledDeck } from '../game/deck';
import { boardUiReducer, initialBoardUi } from '../game/interaction';

export function useLocalGame() {
  const [ui, dispatch] = useReducer(boardUiReducer, initialBoardUi);
  const currentState = ui.local.session?.currentState;
  const observation = useMemo(() => currentState ? getObservation(currentState) : null, [currentState]);

  function startGame() {
    dispatch({ type: 'START', deck: createShuffledDeck() });
  }

  function clickSquare(position: number) {
    dispatch({ type: 'CLICK', position });
  }

  // Rendering receives no session, deck, IDs, full state, or raw timeline.
  return { observation, error: ui.local.error, selectedSquare: ui.selectedSquare, startGame, clickSquare };
}
