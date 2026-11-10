import { describe, expect, it } from 'vitest';
import { getChaseUpdate } from '../src/chase';
import type { GameAction, GameState, PieceColor, PieceRank, PlayerId, Square } from '../src/types';
import { getActionError } from '../src/validation';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function piece(
  position: number,
  rank: PieceRank,
  color: PieceColor = 'RED',
  revealed = true,
  id = `${color}-${rank}-${position}`,
): readonly [number, Square] {
  return [position, { piece: { id, color, rank }, revealed }];
}

function positionState(
  entries: readonly (readonly [number, Square])[],
  currentPlayer: PlayerId = 'P1',
): GameState {
  const board: Square[] = Array.from({ length: 32 }, () => null);
  for (const [position, square] of entries) board[position] = square;
  return deepFreeze({
    board,
    currentPlayer,
    playerColors: { P1: 'RED', P2: 'BLACK' },
    status: 'ACTIVE',
    result: null,
    plyCount: 0,
    noProgressCount: 0,
    chase: null,
  });
}

// Isolates chase classification from outcomes while still requiring ordinary legal actions.
function candidate(before: GameState, action: GameAction): GameState {
  expect(getActionError(before, before.currentPlayer, action)).toBeNull();
  const board = [...before.board];
  let capture = false;
  if (action.type === 'FLIP')
    board[action.position] = { ...board[action.position]!, revealed: true };
  else {
    capture = board[action.to] !== null;
    board[action.to] = board[action.from]!;
    board[action.from] = null;
  }
  return deepFreeze({
    ...before,
    board,
    currentPlayer: before.currentPlayer === 'P1' ? 'P2' : 'P1',
    plyCount: before.plyCount + 1,
    noProgressCount: action.type === 'FLIP' || capture ? 0 : before.noProgressCount + 1,
  });
}

function advance(before: GameState, action: GameAction): GameState {
  const after = candidate(before, action);
  const update = getChaseUpdate(before, after, action);
  expect(update.prohibited).toBe(false);
  return deepFreeze({ ...after, chase: update.chase });
}

function move(before: GameState, from: number, to: number): GameState {
  return advance(before, { type: 'MOVE', from, to });
}

function anchor(extra: readonly (readonly [number, Square])[] = []): GameState {
  return move(positionState([piece(0, 'CHARIOT'), piece(5, 'HORSE', 'BLACK'), ...extra]), 0, 1);
}

const shortRoute: readonly (readonly [number, number])[] = [
  [5, 4],
  [1, 0],
  [4, 5],
  [0, 1],
];
const alternateRoute: readonly (readonly [number, number])[] = [
  [5, 6],
  [1, 5],
  [6, 2],
  [5, 6],
  [2, 1],
  [6, 2],
  [1, 5],
  [2, 1],
];

function route(before: GameState, steps = shortRoute): GameState {
  return steps.reduce((state, [from, to]) => move(state, from, to), before);
}

describe('single-pair chase returns', () => {
  it('anchors at zero, accepts two returns, and prohibits the third without mutating either input', () => {
    let state = anchor();
    expect(state.chase).toMatchObject({
      attackerPlayer: 'P1',
      attackerId: 'RED-CHARIOT-0',
      targetId: 'BLACK-HORSE-5',
      phase: 'ESCAPE',
    });
    const key = Object.keys(state.chase!.positionCounts)[0]!;
    expect(state.chase!.positionCounts).toEqual({ [key]: 1 });
    for (const count of [1, 2]) {
      state = route(state);
      expect(state.chase).toMatchObject({ phase: 'ESCAPE', positionCounts: { [key]: count + 1 } });
    }
    state = route(state, shortRoute.slice(0, -1));
    const action: GameAction = { type: 'MOVE', from: 0, to: 1 };
    const after = candidate(state, action);
    const beforeSnapshot = JSON.stringify(state);
    const afterSnapshot = JSON.stringify(after);
    const result = getChaseUpdate(state, after, action);
    expect(result).toEqual({ prohibited: true, chase: state.chase });
    expect(result.chase).toBe(state.chase);
    expect(JSON.stringify(state)).toBe(beforeSnapshot);
    expect(JSON.stringify(after)).toBe(afterSnapshot);
    expect(getChaseUpdate(state, after, action)).toEqual(result);
  });

  it('counts the same anchor after different qualifying routes', () => {
    const initial = anchor();
    const key = Object.keys(initial.chase!.positionCounts)[0]!;
    let state = route(initial, alternateRoute);
    expect(state.chase?.positionCounts[key]).toBe(2);
    state = route(state);
    expect(state.chase?.positionCounts[key]).toBe(3);
    state = route(state, alternateRoute.slice(0, -1));
    const action: GameAction = { type: 'MOVE', from: 2, to: 1 };
    expect(getChaseUpdate(state, candidate(state, action), action).prohibited).toBe(true);
  });

  it('detects a later chase loop after the attacker takes another route past the first prohibition', () => {
    let state = route(route(anchor()));
    state = route(state, shortRoute.slice(0, -1));
    const firstClosing: GameAction = { type: 'MOVE', from: 0, to: 1 };
    expect(getChaseUpdate(state, candidate(state, firstClosing), firstClosing).prohibited).toBe(
      true,
    );
    state = move(state, 0, 4); // A different legal renewal; the initial anchor is never visited again.
    const laterRoute = [
      [5, 9],
      [4, 8],
      [9, 5],
      [8, 4],
    ] as const;
    state = route(route(state, laterRoute), laterRoute);
    state = route(state, laterRoute.slice(0, -1));
    const laterClosing: GameAction = { type: 'MOVE', from: 8, to: 4 };
    expect(getChaseUpdate(state, candidate(state, laterClosing), laterClosing).prohibited).toBe(
      true,
    );
  });

  it('retains a continuous non-closing pursuit without counting a return', () => {
    let state = anchor();
    for (const [from, to] of [
      [5, 9],
      [1, 5],
      [9, 13],
      [5, 9],
      [13, 17],
      [9, 13],
    ] as const) {
      state = move(state, from, to);
      expect(Object.values(state.chase!.positionCounts).every((count) => count === 1)).toBe(true);
    }
    expect(state.chase?.phase).toBe('ESCAPE');
  });

  it('allows repeated logical board positions with reciprocal threats and no chase tracker', () => {
    let state = move(positionState([piece(0, 'HORSE'), piece(5, 'HORSE', 'BLACK')]), 0, 1);
    const repeated = state.board;
    for (let cycle = 0; cycle < 5; cycle += 1) {
      state = route(state);
      expect(state.board).toEqual(repeated);
      expect(state.chase).toBeNull();
      expect(state.status).toBe('ACTIVE');
    }
  });
});

