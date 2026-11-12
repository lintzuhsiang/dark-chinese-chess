import type { GameAction } from '../src/index';
import { accept, arrangedInitial } from './public-projection-fixtures';

export const v3Move = (from: number, to: number): GameAction => ({ type: 'MOVE', from, to });
export const v3Flip = (position: number): GameAction => ({ type: 'FLIP', position });
export const chaseOpening =
  'F0 F1 0>1 F4 1>0 F20 0>4 F21 20>21 F24 21>20 F5 20>24 F25 24>20 F31 4>0 F30 0>1';
export function decodeActions(encoded: string): GameAction[] {
  return encoded
    .split(' ')
    .map((s) =>
      s[0] === 'F'
        ? v3Flip(Number(s.slice(1)))
        : v3Move(...(s.split('>').map(Number) as [number, number])),
    );
}
export function supportOpening() {
  return arrangedInitial([
    [0, 'RED', 'CHARIOT'],
    [20, 'RED', 'CHARIOT'],
    [5, 'BLACK', 'HORSE'],
    [1, 'BLACK', 'CANNON'],
    [4, 'BLACK', 'CANNON'],
    [21, 'BLACK', 'SOLDIER'],
    [24, 'BLACK', 'SOLDIER'],
    [25, 'BLACK', 'ELEPHANT'],
    [31, 'BLACK', 'SOLDIER'],
    [30, 'BLACK', 'ADVISOR'],
    [17, 'BLACK', 'HORSE'],
    [13, 'BLACK', 'SOLDIER'],
    [9, 'BLACK', 'SOLDIER'],
  ]);
}
export const supportPrefix = decodeActions(
  `${chaseOpening} 5>4 1>0 4>5 20>21 25>24 F17 24>25 21>17 25>24 F13 24>25 17>13 25>24 F9 24>25 13>9 25>24 9>13 24>25 13>9 25>24`,
);
export function fullSupportFixture() {
  const fixture = supportOpening();
  for (const action of supportPrefix) accept(fixture, action);
  return fixture;
}
