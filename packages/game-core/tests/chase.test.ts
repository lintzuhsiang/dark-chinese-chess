import { describe, expect, it } from 'vitest';
import { getChaseUpdate } from '../src/chase';
import { applyAction, getLegalActions } from '../src/index';
import { evaluateOutcomeFacts } from '../src/outcomes';
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

const records = (state: GameState) => state.chase?.records ?? [];
const attempt = (state: GameState, from: number, to: number) =>
  getChaseUpdate(state, candidate(state, { type: 'MOVE', from, to }), { type: 'MOVE', from, to });
const cycle = [
  [0, 1],
  [31, 30],
  [1, 0],
  [30, 31],
] as const;
function twice(extra: readonly (readonly [number, Square])[] = []): GameState {
  let s = positionState([
    piece(0, 'CHARIOT'),
    piece(5, 'HORSE', 'BLACK'),
    piece(31, 'SOLDIER', 'BLACK'),
    ...extra,
  ]);
  for (let i = 0; i < 2; i++) for (const [from, to] of cycle) s = move(s, from, to);
  return s;
}

describe('v4 rolling physical pair and coordinates', () => {
  it('counts the first two appearances, then rejects the third atomically through both APIs', () => {
    const s = twice();
    expect(records(s).map((r) => r.ply)).toEqual([1, 5]);
    const snapshot = JSON.stringify(s);
    expect(attempt(s, 0, 1)).toEqual({ prohibited: true, chase: s.chase });
    expect(applyAction(s, 'P1', { type: 'MOVE', from: 0, to: 1 })).toEqual({
      ok: false,
      error: { code: 'PERPETUAL_CHASE' },
    });
    expect(getLegalActions(s, 'P1')).not.toContainEqual({ type: 'MOVE', from: 0, to: 1 });
    expect(attempt(s, 0, 1).chase).toBe(s.chase);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
  it('allows pursuit at different coordinate pairs without a permanent pair limit', () => {
    const repeated = twice([piece(20, 'CANNON')]);
    expect(attempt(repeated, 0, 4).prohibited).toBe(false); // Only A's resulting square changes.
    let targetMoved = move(move(repeated, 20, 21), 5, 6);
    targetMoved = move(move(targetMoved, 21, 20), 6, 2);
    expect(attempt(targetMoved, 0, 1).prohibited).toBe(false); // Only B's square changes.
    let s = anchor();
    s = move(move(s, 5, 9), 1, 5);
    s = move(move(s, 9, 13), 5, 9);
    expect(records(s).map((r) => [r.attackerPosition, r.targetPosition])).toEqual([
      [1, 5],
      [5, 9],
      [9, 13],
    ]);
  });
  it.each(['attacker', 'target'] as const)(
    'distinguishes a different physical %s of the same rank/color',
    (member) => {
      const s = twice();
      const board = [...s.board];
      const at = member === 'attacker' ? 0 : 5;
      const old = board[at]!;
      board[at] = { ...old, piece: { ...old.piece, id: 'different-physical-piece' } };
      const other = deepFreeze({ ...s, board });
      expect(attempt(other, 0, 1).prohibited).toBe(false);
      expect(attempt(s, 0, 1).prohibited).toBe(true);
    },
  );
  it.each(['WAIT', 'FLIP', 'CAPTURE'] as const)(
    'preserves counts across unrelated %s and whole-board changes',
    (kind) => {
      let s = twice([piece(20, 'CHARIOT'), piece(21, 'SOLDIER', 'BLACK', kind !== 'FLIP')]);
      const old = records(s);
      s =
        kind === 'FLIP'
          ? advance(s, { type: 'FLIP', position: 21 })
          : move(s, 20, kind === 'CAPTURE' ? 21 : 16);
      s = move(s, 31, 30);
      expect(records(s)).toEqual(old);
      expect(attempt(s, 0, 1).prohibited).toBe(true);
    },
  );
  it('ages records on accepted plies, eventually allowing the same coordinates again', () => {
    let s = twice([piece(20, 'CANNON')]);
    const waiting = [
      [20, 21],
      [31, 30],
      [21, 20],
      [30, 31],
    ] as const;
    for (let i = 0; i < 10; i++) {
      const [from, to] = waiting[i % 4]!;
      s = move(s, from, to);
    }
    expect(s.plyCount).toBe(18);
    expect(attempt(s, 0, 1).prohibited).toBe(true); // ply19 includes ply1
    s = move(move(s, 21, 20), 30, 31);
    expect(s.plyCount).toBe(20);
    s = move(s, 0, 1); // ply21 excludes ply1, retains ply5
    expect(records(s).map((r) => r.ply)).toEqual([5, 21]);
  });
  it.each([
    [1, false],
    [2, true],
  ] as const)('candidate ply21: old record at ply%s prohibits=%s', (oldPly, prohibited) => {
    const s = twice();
    const record = records(s)[0]!;
    // Isolate the inclusive arithmetic boundary, independent of alternating-turn parity.
    const before = deepFreeze({
      ...s,
      plyCount: 20,
      chase: {
        records: [
          { ...record, ply: oldPly },
          { ...record, ply: 15 },
        ],
      },
    });
    expect(attempt(before, 0, 1).prohibited).toBe(prohibited);
  });
  it('expires stale records even on a FLIP without adding threats', () => {
    let s = anchor([piece(31, 'SOLDIER', 'BLACK', false)]);
    s = deepFreeze({ ...s, plyCount: 20 });
    s = advance(s, { type: 'FLIP', position: 31 });
    expect(s.chase).toBeNull();
  });
  it('records both players independently without charging a quiet defender escape', () => {
    let s = anchor([piece(31, 'CHARIOT', 'BLACK'), piece(26, 'HORSE')]);
    s = move(s, 31, 27);
    expect(records(s)).toHaveLength(2);
    expect(new Set(records(s).map((r) => r.attacker)).size).toBe(2);
    const escape = move(anchor(), 5, 9);
    expect(records(escape)).toEqual(records(anchor()));
  });
  it('never prohibits a legal direct capture or requires helper support', () => {
    let s = move(anchor([piece(31, 'SOLDIER', 'BLACK')]), 31, 30);
    s = deepFreeze({ ...s, chase: { records: [records(s)[0]!, { ...records(s)[0]!, ply: 2 }] } });
    expect(applyAction(s, 'P1', { type: 'MOVE', from: 1, to: 5 }).ok).toBe(true);
    const waiting = twice([piece(15, 'CANNON'), piece(10, 'SOLDIER', 'BLACK')]);
    const helped = move(move(waiting, 15, 14), 31, 30);
    expect(attempt(helped, 0, 1).prohibited).toBe(true);
  });
});

describe('v4 independent fork targets', () => {
  it('counts every initial fork target immediately', () => {
    const s = anchor([piece(2, 'SOLDIER', 'BLACK')]);
    expect(records(s).map((r) => [r.attackerPosition, r.targetPosition, r.ply])).toEqual([
      [1, 2, 1],
      [1, 5, 1],
    ]);
  });
  it('rejects an entire new fork when one old target reaches three, leaving no partial record', () => {
    const s = twice([piece(2, 'SOLDIER', 'BLACK', false)]);
    // Preserve the accepted move sequence, replacing its last waiting reply with a FLIP.
    let before = positionState([
      piece(0, 'CHARIOT'),
      piece(5, 'HORSE', 'BLACK'),
      piece(31, 'SOLDIER', 'BLACK'),
      piece(2, 'SOLDIER', 'BLACK', false),
    ]);
    for (const [from, to] of [...cycle, ...cycle.slice(0, 3)]) before = move(before, from, to);
    before = advance(before, { type: 'FLIP', position: 2 });
    expect(records(before)).toEqual(records(s));
    const snapshot = JSON.stringify(before);
    expect(attempt(before, 0, 1)).toEqual({ prohibited: true, chase: before.chase });
    expect(records(before).some((r) => r.targetPosition === 2)).toBe(false);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
  it('keeps original target counts when another fork target changes position', () => {
    let s = anchor([piece(2, 'SOLDIER', 'BLACK')]);
    s = move(move(s, 2, 3), 1, 0);
    s = move(move(s, 3, 2), 0, 1);
    s = move(move(s, 2, 3), 1, 0);
    s = move(s, 3, 7);
    expect(attempt(s, 0, 1).prohibited).toBe(true);
  });
});

describe('authoritative threat geometry', () => {
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
  ] as const)('%s versus %s qualifies=%s', (a, b, qualifies) => {
    expect(records(move(positionState([piece(0, a), piece(5, b, 'BLACK')]), 0, 1)).length > 0).toBe(
      qualifies,
    );
  });
  it.each([true, false])('uses exactly one revealed/hidden Cannon screen (%s)', (revealed) => {
    const s = move(
      positionState([
        piece(1, 'CANNON'),
        piece(8, 'SOLDIER', 'BLACK', revealed),
        piece(12, 'GENERAL', 'BLACK'),
      ]),
      1,
      0,
    );
    expect(records(s)).toHaveLength(1);
  });
  it.each([{ screens: [] }, { screens: [4, 8] }])(
    'excludes Cannon screen geometry $screens',
    ({ screens }) => {
      const s = move(
        positionState([
          piece(1, 'CANNON'),
          piece(12, 'GENERAL', 'BLACK'),
          ...screens.map((p) => piece(p, 'SOLDIER', 'RED', false)),
        ]),
        1,
        0,
      );
      expect(s.chase).toBeNull();
    },
  );
  it('ignores hidden targets and discovered attacks by another mover', () => {
    expect(
      move(positionState([piece(0, 'CHARIOT'), piece(5, 'HORSE', 'BLACK', false)]), 0, 1).chase,
    ).toBeNull();
    expect(
      move(
        positionState([
          piece(0, 'CANNON'),
          piece(8, 'HORSE'),
          piece(12, 'SOLDIER', 'RED', false),
          piece(16, 'GENERAL', 'BLACK'),
        ]),
        8,
        9,
      ).chase,
    ).toBeNull();
  });
  it('ignores maintained threats and ordinary reciprocal repetition', () => {
    let s = move(positionState([piece(0, 'HORSE'), piece(5, 'HORSE', 'BLACK')]), 0, 1);
    for (let i = 0; i < 3; i++)
      for (const [f, t] of [
        [5, 4],
        [1, 0],
        [4, 5],
        [0, 1],
      ])
        s = move(s, f!, t!);
    expect(s.chase).toBeNull();
    expect(
      move(
        positionState([
          piece(0, 'CANNON'),
          piece(8, 'SOLDIER', 'RED', false),
          piece(16, 'GENERAL', 'BLACK'),
        ]),
        0,
        4,
      ).chase,
    ).toBeNull();
  });
});

describe('chase-only stalemate and precedence', () => {
  it.each([0, 52])(
    'draws only after all ordinary actions are chase-filtered (quiet offset%s)',
    (offset) => {
      let s = positionState([
        piece(1, 'CANNON'),
        piece(12, 'HORSE', 'BLACK'),
        piece(2, 'GENERAL', 'BLACK'),
        piece(4, 'SOLDIER', 'BLACK'),
        piece(5, 'SOLDIER', 'BLACK'),
      ]);
      s = { ...s, noProgressCount: offset };
      for (const [f, t] of [
        [1, 0],
        [12, 13],
        [0, 1],
        [13, 12],
        [1, 0],
        [12, 13],
        [0, 1],
      ]) {
        const r = applyAction(s, s.currentPlayer, { type: 'MOVE', from: f!, to: t! });
        if (!r.ok) throw new Error(r.error.code);
        s = r.state;
      }
      const win = applyAction(s, 'P2', { type: 'MOVE', from: 2, to: 1 });
      expect(win.ok && win.state.result).toEqual({
        type: 'WIN',
        winner: 'P2',
        reason: 'NO_PIECES',
      });
      const r = applyAction(s, 'P2', { type: 'MOVE', from: 13, to: 12 });
      expect(r.ok && r.state.result).toEqual({ type: 'DRAW', reason: 'CHASE_STALEMATE' });
      expect(r.ok && getLegalActions(r.state, 'P1')).toEqual([]);
    },
  );
  it.each([
    ['no pieces', false, false, false, 'NO_PIECES'],
    ['ordinary immobilization', true, false, false, 'NO_LEGAL_ACTION'],
    ['chase only', true, true, false, 'CHASE_STALEMATE'],
    ['quiet60', true, true, true, 'NO_PROGRESS'],
  ] as const)('preserves priority: %s', (_, pieces, ordinary, permitted, reason) => {
    expect(
      evaluateOutcomeFacts(
        { currentPlayer: 'P1', nextPlayerHasPieces: pieces, noProgressCount: 60 },
        () => permitted,
        () => ordinary,
      )?.reason,
    ).toBe(reason);
  });
});
