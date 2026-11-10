import { describe, expect, it } from 'vitest';
import { createInitialState, getObservation } from '@dark-chess/game-core';
import { createShuffledDeck } from '../src/game/deck';
import { initialLocalGame, sessionReducer } from '../src/game/session';

const deck = () => createShuffledDeck(() => 1 - Number.EPSILON);
const start = () => sessionReducer(initialLocalGame, { type: 'START', deck: deck() });

describe('local session', () => {
  it('stores the original deck and appends only accepted actor/action entries atomically', () => {
    const initial = start();
    expect(initial.session?.actions).toEqual([]);
    const first = sessionReducer(initial, {
      type: 'SUBMIT',
      playerId: 'P1',
      action: { type: 'FLIP', position: 0 },
    });
    expect(first.error).toBeNull();
    expect(first.session?.actions).toEqual([
      { playerId: 'P1', action: { type: 'FLIP', position: 0 } },
    ]);
    expect(first.session?.currentState.plyCount).toBe(first.session?.actions.length);
    expect(first.session?.initialDeck).toEqual(initial.session?.initialDeck);
    expect(initial.session?.actions).toEqual([]);
    expect(initial.session?.currentState.plyCount).toBe(0);
    expect(first.session).not.toHaveProperty('history');
    expect(first.session).not.toHaveProperty('events');
  });

  it('preserves the exact session on a rejected flip or stale actor, then clears errors on success', () => {
    const first = sessionReducer(start(), {
      type: 'SUBMIT',
      playerId: 'P1',
      action: { type: 'FLIP', position: 0 },
    });
    const invalid = sessionReducer(first, {
      type: 'SUBMIT',
      playerId: 'P2',
      action: { type: 'FLIP', position: 0 },
    });
    expect(invalid.session).toBe(first.session);
    expect(invalid.error?.code).toBe('INVALID_FLIP');
    const stale = sessionReducer(invalid, {
      type: 'SUBMIT',
      playerId: 'P1',
      action: { type: 'FLIP', position: 1 },
    });
    expect(stale.session).toBe(first.session);
    expect(stale.error?.code).toBe('NOT_YOUR_TURN');
    const next = sessionReducer(stale, {
      type: 'SUBMIT',
      playerId: 'P2',
      action: { type: 'FLIP', position: 1 },
    });
    expect(next.error).toBeNull();
    expect(next.session?.actions).toHaveLength(2);
    expect(next.session?.currentState.currentPlayer).toBe('P1');
  });

  it('rejects invalid initialization without creating or replacing a session', () => {
    expect(sessionReducer(initialLocalGame, { type: 'START', deck: [] })).toEqual({
      session: null,
      error: { code: 'INVALID_DECK' },
    });
    const existing = start();
    const invalid = sessionReducer(existing, { type: 'START', deck: [] });
    expect(invalid.session).toBe(existing.session);
    expect(invalid.error?.code).toBe('INVALID_DECK');
    expect(sessionReducer(existing, { type: 'START', deck: deck() }).session).toBe(
      existing.session,
    );
  });

  it('requires initialization before action submission', () => {
    expect(
      sessionReducer(initialLocalGame, {
        type: 'SUBMIT',
        playerId: 'P1',
        action: { type: 'FLIP', position: 0 },
      }),
    ).toEqual({ session: null, error: { code: 'INVALID_ACTION' } });
  });

  it('does not retain writable deck or action payload aliases, and is deterministic under repeated reduction', () => {
    const source = deck();
    const command = { type: 'START' as const, deck: source };
    const initial = sessionReducer(initialLocalGame, command);
    expect(sessionReducer(initialLocalGame, command)).toEqual(initial);
    Object.assign(source[0]!, { color: 'BLACK' });
    expect(initial.session?.initialDeck[0]?.color).toBe('RED');
    expect(initial.session?.currentState.board[0]?.piece.color).toBe('RED');
    expect(initial.session?.initialDeck[0]).not.toBe(initial.session?.currentState.board[0]?.piece);
    const action = { type: 'FLIP' as const, position: 0 };
    const next = sessionReducer(initial, { type: 'SUBMIT', playerId: 'P1', action });
    action.position = 31;
    expect(next.session?.actions[0]?.action).toEqual({ type: 'FLIP', position: 0 });
    expect(getObservation(next.session!.currentState).board[0]?.kind).toBe('REVEALED');
  });
});

describe('deck generation outside transitions', () => {
  it('builds the documented composition and makes independent deck objects', () => {
    const first = deck();
    const second = deck();
    expect(first).toHaveLength(32);
    expect(new Set(first.map((piece) => piece.id)).size).toBe(32);
    expect(createInitialState(first).ok).toBe(true);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });

  it('uses the injected random source deterministically, including the lowest boundary', () => {
    const original = deck();
    expect(createShuffledDeck(() => 0)).toEqual([...original.slice(1), original[0]]);
  });

  it('preserves composition across seeded shuffles', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      let value = seed;
      const random = () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 2 ** 32;
      };
      expect(createInitialState(createShuffledDeck(random)).ok).toBe(true);
    }
  });

  it.each([-0.1, 1, NaN, Infinity])('rejects invalid random source output %s', (sample) => {
    expect(() => createShuffledDeck(() => sample)).toThrow(RangeError);
  });
});
