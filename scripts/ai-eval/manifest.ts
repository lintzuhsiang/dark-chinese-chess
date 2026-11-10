import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_REVISION } from './baseline';
import { DECISION_SEED_ALGORITHM, PAIR_SEED_ALGORITHM, derivePairSeed } from './seeds';
import type { Competitor, TournamentOptions } from './tournament-types';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_ROOTS = [
  'packages/game-core',
  'packages/ai-agents',
  'scripts/ai-eval',
  'apps/web/src/game/deck.ts',
  'apps/web/src/game/reconstruct.ts',
  'docs/game-rules.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.json',
  'vitest.config.ts',
];

interface SourceFile {
  readonly path: string;
  readonly sha256: string;
}

interface SourceSnapshot {
  readonly digest: string;
  readonly files: readonly SourceFile[];
  readonly trackedPatch: string;
  readonly untrackedFiles: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly contentBase64: string;
  }[];
}

export interface BenchmarkManifest {
  readonly coreRevision: string;
  readonly git: {
    readonly head: string;
    readonly branch: string;
    readonly clean: boolean;
    readonly status: string;
  };
  readonly runner: { readonly implementation: 'ai-eval-v2'; readonly sourceDigest: string };
  readonly agents: Readonly<
    Record<
      Competitor,
      {
        readonly id: string;
        readonly implementation: string;
        readonly configuration: TournamentOptions['agents']['A']['configuration'];
        readonly sourcePaths: readonly string[];
        readonly sourceDigest: string;
      }
    >
  >;
  readonly source: SourceSnapshot;
  readonly sourceStableDuringRun: boolean;
  readonly seedSchedule: {
    readonly deckSeeds: readonly number[];
    readonly agentSeedRoot: number;
    readonly pairAgentSeeds: readonly number[];
    readonly pairSeedAlgorithm: string;
    readonly decisionSeedAlgorithm: string;
    readonly shuffleAlgorithm: 'fisher-yates-mulberry32-v1';
    readonly policyRandomAlgorithm: 'mulberry32-v1';
  };
  readonly limits: { readonly pairs: number; readonly games: number; readonly maxPlies: number };
  readonly environment: {
    readonly node: string;
    readonly versions: Readonly<Record<string, string | undefined>>;
    readonly platform: string;
    readonly arch: string;
    readonly osRelease: string;
    readonly cpuModel: string;
    readonly logicalCpus: number;
  };
  readonly notes: readonly string[];
}

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function digest(files: readonly SourceFile[]): string {
  return hash(JSON.stringify(files.map((file) => [file.path, file.sha256])));
}

function sourceFiles(extraPaths: readonly string[]): string[] {
  const files = new Set<string>();
  function visit(path: string): void {
    const absolute = resolve(ROOT, path);
    const local = relative(ROOT, absolute);
    if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) {
      throw new Error('Benchmark sources must be inside this checkout.');
    }
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink())
      throw new Error('Benchmark source symlinks are unsupported: ' + path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) {
        if (entry !== 'node_modules' && entry !== 'dist' && entry !== '.git')
          visit(join(path, entry));
      }
    } else if (stat.isFile()) {
      files.add(local.split(sep).join('/'));
    }
  }
  for (const path of [...SOURCE_ROOTS, ...extraPaths]) visit(path);
  return [...files].sort();
}

function captureSource(extraPaths: readonly string[]): SourceSnapshot {
  const paths = sourceFiles(extraPaths);
  const tracked = new Set(
    git(['ls-files', '-z', '--', ...paths])
      .split('\0')
      .filter(Boolean),
  );
  const captured = paths.map((path) => ({ path, content: readFileSync(resolve(ROOT, path)) }));
  const files = captured.map((file) => ({ path: file.path, sha256: hash(file.content) }));
  return {
    digest: digest(files),
    files,
    // Roots, rather than existing paths, also capture deleted tracked files.
    trackedPatch: git(['diff', '--binary', 'HEAD', '--', ...SOURCE_ROOTS, ...extraPaths]),
    untrackedFiles: captured
      .filter((file) => !tracked.has(file.path))
      .map((file) => ({
        path: file.path,
        sha256: hash(file.content),
        contentBase64: file.content.toString('base64'),
      })),
  };
}

