import { describe, expect, it } from 'vitest';
import { getObservation } from '@dark-chess/game-core';
import type { GameAction } from '@dark-chess/game-core';
import { reconstructGame } from '../src/game/reconstruct';
import { initialLocalGame, sessionReducer } from '../src/game/session';
import { arrangedDeck, cycle, flip, freeze, move, opening, pairDeck, recordedGame } from './history-fixtures';

const cannonDeck = () => arrangedDeck([[0, 'RED', 'CANNON'], [8, 'BLACK', 'GENERAL'], [4, 'RED', 'SOLDIER']]);
const fixtures = [
  ['flips, ordinary captures/movement and chase returns/reset', pairDeck(),
    [...opening, ...cycle, ...cycle, ...cycle.slice(0, -1), flip(31)]],
  ['Cannon capture over a hidden screen', cannonDeck(), [flip(0), flip(8), move(0, 8), flip(1)]],
  ['later chase pattern on other squares and its reset', pairDeck(), [
    ...opening, ...cycle, ...cycle, ...cycle.slice(0, -1), move(1, 5),
    ...[move(4, 0), move(5, 1), move(0, 4), move(1, 5)],
    ...[move(4, 0), move(5, 1), move(0, 4), move(1, 5)],
    move(4, 0), move(5, 1), move(0, 4), flip(31),
  ]],
] as const;

describe('canonical reconstruction and exact undo', () => {
  it.each(fixtures)('regenerates every original state/event prefix: %s', (_name, deck, actions) => {
    const game = recordedGame(deck, actions);
    const session = game.final.session!;
    for (let prefix = 0; prefix <= actions.length; prefix += 1) {
      const reconstructed = reconstructGame(freeze(session.initialDeck), freeze(session.actions.slice(0, prefix)));
      expect(reconstructed.state).toEqual(game.states[prefix]!.session!.currentState);
      expect(reconstructed.events).toEqual(game.events.slice(0, prefix));
    }
    expect(session.currentState.plyCount).toBe(actions.length);
  });

  it.each(fixtures)('undoes repeatedly to the original hidden deck without changing earlier states: %s', (_name, deck, actions) => {
    const game = recordedGame(deck, actions);
    let local = game.final;
    const snapshot = JSON.stringify(game);
    const originalDeck = local.session!.initialDeck;
    for (let prefix = actions.length - 1; prefix >= 0; prefix -= 1) {
      local = freeze(sessionReducer(freeze(local), { type: 'UNDO' }));
      expect(local.error).toBeNull();
      expect(local.session).toEqual(game.states[prefix]!.session);
      expect(local.session!.initialDeck).toBe(originalDeck);
      expect(reconstructGame(originalDeck, local.session!.actions).events).toEqual(game.events.slice(0, prefix));
    }
    expect(getObservation(local.session!.currentState).board).toEqual(Array.from({ length: 32 }, () => ({ kind: 'HIDDEN' })));
    expect(local.session!.currentState).toMatchObject({
      currentPlayer: 'P1', playerColors: { P1: null, P2: null }, plyCount: 0,
      noProgressCount: 0, status: 'ACTIVE', result: null, chase: null,
    });
    expect(JSON.stringify(game)).toBe(snapshot);
    const rejected = sessionReducer(local, { type: 'UNDO' });
    expect(rejected.error?.code).toBe('INVALID_ACTION');
    expect(rejected.session).toBe(local.session);
  });

  it('truncates abandoned actions and chase counts before a different continuation', () => {
    const game = recordedGame(pairDeck(), [...opening, ...cycle, ...cycle]);
    let local = sessionReducer(game.final, { type: 'UNDO' });
    expect(local.session!.currentState.chase).toEqual(game.states.at(-2)!.session!.currentState.chase);
    local = sessionReducer(local, { type: 'SUBMIT', playerId: 'P1', action: flip(31) });
    expect(local.error).toBeNull();
    expect(local.session!.currentState.chase).toBeNull();
    expect(local.session!.currentState.noProgressCount).toBe(0);
    expect(local.session!.actions.at(-1)!.action).toEqual(flip(31));
    expect(local.session!.actions).toHaveLength(game.final.session!.actions.length);
    const reconstruction = reconstructGame(local.session!.initialDeck, local.session!.actions);
    expect(reconstruction.events.at(-1)).toMatchObject({ type: 'FLIP', position: 31 });
    expect(reconstruction.state).toEqual(local.session!.currentState);
    expect(sessionReducer(local, { type: 'UNDO' }).session).toEqual(game.states.at(-2)!.session);
  });

  it('preserves a rejected chase attempt and restores its exact tracker after undoing a reset', () => {
    const game = recordedGame(pairDeck(), [...opening, ...cycle, ...cycle, ...cycle.slice(0, -1)]);
    const before = game.final;
    const rejected = sessionReducer(before, { type: 'SUBMIT', playerId: 'P1', action: move(1, 0) });
    expect(rejected.error?.code).toBe('PERPETUAL_CHASE');
    expect(rejected.session).toBe(before.session);
    const flipped = sessionReducer(rejected, { type: 'SUBMIT', playerId: 'P1', action: flip(31) });
    const undone = sessionReducer(flipped, { type: 'UNDO' });
    expect(undone).toEqual(before);
    expect(sessionReducer(undone, { type: 'SUBMIT', playerId: 'P1', action: move(1, 0) }).error?.code)
      .toBe('PERPETUAL_CHASE');
  });

  it('rejects undo before initialization and after a real terminal action', () => {
    expect(sessionReducer(initialLocalGame, { type: 'UNDO' })).toEqual({ session: null, error: { code: 'INVALID_ACTION' } });
    const quietActions: GameAction[] = Array.from({ length: 59 }, (_, index) => cycle[index % 4]!);
    const terminal = recordedGame(pairDeck('HORSE'), [...opening, ...quietActions]).final;
    expect(terminal.session!.currentState.result).toEqual({ type: 'DRAW', reason: 'NO_PROGRESS' });
    const undone = sessionReducer(terminal, { type: 'UNDO' });
    expect(undone.error?.code).toBe('GAME_FINISHED');
    expect(undone.session).toBe(terminal.session);
  });

  it('makes corrupt canonical input observable instead of dropping failed entries', () => {
    expect(() => reconstructGame([], [])).toThrow('Cannot reconstruct game: INVALID_DECK');
    expect(() => reconstructGame(pairDeck(), [
      { playerId: 'P1', action: flip(0) }, { playerId: 'P2', action: flip(0) },
    ])).toThrow('Cannot reconstruct action 2: INVALID_FLIP');
    const started = recordedGame(pairDeck(), []).final;
    const corrupt = freeze({ ...started, session: { ...started.session!, actions: [
      { playerId: 'P2' as const, action: flip(0) }, { playerId: 'P1' as const, action: flip(1) },
    ] } });
    expect(() => sessionReducer(corrupt, { type: 'UNDO' })).toThrow('Cannot reconstruct action 1: NOT_YOUR_TURN');
    expect(corrupt.session.actions).toHaveLength(2);
  });
});