describe('eligible immediate capture threats', () => {
  it.each([
    ['GENERAL', 'ADVISOR', true],
    ['GENERAL', 'SOLDIER', false],
    ['SOLDIER', 'GENERAL', true],
    ['SOLDIER', 'SOLDIER', false],
    ['SOLDIER', 'CANNON', false],
    ['CHARIOT', 'HORSE', true],
    ['HORSE', 'CHARIOT', false],
    ['HORSE', 'HORSE', false],
    ['CANNON', 'SOLDIER', false],
  ] as const)(
    'starts a %s against %s chase only for a new non-reciprocal threat (%s)',
    (attacker, target, expected) => {
      const state = move(positionState([piece(0, attacker), piece(5, target, 'BLACK')]), 0, 1);
      expect(state.chase !== null).toBe(expected);
    },
  );

  it('excludes multiple eligible new targets but does not count a reciprocal extra target', () => {
    expect(anchor([piece(2, 'SOLDIER', 'BLACK')]).chase).toBeNull();
    expect(anchor([piece(2, 'CHARIOT', 'BLACK')]).chase?.targetId).toBe('BLACK-HORSE-5');
  });

  it('ignores a newly discovered threat by a different piece', () => {
    const state = move(
      positionState([
        piece(0, 'CANNON'),
        piece(8, 'HORSE'),
        piece(12, 'SOLDIER', 'RED', false),
        piece(16, 'GENERAL', 'BLACK'),
      ]),
      8,
      9,
    );
    expect(state.chase).toBeNull();
  });

  it.each([true, false])(
    'uses a single Cannon screen regardless of revelation (%s)',
    (revealed) => {
      const state = move(
        positionState([
          piece(1, 'CANNON'),
          piece(8, 'SOLDIER', 'RED', revealed),
          piece(12, 'GENERAL', 'BLACK'),
        ]),
        1,
        0,
      );
      expect(state.chase).toMatchObject({
        attackerId: 'RED-CANNON-1',
        targetId: 'BLACK-GENERAL-12',
      });
    },
  );

  it.each([
    { screens: [], revealed: true },
    { screens: [4, 8], revealed: true },
    { screens: [8], revealed: false },
  ])(
    'excludes zero/two screens or hidden targets: $screens, target revealed=$revealed',
    ({ screens, revealed }) => {
      const state = move(
        positionState([
          piece(1, 'CANNON'),
          piece(12, 'GENERAL', 'BLACK', revealed),
          ...screens.map((position) => piece(position, 'SOLDIER', 'RED', false)),
        ]),
        1,
        0,
      );
      expect(state.chase).toBeNull();
    },
  );

  it('does not start a chase for a threat that already existed before the quiet move', () => {
    const state = move(
      positionState([
        piece(0, 'CANNON'),
        piece(8, 'SOLDIER', 'RED', false),
        piece(16, 'GENERAL', 'BLACK'),
      ]),
      0,
      4,
    );
    expect(state.chase).toBeNull();
  });
});