export function captureManifest(options: TournamentOptions): BenchmarkManifest {
  for (const agent of Object.values(options.agents)) {
    for (const path of agent.sourcePaths) {
      const stat = lstatSync(resolve(ROOT, path));
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('Agent source entrypoints must be regular files: ' + path);
      }
    }
  }
  const source = captureSource([...options.agents.A.sourcePaths, ...options.agents.B.sourcePaths]);
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  const identity = (key: Competitor) => {
    const agent = options.agents[key];
    const sourcePaths = [
      ...new Set(
        agent.sourcePaths.map((path) => relative(ROOT, resolve(ROOT, path)).split(sep).join('/')),
      ),
    ].sort();
    return {
      id: agent.id,
      implementation: agent.implementation,
      configuration: structuredClone(agent.configuration),
      sourcePaths,
      sourceDigest: digest(source.files.filter((file) => sourcePaths.includes(file.path))),
    };
  };
  const hardware = cpus();
  return {
    coreRevision: CORE_REVISION,
    git: {
      head: git(['rev-parse', 'HEAD']).trim(),
      branch: git(['branch', '--show-current']).trim(),
      clean: status.length === 0,
      status,
    },
    runner: {
      implementation: 'ai-eval-v2',
      sourceDigest: digest(source.files.filter((file) => file.path.startsWith('scripts/ai-eval/'))),
    },
    agents: { A: identity('A'), B: identity('B') },
    source,
    sourceStableDuringRun: true,
    seedSchedule: {
      deckSeeds: [...options.deckSeeds],
      agentSeedRoot: options.agentSeed,
      pairAgentSeeds: options.deckSeeds.map((_, index) => derivePairSeed(options.agentSeed, index)),
      pairSeedAlgorithm: PAIR_SEED_ALGORITHM,
      decisionSeedAlgorithm: DECISION_SEED_ALGORITHM,
      shuffleAlgorithm: 'fisher-yates-mulberry32-v1',
      policyRandomAlgorithm: 'mulberry32-v1',
    },
    limits: {
      pairs: options.deckSeeds.length,
      games: options.deckSeeds.length * 2,
      maxPlies: options.maxPlies ?? 4096,
    },
    environment: {
      node: process.version,
      versions: { ...process.versions },
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
      cpuModel: hardware[0]?.model ?? 'unknown',
      logicalCpus: hardware.length,
    },
    notes: [
      'Source hashes identify the selected checkout files; trackedPatch and base64 untracked files archive dirty sources against git.head.',
      'Custom Agent descriptors must declare their source files and local dependencies outside the standard captured roots, plus JSON configuration; policies must be deterministic and stateless between matches.',
      'Decision latency includes synchronous policy work, awaited Promise settlement and event-loop delay; excludes input preparation and Core validation/commit. Latency is not reproducible across runs or machines.',
      'Hoeffding intervals treat each complete pair as one bounded observation and assume independently sampled representative pairs. Distinct deterministic seeds alone do not establish this assumption.',
      'Failed or truncated games are unscored. Complete-case pair intervals can be biased when incompleteness depends on strategy; report all attempted and complete denominators.',
      'No hard timeouts, cancellation, supervision or decision-time budgets are implemented; budget overruns are not applicable.',
    ],
  };
}

export function finalizeManifest(start: BenchmarkManifest): BenchmarkManifest {
  try {
    const end = captureSource([...start.agents.A.sourcePaths, ...start.agents.B.sourcePaths]);
    const stable =
      start.git.head === git(['rev-parse', 'HEAD']).trim() && start.source.digest === end.digest;
    return {
      ...start,
      sourceStableDuringRun: stable,
      notes: stable
        ? start.notes
        : [
            ...start.notes,
            'Source changed during this run. This report does not identify a single reproducible executed version.',
          ],
    };
  } catch (cause) {
    return {
      ...start,
      sourceStableDuringRun: false,
      notes: [
        ...start.notes,
        'End-of-run source verification failed; reproducibility is not established: ' +
          (cause instanceof Error ? cause.message : String(cause)),
      ],
    };
  }
}