describe('validated restart', () => {
  it('requires confirmation for any active game and preserves it on refusal', () => {
    for (const actions of [[], opening]) {
      const local = recordedGame(pairDeck(), actions).final;
      const rejected = sessionReducer(local, { type: 'RESTART', deck: cannonDeck(), confirmed: false });
      expect(rejected.error?.code).toBe('INVALID_ACTION');
      expect(rejected.session).toBe(local.session);
    }
    expect(sessionReducer(initialLocalGame, { type: 'RESTART', deck: pairDeck(), confirmed: true }).error?.code)
      .toBe('INVALID_ACTION');
  });

  it('replaces only after validation and resets every session/domain field', () => {
    const game = recordedGame(pairDeck(), [...opening, ...cycle]);
    const before = freeze({ ...game.final, error: { code: 'ILLEGAL_MOVE' as const } });
    const invalid = sessionReducer(before, { type: 'RESTART', deck: [], confirmed: true });
    expect(invalid.error?.code).toBe('INVALID_DECK');
    expect(invalid.session).toBe(before.session);
    const replacement = cannonDeck();
    const restarted = sessionReducer(before, { type: 'RESTART', deck: replacement, confirmed: true });
    expect(restarted).toEqual(recordedGame(replacement, []).final);
    expect(restarted.session!.initialDeck).not.toBe(replacement);
    expect(restarted.session!.initialDeck[0]).not.toBe(replacement[0]);
    expect(before.session!.currentState.chase).not.toBeNull();
    // A valid shuffle may coincidentally reproduce exactly the previous ordering.
    expect(sessionReducer(before, { type: 'RESTART', deck: pairDeck(), confirmed: true }).error).toBeNull();
  });

  it('allows finished restart without unfinished-game confirmation and preserves a failed replacement', () => {
    const actions = [...opening, ...Array.from({ length: 59 }, (_, index) => cycle[index % 4]!)];
    const terminal = recordedGame(pairDeck('HORSE'), actions).final;
    const invalid = sessionReducer(terminal, { type: 'RESTART', deck: [], confirmed: false });
    expect(invalid.error?.code).toBe('INVALID_DECK');
    expect(invalid.session).toBe(terminal.session);
    const restarted = sessionReducer(terminal, { type: 'RESTART', deck: pairDeck(), confirmed: false });
    expect(restarted).toEqual(recordedGame(pairDeck(), []).final);
  });
});
