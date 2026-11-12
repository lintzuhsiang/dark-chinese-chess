import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createInitialState,
  getLegalActions,
  getObservation,
  getPublicOrdinaryMoves,
  projectPermittedPublicAction,
  type GameAction,
  type GameState,
} from '../src/index';
import { deepFreeze } from './fixtures';
import { accept, arrangedInitial, type ProjectionFixture } from './public-projection-fixtures';
import {
  chaseOpening,
  decodeActions,
  fullSupportFixture,
  supportOpening,
  supportPrefix,
  v3Move,
} from './chase-v3-fixtures';

function parity(f: ProjectionFixture, action: GameAction) {
  const observation = getObservation(f.state);
  const reveal = action.type === 'FLIP' ? f.state.board[action.position]!.piece : undefined;
  const expected = applyAction(f.state, f.state.currentPlayer, action);
  const input = deepFreeze({ observation, publicHistory: [...f.history] });
  const snapshot = JSON.stringify(input);
  const actual = projectPermittedPublicAction(input, action, reveal);
  if (expected.ok)
    expect(actual).toEqual({
      ok: true,
      observation: getObservation(expected.state),
      event: expected.event,
    });
  else expect(actual).toEqual(expected);
  expect(JSON.stringify(input)).toBe(snapshot);
  expect(JSON.stringify(actual)).not.toMatch(
    /"(?:id|reference|chase|seed|activePairs|exhaustedPairs|pendingSupport)":/,
  );
  return expected;
}

describe('v4 reconstruction of unchanged historical v3 prefixes', () => {
  it('agrees on every historical prefix through captures, interruptions and aged records', () => {
    const f = supportOpening();
    for (const action of [...supportPrefix, v3Move(0, 1)]) {
      parity(f, action);
      accept(f, action);
    }
    expect(f.state.chase!.records.some((r) => r.ply === f.state.plyCount)).toBe(true);
    expect(f.state.chase!.records.every((r) => r.ply >= f.state.plyCount - 19)).toBe(true);
  });
  it('agrees on the complete legal set after historical helper moves', () => {
    const f = fullSupportFixture();
    accept(f, v3Move(0, 1));
    for (const a of decodeActions('24>25 1>0 25>24 9>13 24>25 13>9 25>24')) accept(f, a);
    expect(f.state.chase!.records.length).toBeGreaterThan(0);
    const color = f.state.playerColors[f.state.currentPlayer]!;
    const candidates: GameAction[] = [
      ...getPublicOrdinaryMoves(getObservation(f.state).board, color),
    ];
    f.state.board.forEach((s, i) => {
      if (s && !s.revealed) candidates.push({ type: 'FLIP', position: i });
    });
    const permitted = [];
    for (const action of candidates) if (parity(f, action).ok) permitted.push(action);
    expect(permitted.map((a) => JSON.stringify(a)).sort()).toEqual(
      getLegalActions(f.state, f.state.currentPlayer)
        .map((a) => JSON.stringify(a))
        .sort(),
    );
    expect(parity(f, v3Move(0, 1)).ok).toBe(true);
  });
  it('preserves in-window records after a FLIP and allows the second appearance', () => {
    const f = supportOpening();
    for (const a of decodeActions(`${chaseOpening} 5>4 1>0 4>5 F29 25>24`)) accept(f, a);
    expect(f.state.chase!.records.length).toBeGreaterThanOrEqual(2);
    expect(parity(f, v3Move(0, 1)).ok).toBe(true);
  });
  it('replays exact v4 ledgers/events from historical prefixes', () => {
    const f = fullSupportFixture();
    const deck = supportOpening().state.board.map((s) => s!.piece);
    accept(f, v3Move(0, 1));
    const initial = createInitialState(deck);
    if (!initial.ok) throw new Error('deck');
    let state: GameState = initial.state;
    for (const event of f.history) {
      const action =
        event.type === 'FLIP'
          ? { type: 'FLIP' as const, position: event.position }
          : v3Move(event.from, event.to);
      const result = applyAction(state, event.playerId, action);
      if (!result.ok) throw new Error(result.error.code);
      expect(result.event).toEqual(event);
      state = result.state;
    }
    expect(state).toEqual(f.state);
    const root = supportOpening();
    expect(root.state.chase).toBeNull();
  });
  it('rejects fabricated capture history and altered reveal/event metadata', () => {
    const f = fullSupportFixture();
    const input = {
      observation: getObservation(f.state),
      publicHistory: f.history.map((e, i) =>
        i === 0 ? { ...e, piece: { color: 'BLACK' as const, rank: 'GENERAL' as const } } : e,
      ),
    };
    expect(() => projectPermittedPublicAction(input, v3Move(0, 1))).toThrow();
    expect(() =>
      projectPermittedPublicAction(
        { observation: getObservation(f.state), publicHistory: [] },
        v3Move(0, 1),
      ),
    ).toThrow();
  });
  it('is independent of actual hidden identities with the same accepted prefix', () => {
    const f = fullSupportFixture();
    const board = [...f.state.board];
    const hidden = board.flatMap((s, i) => (s && !s.revealed ? [i] : []));
    [board[hidden[0]!], board[hidden[1]!]] = [board[hidden[1]!]!, board[hidden[0]!]!];
    const permuted = { state: { ...f.state, board }, history: f.history };
    expect(getObservation(permuted.state)).toEqual(getObservation(f.state));
    const left = parity(permuted, v3Move(0, 1));
    const right = parity(f, v3Move(0, 1));
    expect(left.ok && getObservation(left.state)).toEqual(right.ok && getObservation(right.state));
    expect(left.ok && left.event).toEqual(right.ok && right.event);
  });
  it('tracks initial fork candidates through full replay', () => {
    const f = arrangedInitial([
      [0, 'RED', 'CHARIOT'],
      [5, 'BLACK', 'HORSE'],
      [1, 'BLACK', 'SOLDIER'],
      [4, 'BLACK', 'SOLDIER'],
      [2, 'BLACK', 'SOLDIER'],
      [31, 'BLACK', 'GENERAL'],
    ]);
    for (const a of decodeActions('F0 F1 0>1 F4 1>0 F2 0>4 F5 4>0 F31 0>1')) {
      parity(f, a);
      accept(f, a);
    }
    expect(f.state.chase!.records.filter((r) => r.ply === f.state.plyCount)).toHaveLength(2);
  });
});
