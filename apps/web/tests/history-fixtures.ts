import { applyAction } from '@dark-chess/game-core';
import type { ActionEvent, GameAction, Piece, PieceColor, PieceRank } from '@dark-chess/game-core';
import { createShuffledDeck } from '../src/game/deck';
import { initialLocalGame, sessionReducer } from '../src/game/session';
import type { LocalGameState } from '../src/game/session';

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function arrangedDeck(fixed: readonly (readonly [number, PieceColor, PieceRank])[]): Piece[] {
  const remaining = createShuffledDeck(() => 1 - Number.EPSILON);
  const placed = new Map<number, Piece>();
  for (const [position, color, rank] of fixed) {
    const index = remaining.findIndex(piece => piece.color === color && piece.rank === rank);
    if (index < 0) throw new Error('Missing fixture piece.');
    placed.set(position, remaining.splice(index, 1)[0]!);
  }
  return Array.from({ length: 32 }, (_, position) => placed.get(position) ?? remaining.shift()!);
}

export const pairDeck = (attacker: 'CHARIOT' | 'HORSE' = 'CHARIOT') => arrangedDeck([
  [0, 'RED', attacker], [1, 'BLACK', 'SOLDIER'], [4, 'RED', 'SOLDIER'], [5, 'BLACK', 'HORSE'],
]);
export const flip = (position: number): GameAction => ({ type: 'FLIP', position });
export const move = (from: number, to: number): GameAction => ({ type: 'MOVE', from, to });
export const opening: readonly GameAction[] = [flip(0), flip(1), flip(4), flip(5), move(0, 1), move(5, 4), move(1, 0)];
export const cycle: readonly GameAction[] = [move(4, 5), move(0, 1), move(5, 4), move(1, 0)];

export function recordedGame(deck: readonly Piece[], actions: readonly GameAction[]) {
  const states: LocalGameState[] = [freeze(sessionReducer(initialLocalGame, { type: 'START', deck }))];
  const events: ActionEvent[] = [];
  for (const action of actions) {
    const before = states.at(-1)!;
    const playerId = before.session!.currentState.currentPlayer;
    const result = applyAction(before.session!.currentState, playerId, action);
    if (!result.ok) throw new Error(`Fixture rejected action ${events.length + 1}: ${result.error.code}`);
    events.push(result.event);
    states.push(freeze(sessionReducer(before, { type: 'SUBMIT', playerId, action })));
  }
  return { states, events, final: states.at(-1)! };
}
