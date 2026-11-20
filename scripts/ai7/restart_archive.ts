/** Training-only fixed archive generator. Never loads evaluation banks or labels. */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createSeededRandom } from '../../packages/ai-agents/src/seeded-random';
import { assertCoreBaseline, CORE_REVISION } from '../ai-eval/baseline';
import { createEnvironment, OBSERVATION_VERSION } from './environment';
import {
  describeSnapshot,
  sha256,
  snapshotEnvironment,
  restoreEnvironment,
  validateRestartArchive,
  type RestartArchive,
  type RestartRecord,
} from './restart';

const root = fileURLToPath(new URL('../../', import.meta.url));
const designPath = resolve(root, 'scripts/ai7/restart-design.json');
export const restartDesign = JSON.parse(readFileSync(designPath, 'utf8')) as {
  archive: {
    source_games: number;
    seed_start: number;
    candidate_stride: number;
    minimum_ply: number;
    maximum_quiet: number;
  };
};

export function generateRestartArchive(
  gameCount: number,
  seedStart: number,
  onSourceGame: (game: number, seed: number, env: ReturnType<typeof createEnvironment>) => void,
): { archive: RestartArchive; candidates: number; duplicates: number; transitions: number } {
  if (
    !Number.isSafeInteger(gameCount) ||
    gameCount < 1 ||
    !Number.isSafeInteger(seedStart) ||
    seedStart < 0 ||
    seedStart + gameCount > 900_000
  )
    throw new Error('Archive games must use a training-only seed range below 900000.');
  const records: RestartRecord[] = [];
  const seen = new Set<string>();
  let candidates = 0;
  let duplicates = 0;
  let transitions = 0;
  for (let game = 0; game < gameCount; game++) {
    const seed = seedStart + game;
    const env = createEnvironment(seed);
    const rng = createSeededRandom((seed ^ 0x4b7123) >>> 0);
    while (env.summary().result === null) {
      const observation = env.observe();
      if (observation.ply >= 4096) throw new Error('Archive game exceeded Core safety bound.');
      if (
        observation.ply >= restartDesign.archive.minimum_ply &&
        observation.ply % restartDesign.archive.candidate_stride === 0 &&
        observation.quiet <= restartDesign.archive.maximum_quiet
      ) {
        candidates++;
        const snapshot = snapshotEnvironment(env);
        const descriptor = describeSnapshot(snapshot);
        if (seen.has(descriptor.id)) duplicates++;
        else {
          seen.add(descriptor.id);
          records.push({ descriptor, snapshot, source: { game, seed, ply: observation.ply } });
        }
      }
      env.step(observation.legal[Math.floor(rng() * observation.legal.length)]!);
      transitions++;
    }
    onSourceGame(game, seed, env);
  }
  return {
    archive: {
      version: 1,
      coreRevision: CORE_REVISION,
      observationVersion: OBSERVATION_VERSION,
      records,
    },
    candidates,
    duplicates,
    transitions,
  };
}

function histogram(values: readonly (string | number)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function main(): void {
  assertCoreBaseline();
  const output = resolve(process.argv[2] ?? '');
  if (!output.startsWith(resolve(root, 'benchmark-results/ai7-selfplay') + '/'))
    throw new Error('Use a fresh archive directory under benchmark-results/ai7-selfplay.');
  // Nonrecursive creation refuses an existing directory, including partial archives.
  mkdirSync(output);
  mkdirSync(resolve(output, 'source-games'));
  const started = performance.now();
  const cpu = process.cpuUsage();
  const files = [
    'scripts/ai7/restart.ts',
    'scripts/ai7/restart_archive.ts',
    'scripts/ai7/restart-design.json',
    'scripts/ai7/environment.ts',
    'scripts/ai-eval/baseline.ts',
    'scripts/ai-eval/register.mjs',
    'package.json',
    'pnpm-lock.yaml',
    'docs/game-rules.md',
    'apps/web/src/game/deck.ts',
    'packages/ai-agents/src/seeded-random.ts',
    ...execFileSync('git', ['ls-files', 'packages/game-core'], { cwd: root, encoding: 'utf8' })
      .trim()
      .split('\n'),
  ];
  const sourceHashes: Record<string, string> = {};
  for (const file of files) {
    sourceHashes[file] = sha256(readFileSync(resolve(root, file)));
    const target = resolve(output, 'source-snapshot', file);
    mkdirSync(resolve(target, '..'), { recursive: true });
    copyFileSync(resolve(root, file), target);
  }
  const sourceGames: { file: string; sha256: string; seed: number; plies: number }[] = [];
  const result = generateRestartArchive(
    restartDesign.archive.source_games,
    restartDesign.archive.seed_start,
    (game, seed, env) => {
      restoreEnvironment(JSON.stringify(snapshotEnvironment(env)));
      const file = resolve(output, 'source-games', `${game}.json`);
      const serialized = JSON.stringify(env.archive());
      writeFileSync(file, serialized, { flag: 'wx' });
      sourceGames.push({
        file: relative(output, file),
        sha256: sha256(serialized),
        seed,
        plies: env.summary().plies,
      });
    },
  );
  const serialized = JSON.stringify(result.archive);
  validateRestartArchive(serialized);
  writeFileSync(resolve(output, 'archive.json'), serialized, { flag: 'wx' });
  const descriptors = result.archive.records.map((record) => record.descriptor);
  const usedCpu = process.cpuUsage(cpu);
  const manifest = {
    version: 1,
    status: 'fixed; all records Core-replayed and validated',
    design: JSON.parse(readFileSync(designPath, 'utf8')) as unknown,
    designSha256: sha256(readFileSync(designPath)),
    archiveSha256: sha256(serialized),
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    sourceHashes,
    sourceGames,
    completeSourceGames: sourceGames.length,
    candidateSnapshots: result.candidates,
    duplicates: result.duplicates,
    retainedSnapshots: descriptors.length,
    endgameSnapshots: descriptors.filter((record) => record.endgameEligible).length,
    generationTransitions: result.transitions,
    stages: histogram(descriptors.map((record) => record.stage)),
    live: histogram(descriptors.map((record) => record.live)),
    hidden: histogram(descriptors.map((record) => record.hidden)),
    quiet: histogram(descriptors.map((record) => record.quiet)),
    wallSeconds: (performance.now() - started) / 1000,
    cpuSeconds: (usedCpu.user + usedCpu.system) / 1_000_000,
    node: process.version,
    selectionUsesOutcome: false,
    reservedBankAccess: false,
  };
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(
    JSON.stringify({
      records: descriptors.length,
      endgame: manifest.endgameSnapshots,
      sha256: manifest.archiveSha256,
      wallSeconds: manifest.wallSeconds,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
