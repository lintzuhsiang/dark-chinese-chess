import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState, getObservation } from '@dark-chess/game-core';
import { createShuffledDeck } from '../src/game/deck';
import { reconstructGame } from '../src/game/reconstruct';
import type { AcceptedAction } from '../src/game/reconstruct';
import { longFixture, shortFixture, shuffleSamples } from '../../../verification/fixtures';
import { freeze } from './history-fixtures';

describe('verification fixtures respect production rules', () => {
  it.each([['short', shortFixture], ['long', longFixture]] as const)('validates every %s action, conservation, prefix reconstruction and public output', (_name, fixture) => {
    const initial = createInitialState(fixture.deck);
    if (!initial.ok) throw new Error('Invalid verification deck.');
    let state = freeze(initial.state);
    let captured = 0;
    const entries: AcceptedAction[] = [];
    for (const [index, action] of fixture.completed.entries()) {
      const playerId = state.currentPlayer;
      const result = applyAction(state, playerId, freeze(action));
      if (!result.ok) throw new Error(`Fixture action ${index + 1}: ${result.error.code}`);
      entries.push({ playerId, action });
      state = freeze(result.state);
      if (result.event.type === 'MOVE' && result.event.captured) captured += 1;
      expect(state.board.filter(square => square !== null).length + captured).toBe(32);
      expect(JSON.stringify(getObservation(state))).not.toMatch(/"id"|attackerId|positionCounts/);
      if ([fixture.active.length, Math.floor(fixture.completed.length / 2), fixture.completed.length].includes(index + 1)) {
        expect(reconstructGame(fixture.deck, entries).state).toEqual(state);
      }
      if (index + 1 < fixture.completed.length) expect(state.status).toBe('ACTIVE');
    }
    expect(state.result).toEqual({ type: 'DRAW', reason: 'NO_PROGRESS' });
    if (_name === 'long') {
      expect(fixture.active).toHaveLength(547);
      expect(fixture.completed).toHaveLength(607);
    }
  });

  it('the test-only random sequence produces the exact valid deck without state injection', () => {
    const samples = shuffleSamples(longFixture.deck);
    let cursor = 0;
    expect(createShuffledDeck(() => samples[cursor++]!)).toEqual(longFixture.deck);
    expect(cursor).toBe(31);
  });
});
