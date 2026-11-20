/** Trusted simulator snapshots. These objects must never cross the policy boundary. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CORE_REVISION } from '../ai-eval/baseline';
import { createEnvironment, actionId, OBSERVATION_VERSION } from './environment';

type Environment = ReturnType<typeof createEnvironment>;
type Archive = ReturnType<Environment['archive']>;

export interface SimulatorSnapshot {
  readonly version: 1;
  readonly coreRevision: string;
  readonly observationVersion: string;
  readonly replay: Pick<Archive, 'initialDeck' | 'actions'>;
  readonly finalState: Archive['finalState'];
  readonly publicHistory: Archive['publicHistory'];
  readonly observation: ReturnType<Environment['observe']>;
}

export interface RestartDescriptor {
  readonly id: string;
  readonly ply: number;
  readonly live: number;
  readonly hidden: number;
  readonly quiet: number;
  readonly stage: 'opening' | 'middle' | 'endgame';
  readonly endgameEligible: boolean;
  readonly publicSha256: string;
}

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

export function snapshotEnvironment(env: Environment): SimulatorSnapshot {
  const archive = env.archive();
  return structuredClone({
    version: 1,
    coreRevision: CORE_REVISION,
    observationVersion: OBSERVATION_VERSION,
    replay: { initialDeck: archive.initialDeck, actions: archive.actions },
    finalState: archive.finalState,
    publicHistory: archive.publicHistory,
    observation: env.observe(),
  });
}

/** Reconstruct through Core, never trust deserialized counters, ledger or events. */
export function restoreEnvironment(serialized: string): Environment {
  const snapshot = JSON.parse(serialized) as SimulatorSnapshot;
  if (
    snapshot.version !== 1 ||
    snapshot.coreRevision !== CORE_REVISION ||
    snapshot.observationVersion !== OBSERVATION_VERSION
  )
    throw new Error('Snapshot version/Core/observation mismatch.');
  const env = createEnvironment(0, structuredClone(snapshot.replay.initialDeck));
  for (const [index, entry] of snapshot.replay.actions.entries()) {
    if (env.archive().finalState.currentPlayer !== entry.playerId)
      throw new Error(`Snapshot actor mismatch at ply ${index + 1}.`);
    env.step(actionId(entry.action));
  }
  if (!isDeepStrictEqual(snapshotEnvironment(env), snapshot))
    throw new Error('Snapshot differs from its authoritative Core replay.');
  return env;
}

export function describeSnapshot(snapshot: SimulatorSnapshot): RestartDescriptor {
  const observation = snapshot.observation;
  const live = observation.board.filter((value) => value !== 0).length;
  const hidden = observation.board.filter((value) => value === 1).length;
  const red = observation.remainingInventory.slice(0, 7).reduce((a, b) => a + b, 0);
  const black = observation.remainingInventory.slice(7).reduce((a, b) => a + b, 0);
  return {
    id: sha256(JSON.stringify(snapshot)),
    ply: observation.ply,
    live,
    hidden,
    quiet: observation.quiet,
    stage: live >= 25 ? 'opening' : live >= 13 ? 'middle' : 'endgame',
    endgameEligible:
      snapshot.finalState.status === 'ACTIVE' &&
      observation.color !== 0 &&
      live >= 4 &&
      live <= 12 &&
      observation.quiet <= 30 &&
      red > 0 &&
      black > 0,
    publicSha256: sha256(JSON.stringify(observation)),
  };
}

export interface RestartRecord {
  readonly descriptor: RestartDescriptor;
  readonly snapshot: SimulatorSnapshot;
  readonly source: { readonly game: number; readonly seed: number; readonly ply: number };
}

export interface RestartArchive {
  readonly version: 1;
  readonly coreRevision: string;
  readonly observationVersion: string;
  readonly records: readonly RestartRecord[];
}

/** Check all records before exposing even one restart to a collector. */
export function validateRestartArchive(serialized: string): RestartArchive {
  const archive = JSON.parse(serialized) as RestartArchive;
  if (
    archive.version !== 1 ||
    archive.coreRevision !== CORE_REVISION ||
    archive.observationVersion !== OBSERVATION_VERSION ||
    !Array.isArray(archive.records) ||
    archive.records.length === 0
  )
    throw new Error('Invalid restart archive metadata.');
  const ids = new Set<string>();
  for (const record of archive.records) {
    const env = restoreEnvironment(JSON.stringify(record.snapshot));
    const expected = describeSnapshot(snapshotEnvironment(env));
    if (
      env.summary().result !== null ||
      expected.ply < 16 ||
      expected.quiet > 50 ||
      !isDeepStrictEqual(record.descriptor, expected) ||
      !Number.isSafeInteger(record.source.game) ||
      record.source.game < 0 ||
      !Number.isSafeInteger(record.source.seed) ||
      record.source.seed < 0 ||
      record.source.seed >= 900_000 ||
      record.source.ply !== expected.ply ||
      ids.has(expected.id)
    )
      throw new Error('Invalid, terminal, ineligible or duplicate restart record.');
    // The source seed must actually produce the recorded private deck.
    if (
      !isDeepStrictEqual(
        createEnvironment(record.source.seed).archive().initialDeck,
        record.snapshot.replay.initialDeck,
      )
    )
      throw new Error('Restart source deck seed mismatch.');
    ids.add(expected.id);
  }
  return archive;
}
