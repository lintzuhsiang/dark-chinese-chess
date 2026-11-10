import { applyAction, getLegalActions } from '@dark-chess/game-core';
import type { GameAction } from '@dark-chess/game-core';
import { createShuffledDeck } from '../src/game/deck';
import { sessionReducer } from '../src/game/session';
import { cycle, flip, move, opening, pairDeck, recordedGame } from './history-fixtures';

export const finishedHiddenGame = () =>
  recordedGame(pairDeck('HORSE'), [
    ...opening,
    ...Array.from({ length: 59 }, (_, index) => cycle[index % 4]!),
  ]);

export function finishedBranchGame() {
  const deck = createShuffledDeck(() => 1 - Number.EPSILON);
  const original = recordedGame(deck, [flip(0), flip(1)]);
  let local = sessionReducer(original.final, { type: 'UNDO' });
  const quietCycle = [move(13, 12), move(16, 17), move(12, 13), move(17, 16)];
  const continuation = [
    flip(31),
    ...Array.from({ length: 30 }, (_, index) => flip(index + 1)),
    move(12, 16),
    move(17, 16),
    ...Array.from({ length: 60 }, (_, index) => quietCycle[index % 4]!),
  ];
  for (const action of continuation) {
    local = sessionReducer(local, {
      type: 'SUBMIT',
      playerId: local.session!.currentState.currentPlayer,
      action,
    });
    if (local.error) throw new Error(`Branch fixture failed: ${local.error.code}`);
  }
  return {
    ...recordedGame(deck, [flip(0), ...continuation]),
    final: local,
    abandoned: original.events[1]!,
  };
}

export function finishedChaseGame() {
  const deck = pairDeck();
  const actions: GameAction[] = [...opening, ...cycle, ...cycle, ...cycle.slice(0, -1), flip(31)];
  let state = recordedGame(deck, actions).final.session!.currentState;
  // Deterministic test-only continuation; it adds no game controller or UI hints.
  for (let step = 0; state.status === 'ACTIVE' && step < 1000; step += 1) {
    const legal = getLegalActions(state, state.currentPlayer);
    const action =
      legal.find((action) => action.type === 'FLIP') ??
      legal.find((action) => action.type === 'MOVE' && state.board[action.to] !== null) ??
      legal[0];
    if (!action) throw new Error('Chase fixture has no continuation.');
    const result = applyAction(state, state.currentPlayer, action);
    if (!result.ok) throw new Error(`Chase fixture failed: ${result.error.code}`);
    actions.push(action);
    state = result.state;
  }
  if (state.status !== 'FINISHED') throw new Error('Chase fixture did not finish.');
  return recordedGame(deck, actions);
}
