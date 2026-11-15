import { createInterface } from 'node:readline';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { statfsSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { assertCoreBaseline, CORE_REVISION } from '../ai-eval/baseline';
import { reconstructGame } from '../../apps/web/src/game/reconstruct';
import { isDeepStrictEqual } from 'node:util';
import { createAgentInput } from '../ai-eval/agent-input';
import { createExpectedValueAgent } from '../../packages/ai-agents/src/expected-value-agent';
import { tacticalAgent } from '../../packages/ai-agents/src/tactical-agent';
import { actionId, createEnvironment, OBSERVATION_VERSION } from './environment';
import { createEvaluationProbes, createConfirmationProbes } from './probes';

assertCoreBaseline();
type Environment = ReturnType<typeof createEnvironment>;
const games = new Map<number, { env: Environment; archivePath: string | null; seed: number }>();
const outputRoot = resolve(process.argv[2] ?? 'benchmark-results/ai7-selfplay/server');
const experimentRoot = resolve('benchmark-results/ai7-selfplay');
const artifactRoot = resolve(process.env.AI7_ARTIFACT_ROOT ?? experimentRoot);
if (artifactRoot !== experimentRoot && !artifactRoot.startsWith(experimentRoot + '/'))
  throw new Error('Artifact budget root must be inside the AI-7 experiment directory.');
if (!outputRoot.startsWith(experimentRoot + '/'))
  throw new Error('Output must be under the AI-7 experiment directory.');
mkdirSync(outputRoot, { recursive: true });

function artifactBytes(path: string): number {
  return readdirSync(path).reduce((size, name) => {
    const child = resolve(path, name);
    return size + (statSync(child).isDirectory() ? artifactBytes(child) : statSync(child).size);
  }, 0);
}

interface Request {
  readonly command:
    | 'hello'
    | 'reset'
    | 'step'
    | 'baseline'
    | 'benchmark'
    | 'probes'
    | 'confirmation-probes'
    | 'close';
  readonly games?: readonly {
    id: number;
    seed: number;
    archive?: string;
    prefix?: readonly number[];
  }[];
  readonly actions?: readonly { id: number; action: number }[];
  readonly ids?: readonly number[];
  readonly opponent?: 'ev' | 'ai6a';
  readonly steps?: number;
}

function getGame(id: number) {
  const game = games.get(id);
  if (!game) throw new Error(`Unknown game ${id}`);
  return game;
}

async function handle(request: Request): Promise<unknown> {
  switch (request.command) {
    case 'confirmation-probes':
      return createConfirmationProbes();
    case 'probes':
      return createEvaluationProbes();
    case 'hello':
      return {
        coreRevision: CORE_REVISION,
        observationVersion: OBSERVATION_VERSION,
        node: process.version,
        cpu: cpus()[0]?.model,
        cpuCount: cpus().length,
        memoryBytes: totalmem(),
      };
    case 'reset':
      games.clear();
      return request.games!.map(({ id, seed, archive, prefix }) => {
        const archivePath = archive ? resolve(outputRoot, archive) : null;
        if (archivePath && !archivePath.startsWith(outputRoot + '/'))
          throw new Error('Archive outside output directory.');
        const env = createEnvironment(seed);
        for (const action of prefix ?? []) {
          if (env.summary().result) throw new Error('Terminal curriculum prefix');
          env.step(action);
        }
        if (env.summary().result) throw new Error('Terminal curriculum start');
        games.set(id, { env, archivePath, seed });
        return { id, observation: env.observe() };
      });
    case 'step':
      return request.actions!.map(({ id, action }) => {
        const game = getGame(id);
        const outcome = game.env.step(action);
        if (outcome.terminated && game.archivePath) {
          const archive = game.env.archive();
          const replay = reconstructGame(archive.initialDeck, archive.actions);
          if (
            !isDeepStrictEqual(replay.state, archive.finalState) ||
            !isDeepStrictEqual(replay.events, archive.publicHistory)
          )
            throw new Error('Replay verification failed.');
          mkdirSync(resolve(game.archivePath, '..'), { recursive: true });
          const serialized = JSON.stringify({
            ...archive,
            metadata: { coreRevision: CORE_REVISION, deckSeed: game.seed, replayVerified: true },
          });
          const headroom = process.env.AI7_DISK_HEADROOM;
          const disk = headroom ? statfsSync(outputRoot) : null;
          if (
            headroom
              ? disk!.bavail * disk!.bsize < Number(headroom) + Buffer.byteLength(serialized)
              : artifactBytes(artifactRoot) + Buffer.byteLength(serialized) > 5_000_000_000
          )
            throw new Error('5 GB artifact limit reached.');
          writeFileSync(game.archivePath, serialized);
        }
        return {
          id,
          ...outcome,
          observation: outcome.terminated ? null : game.env.observe(),
          summary: outcome.terminated ? game.env.summary() : null,
        };
      });
    case 'baseline': {
      // Evaluation only. Heuristic choices never enter the self-play collector.
      const agent = request.opponent === 'ai6a' ? tacticalAgent : createExpectedValueAgent();
      return Promise.all(
        request.ids!.map(async (id) => {
          const archive = getGame(id).env.archive();
          const state = archive.finalState;
          return {
            id,
            action: actionId(
              await agent.chooseAction(
                createAgentInput(state, archive.publicHistory, state.currentPlayer),
                { seed: (getGame(id).seed ^ state.plyCount) >>> 0 },
              ),
            ),
          };
        }),
      );
    }
    case 'benchmark': {
      const count = request.steps ?? 2000;
      const envs = Array.from({ length: 8 }, (_, id) => createEnvironment(900000 + id));
      const totals = { transitionMs: 0, legalMs: 0, encodingMs: 0, steps: 0, observations: 0 };
      let bytes = 0;
      let serializationMs = 0;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        const index = i % envs.length;
        let env = envs[index]!;
        if (env.summary().result) {
          for (const key of Object.keys(totals) as (keyof typeof totals)[])
            totals[key] += env.timings[key];
          env = createEnvironment(900000 + i);
          envs[index] = env;
        }
        const observation = env.observe();
        const serializationStart = performance.now();
        bytes += JSON.stringify(observation).length;
        serializationMs += performance.now() - serializationStart;
        env.step(observation.legal[((i * 2654435761) >>> 0) % observation.legal.length]!);
      }
      for (const env of envs)
        for (const key of Object.keys(totals) as (keyof typeof totals)[])
          totals[key] += env.timings[key];
      return {
        ...totals,
        wallMs: performance.now() - start,
        serializationMs,
        averageObservationBytes: bytes / count,
      };
    }
    case 'close':
      return { closed: true };
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  try {
    const request = JSON.parse(line) as Request;
    process.stdout.write(JSON.stringify({ ok: true, value: await handle(request) }) + '\n');
    if (request.command === 'close') break;
  } catch (cause) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: cause instanceof Error ? cause.stack : String(cause) }) +
        '\n',
    );
  }
}
