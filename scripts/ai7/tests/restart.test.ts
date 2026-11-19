import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../../../packages/ai-agents/src/seeded-random';
import {
  supportOpening,
  chaseOpening,
  decodeActions,
} from '../../../packages/game-core/tests/chase-v3-fixtures';
import { tacticalSnapshot } from '../../../packages/game-core/tests/public-projection-fixtures';
import { createEnvironment, actionId } from '../environment';
import { generateRestartArchive } from '../restart_archive';
import {
  describeSnapshot,
  restoreEnvironment,
  snapshotEnvironment,
  validateRestartArchive,
} from '../restart';

function restore(env: ReturnType<typeof createEnvironment>) {
  return restoreEnvironment(JSON.stringify(snapshotEnvironment(env)));
}

describe('training-only restart snapshots', () => {
  it('round-trips private Core state, public memory, legal actions and diagnostic history at every prefix', () => {
    const env = createEnvironment(800000);
    const rng = createSeededRandom(91);
    while (env.summary().result === null) {
      const snapshot = snapshotEnvironment(env);
      const before = JSON.stringify(snapshot);
      const copy = restoreEnvironment(before);
      expect(copy.archive()).toEqual(env.archive());
      expect(copy.observe()).toEqual(env.observe());
      const legal = env.observe().legal;
      const action = legal[Math.floor(rng() * legal.length)]!;
      expect(copy.step(action)).toEqual(env.step(action));
      expect(copy.archive()).toEqual(env.archive());
      expect(JSON.stringify(snapshot)).toBe(before);
    }
    expect(restore(env).archive()).toEqual(env.archive());
  }, 15_000);

  it('preserves quiet=59 and the next authoritative NO_PROGRESS transition', () => {
    let checked = false;
    for (let seed = 1; seed <= 8 && !checked; seed++) {
      const env = createEnvironment(seed);
      const rng = createSeededRandom(seed + 99);
      while (env.summary().result === null) {
        const observation = env.observe();
        const copy = observation.quiet === 59 ? restore(env) : null;
        const action = observation.legal[Math.floor(rng() * observation.legal.length)]!;
        const outcome = env.step(action);
        if (copy) {
          expect(copy.step(action)).toEqual(outcome);
          expect(copy.archive()).toEqual(env.archive());
          if (env.summary().result?.reason === 'NO_PROGRESS') {
            expect(outcome.rewards).toEqual({ P1: 0, P2: 0 });
            checked = true;
          }
        }
      }
    }
    expect(checked).toBe(true);
  });

  it('restores Chase v4 rejection with the exact ledger and no source mutation', () => {
    const fixture = supportOpening();
    const env = createEnvironment(
      0,
      fixture.state.board.map((square) => square!.piece),
    );
    for (const action of decodeActions(`${chaseOpening} 5>4 1>0 4>5 0>1 5>4 1>0 4>5`))
      env.step(actionId(action));
    const copy = restore(env);
    const forbidden = actionId({ type: 'MOVE', from: 0, to: 1 });
    expect(copy.archive().finalState.chase).toEqual(env.archive().finalState.chase);
    expect(copy.observe().legal).not.toContain(forbidden);
    const before = JSON.stringify(copy.archive());
    expect(() => copy.step(forbidden)).toThrow('PERPETUAL_CHASE');
    expect(JSON.stringify(copy.archive())).toBe(before);
    const action = copy.observe().legal[0]!;
    expect(copy.step(action)).toEqual(env.step(action));
    expect(copy.archive()).toEqual(env.archive());
  });

  it('restores the chase-only stalemate terminal boundary', () => {
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
    for (const action of decodeActions('1>0 12>13 0>1 13>12 1>0 12>13 0>1'))
      env.step(actionId(action));
    const copy = restore(env);
    const action = actionId({ type: 'MOVE', from: 13, to: 12 });
    expect(copy.step(action)).toEqual(env.step(action));
    expect(copy.summary().result).toEqual({ type: 'DRAW', reason: 'CHASE_STALEMATE' });
    expect(restore(copy).observe().legal).toEqual([]);
  });

  it('keeps observations identical across hidden arrangements and private IDs after restoration', () => {
    const env = createEnvironment(800000);
    const deck = structuredClone(env.archive().initialDeck);
    const other = [...deck];
    [other[5], other[25]] = [other[25]!, other[5]!];
    const altered = createEnvironment(
      0,
      other.map((piece, index) => ({ ...piece, id: `private-${index}` })),
    );
    for (const action of [0, 1, 2, 3]) {
      env.step(action);
      altered.step(action);
    }
    expect(restore(env).observe()).toEqual(restore(altered).observe());
    const { id: originalId, ...originalDescriptor } = describeSnapshot(snapshotEnvironment(env));
    const { id: alteredId, ...alteredDescriptor } = describeSnapshot(snapshotEnvironment(altered));
    expect(originalId).not.toBe(alteredId);
    expect(originalDescriptor).toEqual(alteredDescriptor);
    expect(restore(env).archive().initialDeck).not.toEqual(restore(altered).archive().initialDeck);
    expect(JSON.stringify(restore(altered).observe())).not.toMatch(/private-|initialDeck|chase/);
  });

  it('rejects corrupted snapshots, actors, history, counters and incompatible rule versions', () => {
    const env = createEnvironment(800000);
    env.step(0);
    const snapshot = snapshotEnvironment(env);
    for (const changed of [
      { ...snapshot, version: 2 },
      { ...snapshot, coreRevision: 'different' },
      { ...snapshot, observationVersion: 'different' },
      { ...snapshot, finalState: { ...snapshot.finalState, noProgressCount: 42 } },
      { ...snapshot, finalState: { ...snapshot.finalState, chase: { records: [] } } },
      { ...snapshot, publicHistory: [] },
      { ...snapshot, observation: { ...snapshot.observation, quiet: 2 } },
      {
        ...snapshot,
        replay: {
          ...snapshot.replay,
          actions: [{ playerId: 'P2', action: { type: 'FLIP', position: 0 } }],
        },
      },
    ])
      expect(() => restoreEnvironment(JSON.stringify(changed))).toThrow();
  });

  it('generates deterministic complete training games and validates common archive provenance', () => {
    const sources: string[] = [];
    const a = generateRestartArchive(3, 800000, (_game, _seed, env) => {
      expect(env.summary().result).not.toBeNull();
      sources.push(JSON.stringify(env.archive()));
    });
    const b = generateRestartArchive(3, 800000, (_game, _seed, env) => {
      expect(JSON.stringify(env.archive())).toBe(sources.shift());
    });
    expect(a).toEqual(b);
    expect(a.archive.records.length).toBeGreaterThan(0);
    expect(validateRestartArchive(JSON.stringify(a.archive))).toEqual(a.archive);
    const record = a.archive.records[0]!;
    expect(describeSnapshot(record.snapshot)).toEqual(record.descriptor);
    for (const altered of [
      { ...a.archive, records: [record, record] },
      { ...a.archive, records: [{ ...record, source: { ...record.source, seed: 21000000 } }] },
      { ...a.archive, records: [{ ...record, source: { ...record.source, seed: 12345 } }] },
      {
        ...a.archive,
        records: [
          {
            ...record,
            descriptor: {
              ...record.descriptor,
              endgameEligible: !record.descriptor.endgameEligible,
            },
          },
        ],
      },
    ])
      expect(() => validateRestartArchive(JSON.stringify(altered))).toThrow();
    expect(() => generateRestartArchive(2, 899999, () => {})).toThrow('training-only');
  });
});
