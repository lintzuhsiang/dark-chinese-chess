import { useMemo, useReducer } from 'react';
import { getObservation } from '@dark-chess/game-core';
import { createShuffledDeck } from '../game/deck';
import { initialLocalGame, sessionReducer } from '../game/session';

export function useLocalGame() {
  const [local, dispatch] = useReducer(sessionReducer, initialLocalGame);
  const currentState = local.session?.currentState;
  const observation = useMemo(() => currentState ? getObservation(currentState) : null, [currentState]);

  function startGame() {
    dispatch({ type: 'START', deck: createShuffledDeck() });
  }

  function flip(position: number) {
    if (observation === null) return;
    dispatch({ type: 'SUBMIT', playerId: observation.currentPlayer, action: { type: 'FLIP', position } });
  }

  // Rendering receives no session, deck, IDs, full state, or raw timeline.
  return { observation, error: local.error, startGame, flip };
}