describe('continuity, resets, and new chains', () => {
  it('requires the exact target to immediately escape', () => {
    const state = move(anchor([piece(20, 'HORSE', 'BLACK')]), 20, 21);
    expect(state.chase).toBeNull();
  });

  it('requires an escape to remove the capture threat', () => {
    const start = move(
      positionState([
        piece(1, 'CANNON'),
        piece(8, 'SOLDIER', 'RED', false),
        piece(12, 'HORSE', 'BLACK'),
      ]),
      1,
      0,
    );
    expect(move(start, 12, 16).chase).toBeNull();
  });

  it('clears a failed renewal and starts a new chain if the attacker changes target', () => {
    expect(move(move(anchor(), 5, 4), 1, 2).chase).toBeNull();
    const state = move(move(anchor([piece(6, 'SOLDIER', 'BLACK')]), 5, 4), 1, 2);
    expect(state.chase).toMatchObject({
      attackerId: 'RED-CHARIOT-0',
      targetId: 'BLACK-SOLDIER-6',
      phase: 'ESCAPE',
    });
    expect(Object.values(state.chase!.positionCounts)).toEqual([1]);
  });

  it('starts a new chain when a different revealed attacker pursues the target', () => {
    const state = move(move(anchor([piece(3, 'CHARIOT')]), 5, 6), 3, 2);
    expect(state.chase).toMatchObject({
      attackerId: 'RED-CHARIOT-3',
      targetId: 'BLACK-HORSE-5',
      phase: 'ESCAPE',
    });
    expect(Object.values(state.chase!.positionCounts)).toEqual([1]);
  });

  it('resets on a capture or flip', () => {
    const state = anchor([piece(9, 'SOLDIER'), piece(31, 'ADVISOR', 'BLACK', false)]);
    expect(move(state, 5, 9).chase).toBeNull();
    expect(advance(state, { type: 'FLIP', position: 31 }).chase).toBeNull();
    const renewal = move(state, 5, 4);
    expect(advance(renewal, { type: 'FLIP', position: 31 }).chase).toBeNull();
  });

  it('clears the prior chain for a reciprocal or ambiguous renewal', () => {
    const escaped = move(anchor(), 5, 4);
    const reciprocalBoard = [...escaped.board];
    reciprocalBoard[4] = piece(4, 'CHARIOT', 'BLACK', true, 'BLACK-HORSE-5')[1];
    expect(move(deepFreeze({ ...escaped, board: reciprocalBoard }), 1, 0).chase).toBeNull();
    const ambiguousBoard = [...escaped.board];
    ambiguousBoard[9] = piece(9, 'SOLDIER', 'BLACK')[1];
    // From 1 to 5 newly threatens both 4 and 9.
    expect(move(deepFreeze({ ...escaped, board: ambiguousBoard }), 1, 5).chase).toBeNull();
  });
});

describe('logical position keys and physical pair identities', () => {
  it('excludes physical IDs, hidden values, and unrelated counters from position keys', () => {
    const original = positionState([
      piece(0, 'CHARIOT'),
      piece(5, 'HORSE', 'BLACK'),
      piece(31, 'GENERAL', 'RED', false),
    ]);
    const renamed: GameState = deepFreeze({
      ...original,
      plyCount: 25,
      noProgressCount: 38,
      board: original.board.map((square, index) =>
        !square
          ? null
          : !square.revealed
            ? piece(index, 'SOLDIER', 'BLACK', false, 'different-hidden-id')[1]
            : { ...square, piece: { ...square.piece, id: `renamed-${index}` } },
      ),
    });
    const first = move(original, 0, 1);
    const second = move(renamed, 0, 1);
    expect(first.chase?.positionCounts).toEqual(second.chase?.positionCounts);
    expect(first.chase?.attackerId).not.toBe(second.chase?.attackerId);
    expect(JSON.stringify(first.chase?.positionCounts)).not.toMatch(
      /GENERAL|different-hidden-id|RED-CHARIOT-0/,
    );
  });

  it('includes the next player and assignments in logical position comparison', () => {
    const original = positionState([piece(0, 'CHARIOT'), piece(5, 'HORSE', 'BLACK')]);
    const reversed: GameState = deepFreeze({
      ...original,
      currentPlayer: 'P2',
      playerColors: { P1: 'BLACK', P2: 'RED' },
    });
    expect(move(original, 0, 1).chase?.positionCounts).not.toEqual(
      move(reversed, 0, 1).chase?.positionCounts,
    );
  });

  it('does not treat an equal-valued replacement as the same escaping physical target', () => {
    const state = anchor();
    const board = [...state.board];
    board[5] = piece(5, 'HORSE', 'BLACK', true, 'other-black-horse')[1];
    expect(move(deepFreeze({ ...state, board }), 5, 4).chase).toBeNull();
  });

  it('does not inherit the cycle count for an equal-valued replacement attacker', () => {
    const escaped = move(route(route(anchor())), 5, 4);
    const board = [...escaped.board];
    board[1] = piece(1, 'CHARIOT', 'RED', true, 'other-red-chariot')[1];
    const renewed = move(deepFreeze({ ...escaped, board }), 1, 0);
    expect(renewed.chase).toMatchObject({ attackerId: 'other-red-chariot' });
    expect(Object.values(renewed.chase!.positionCounts)).toEqual([1]);
  });
});
