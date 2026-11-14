import { describe, expect, it } from 'vitest';
import {
  applyAction,
  getLegalActions,
  getObservation,
} from '../../../packages/game-core/src/index';
import {
  supportOpening,
  chaseOpening,
  decodeActions,
} from '../../../packages/game-core/tests/chase-v3-fixtures';
import {
  accept,
  tacticalSnapshot,
} from '../../../packages/game-core/tests/public-projection-fixtures';
import { createShuffledDeck } from '../../../apps/web/src/game/deck';
import { createSeededRandom } from '../../../packages/ai-agents/src/seeded-random';
import {
  actionId,
  decodeAction,
  createEnvironment,
  createPublicMemory,
  terminalRewards,
} from '../environment';

describe('AI-7 public environment', () => {
  it('round-trips all 1056 action IDs and rejects invalid IDs', () => {
    for (let id = 0; id < 1056; id++) expect(actionId(decodeAction(id))).toBe(id);
    for (const id of [-1, 1056, 1.1, NaN]) expect(() => decodeAction(id)).toThrow();
  });

  it('has identical policy inputs for different hidden arrangements and private IDs', () => {
    const deck = createShuffledDeck(createSeededRandom(17));
    const other = [...deck];
    [other[5], other[25]] = [other[25]!, other[5]!];
    const a = createEnvironment(0, deck);
    const b = createEnvironment(
      0,
      other.map((piece, index) => ({ ...piece, id: `unrelated-${index}` })),
    );
    for (const action of [0, 1, 2, 3]) {
      expect(a.observe()).toEqual(b.observe());
      a.step(action);
      b.step(action);
    }
    expect(a.observe()).toEqual(b.observe());
    const json = JSON.stringify(a.observe());
    for (const forbidden of ['deck', 'seed', 'chase', 'unrelated', 'GENERAL', 'SOLDIER'])
      expect(json).not.toContain(forbidden);
  });

  it('reveals only the selected square, assigns first-flip colors and keeps public references', () => {
    const env = createEnvironment(41);
    expect(env.observe().legal).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(() => env.step(32)).toThrow('Core rejected');
    env.step(12);
    const observation = env.observe();
    expect(observation.board.filter((token) => token !== 1)).toHaveLength(1);
    expect(observation.references[12]).toBe(13);
    expect(observation.player).toBe(1);
    expect(observation.color).toBe(env.archive().finalState.playerColors.P2 === 'RED' ? 1 : 2);
    expect(observation.hiddenInventory.reduce((a, b) => a + b)).toBe(31);
  });

  it('matches Core legal masks, rewards, terminal states and deterministic replay in complete games', () => {
    const reasons = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 70037, 70049, 70006]) {
      const env = createEnvironment(seed);
      const replay = createEnvironment(seed);
      const random = createSeededRandom(seed + 99);
      for (let ply = 0; ply < 4096; ply++) {
        const observation = env.observe();
        const state = env.archive().finalState;
        expect(observation.legal).toEqual(
          getLegalActions(state, state.currentPlayer).map(actionId),
        );
        expect(replay.observe()).toEqual(observation);
        const action = observation.legal[Math.floor(random() * observation.legal.length)]!;
        const expected = applyAction(state, state.currentPlayer, decodeAction(action));
        expect(expected.ok).toBe(true);
        const result = env.step(action);
        expect(replay.step(action)).toEqual(result);
        expect(env.archive().finalState).toEqual(expected.ok && expected.state);
        if (result.terminated) {
          expect(result.rewards).toEqual(terminalRewards(env.summary().result));
          expect(result.rewards.P1 + result.rewards.P2).toBe(0);
          expect(env.observe().legal).toEqual([]);
          reasons.add(env.summary().result!.reason);
          break;
        }
        expect(result.rewards).toEqual({ P1: 0, P2: 0 });
      }
      expect(env.summary().result).not.toBeNull();
      expect(env.archive()).toEqual(replay.archive());
    }
    expect(reasons.has('NO_PROGRESS')).toBe(true);
  });

  it('preserves Chase v4 rejection and reveal identity continuity from an accepted public prefix', () => {
    const fixture = supportOpening();
    const deck = fixture.state.board.map((square) => square!.piece);
    const env = createEnvironment(0, deck);
    const memory = createPublicMemory();
    for (const action of decodeActions(`${chaseOpening} 5>4 1>0 4>5 0>1 5>4 1>0 4>5`)) {
      accept(fixture, action);
      env.step(actionId(action));
      memory.accept(fixture.history.at(-1)!);
    }
    expect(env.observe()).toEqual(
      memory.encode(
        getObservation(fixture.state),
        getLegalActions(fixture.state, fixture.state.currentPlayer),
      ),
    );
    expect(env.observe().legal).not.toContain(actionId({ type: 'MOVE', from: 0, to: 1 }));
    expect(() => env.step(actionId({ type: 'MOVE', from: 0, to: 1 }))).toThrow('PERPETUAL_CHASE');
    expect(env.observe().references[0]).toBe(1);
    expect(env.archive().finalState).toEqual(fixture.state);
  });

  it('uses winner ownership independently of the terminal current player', () => {
    expect(terminalRewards({ type: 'WIN', winner: 'P1', reason: 'NO_PIECES' })).toEqual({
      P1: 1,
      P2: -1,
    });
    expect(terminalRewards({ type: 'WIN', winner: 'P2', reason: 'NO_LEGAL_ACTION' })).toEqual({
      P1: -1,
      P2: 1,
    });
    expect(terminalRewards({ type: 'DRAW', reason: 'CHASE_STALEMATE' })).toEqual({ P1: 0, P2: 0 });
    expect(terminalRewards(null)).toEqual({ P1: 0, P2: 0 });
  });

  it('replays a chase-only stalemate through the environment with the Core result', () => {
    const fixture = tacticalSnapshot([
      [1, 'RED', 'CANNON'],
      [12, 'BLACK', 'HORSE'],
      [2, 'BLACK', 'GENERAL'],
      [4, 'BLACK', 'SOLDIER'],
      [5, 'BLACK', 'SOLDIER'],
    ]);
    const env = createEnvironment(0, fixture.initialDeck!);
    for (const event of fixture.history)
      env.step(
        actionId(
          event.type === 'FLIP'
            ? { type: 'FLIP', position: event.position }
            : { type: 'MOVE', from: event.from, to: event.to },
        ),
      );
    for (const action of decodeActions('1>0 12>13 0>1 13>12 1>0 12>13 0>1 13>12')) {
      accept(fixture, action);
      const outcome = env.step(actionId(action));
      expect(env.archive().finalState).toEqual(fixture.state);
      expect(outcome.rewards).toEqual({ P1: 0, P2: 0 });
    }
    expect(env.summary().result).toEqual({ type: 'DRAW', reason: 'CHASE_STALEMATE' });
    expect(env.observe().legal).toEqual([]);
  });
});
