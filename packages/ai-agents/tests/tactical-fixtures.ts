import { tacticalSnapshot } from '../../game-core/tests/public-projection-fixtures';

export const recaptureFixture = () =>
  tacticalSnapshot([
    [9, 'RED', 'ADVISOR'],
    [10, 'BLACK', 'SOLDIER'],
    [11, 'BLACK', 'GENERAL'],
    [24, 'RED', 'SOLDIER'],
    [31, 'BLACK', 'SOLDIER'],
  ]);
export const profitableFixture = () =>
  tacticalSnapshot([
    [9, 'RED', 'SOLDIER'],
    [10, 'BLACK', 'GENERAL'],
    [11, 'BLACK', 'ADVISOR'],
    [24, 'RED', 'ADVISOR'],
    [31, 'BLACK', 'SOLDIER'],
  ]);
export const escapeFixture = () =>
  tacticalSnapshot([
    [9, 'RED', 'HORSE'],
    [10, 'BLACK', 'ADVISOR'],
    [24, 'RED', 'SOLDIER'],
    [31, 'BLACK', 'SOLDIER'],
  ]);
export const forcedLossFixture = () =>
  tacticalSnapshot([
    [9, 'RED', 'SOLDIER'],
    [4, 'BLACK', 'ADVISOR'],
    [6, 'BLACK', 'ADVISOR'],
    [13, 'BLACK', 'ELEPHANT'],
  ]);
export const hiddenTacticalFixture = () =>
  tacticalSnapshot([
    [9, 'RED', 'ADVISOR'],
    [10, 'BLACK', 'SOLDIER'],
    [11, 'BLACK', 'GENERAL'],
    [0, 'RED', 'CANNON', false],
    [31, 'BLACK', 'SOLDIER', false],
  ]);
