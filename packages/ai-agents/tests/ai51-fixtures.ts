import legacyPositions from './ai51-legacy-positions';
import type { PieceRank } from '../../game-core/src/index';
import {
  accept,
  tacticalSnapshot,
  arrangedInitial,
  type ProjectionFixture,
} from '../../game-core/tests/public-projection-fixtures';

// Diagnostic fixtures preserve observed weaknesses. They do not endorse these choices.
// Complete accepted prefixes avoid invented chase/capture ledgers and ignored report dependencies.
// Original AI-4 benchmark: deck 20005, leg 0, before ply 177.
export const sacrifice = {
  seed: 3581166702,
  deck: 'BC RS BS BE BA RR BH RE RH BE RR BR RA BG RG RS RS RE BS BS RA BS RC BA BR BS RS RH BH RC BC RS',
  prefix:
    'F21 F8 F0 F1 0>8 F29 F25 29>21 F10 F18 8>10 F24 F2 1>2 10>2 F13 F17 21>13 F14 17>18 2>14 18>14 F12 13>17 F20 20>24 25>21 24>25 21>20 25>24 20>21 24>25 21>20 25>24 20>21 24>25 21>20 25>24 20>21 24>20 21>25 20>24 25>21 24>20 21>25 20>24 25>21 24>20 21>25 20>24 25>21 F31 F27 24>25 21>20 25>24 20>21 24>25 21>20 25>24 20>21 24>25 21>20 25>24 20>21 24>20 21>25 20>24 25>21 24>20 21>25 20>24 25>21 24>20 21>25 20>24 25>21 F3 F7 7>3 F30 24>25 21>20 25>29 F22 29>30 F23 17>21 23>22 21>25 22>18 14>13 18>14 13>17 14>13 12>13 F26 17>21 20>24 21>20 F28 20>24 28>29 30>29 F6 3>2 6>10 13>14 F9 14>10 9>13 10>9 13>17 9>13 17>21 13>17 21>25 29>25 F19 27>23 F15 15>19 F11 25>29 11>15 19>18 15>19 23>22 19>18 17>18 F4 22>21 F5 5>9 4>5 9>10 5>6 2>1 6>10 1>5 10>6 5>9 6>10 9>5 10>9 5>6 9>10 6>5 10>6 5>9 6>5 9>13 5>9 13>14 9>13 14>10 13>9 10>6 9>5 6>10 5>9 10>6 9>5 6>10 5>9 10>6 9>5 6>10 5>6 10>9 6>5 9>10 5>6 10>9 6>10 9>13',
};

// Original AI-4 benchmark: deck 20001, leg 1, before ply 76.
export const stall = {
  seed: 4030719552,
  deck: 'BS RE BS BA RA BH BR RS BS BR RH RC RS BS BE BC RH RA BG RS RR RR BS RE BH RS BE BC BA RC RG RS',
  prefix:
    'F30 F22 F14 F13 F12 13>12 F5 F10 F11 14>10 F19 10>11 F9 F28 F1 F24 1>5 9>13 5>9 13>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9 10>14 9>13 14>10 13>9',
};

const ranks: Readonly<Record<string, PieceRank>> = {
  G: 'GENERAL',
  A: 'ADVISOR',
  E: 'ELEPHANT',
  R: 'CHARIOT',
  H: 'HORSE',
  C: 'CANNON',
  S: 'SOLDIER',
};

export function replay(example: {
  readonly deck: string;
  readonly prefix: string;
}): ProjectionFixture {
  const fixture = arrangedInitial(
    example.deck
      .split(' ')
      .map(
        (piece, position) =>
          [position, piece[0] === 'R' ? 'RED' : 'BLACK', ranks[piece[1]!]!] as const,
      ),
  );
  for (const encoded of example.prefix.split(' ')) {
    const [from, to] = encoded.split('>').map(Number);
    accept(
      fixture,
      encoded[0] === 'F'
        ? { type: 'FLIP', position: Number(encoded.slice(1)) }
        : { type: 'MOVE', from: from!, to: to! },
    );
  }
  return fixture;
}

// Frozen geometry is rebased through a different, genuinely accepted v3 setup.
// Historical transcripts remain strict and can be tested for their new rejection.
export function rebasedLegacy(example: typeof sacrifice | typeof stall): ProjectionFixture {
  const data = legacyPositions.positions[example === sacrifice ? 'sacrifice' : 'stall']!;
  return tacticalSnapshot(
    data.entries as readonly (readonly [
      number,
      import('../../game-core/src/types').PieceColor,
      PieceRank,
      boolean,
    ])[],
    data.currentPlayer as import('../../game-core/src/types').PlayerId,
    data.playerColors as import('../../game-core/src/types').PlayerColors,
  );
}
