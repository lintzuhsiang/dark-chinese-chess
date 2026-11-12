/** Local comparison only: explicitly identifies dirty Core sources, never changes its pin. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import {
  explainTacticalDecision,
  getHiddenPieceDistribution,
} from '../packages/ai-agents/src/index';
import * as core from '../packages/game-core/src/index';
import type { ActionEvent, GameAction, Piece } from '../packages/game-core/src/index';
const {
  applyAction,
  createInitialState,
  getLegalActions,
  getObservation,
  projectPermittedPublicAction,
} = core;
import { pairDeck, opening, cycle, flip } from './fixtures';
import { replay, sacrifice } from '../packages/ai-agents/tests/ai51-fixtures';

const label = process.argv[2];
if (label !== 'old' && label !== 'full' && label !== 'context')
  throw new Error('Specify old, full or context.');
if (label === 'old' && !process.env.CHASE_PROFILE_CORE_DIR)
  throw new Error('Old-Core reruns require --import ./verification/chase-v3-frozen-core.mjs.');
if (label === 'context' && process.env.CHASE_PROFILE_CORE_DIR)
  throw new Error('Do not load frozen sources for a context measurement.');
const file = 'benchmark-results/chase-v3-workloads.json';
mkdirSync('benchmark-results', { recursive: true });
interface Workload {
  name: string;
  deck: readonly Piece[];
  actions: readonly GameAction[];
}
if (label === 'old' && !existsSync(file)) {
  const quiet = [...opening];
  for (let block = 0; block < 10; block += 1)
    quiet.push(
      ...Array.from({ length: 52 }, (_, i) => cycle[i % 4]!),
      flip(12 + block * 2),
      flip(13 + block * 2),
    );
  const example = replay(sacrifice);
  const ranks = {
    G: 'GENERAL',
    A: 'ADVISOR',
    E: 'ELEPHANT',
    R: 'CHARIOT',
    H: 'HORSE',
    C: 'CANNON',
    S: 'SOLDIER',
  } as const;
  const deck = sacrifice.deck.split(' ').map((s, i): Piece => ({
    id: `latency-${i}`,
    color: s[0] === 'R' ? 'RED' : 'BLACK',
    rank: ranks[s[1] as keyof typeof ranks],
  }));
  const workloads: Workload[] = [0, 7, 115, 547].map((length) => ({
    name: length === 0 ? 'opening' : `quiet-history-${length}`,
    deck: pairDeck(),
    actions: quiet.slice(0, length),
  }));
  workloads.push({
    name: 'capture-endgame-176',
    deck,
    actions: example.history.map((e) =>
      e.type === 'FLIP'
        ? { type: 'FLIP', position: e.position }
        : { type: 'MOVE', from: e.from, to: e.to },
    ),
  });
  writeFileSync(file, JSON.stringify(workloads, null, 2));
}
const workloads = JSON.parse(readFileSync(file, 'utf8')) as Workload[];
const results = [];
for (const workload of workloads.filter(
  (w) => process.argv[3] === undefined || w.name === process.argv[3],
)) {
  const initial = createInitialState(workload.deck);
  if (!initial.ok) throw new Error('Invalid measurement deck.');
  let state = initial.state;
  const publicHistory: ActionEvent[] = [];
  let invalidPrefix: string | null = null;
  for (const action of workload.actions) {
    const next = applyAction(state, state.currentPlayer, action);
    if (!next.ok) {
      invalidPrefix = `ply ${publicHistory.length + 1}: ${next.error.code}`;
      break;
    }
    state = next.state;
    publicHistory.push(next.event);
  }
  if (invalidPrefix !== null) {
    results.push({ name: workload.name, invalidPrefix });
    continue;
  }
  const input = {
    observation: getObservation(state),
    publicHistory,
    legalActions: getLegalActions(state, state.currentPlayer),
    perspective: state.currentPlayer,
  };
  const action = input.legalActions[0]!;
  const reveal =
    action.type === 'FLIP' ? getHiddenPieceDistribution(input).outcomes[0]!.piece : undefined;
  const projectionMs = [];
  for (let i = 0; i < 21; i += 1) {
    const t = performance.now();
    const result = projectPermittedPublicAction(input, action, reveal);
    if (!result.ok) throw new Error(result.error.code);
    if (i > 0) projectionMs.push(performance.now() - t);
  }
  const constructionMs: number[] = [],
    incrementalProjectionMs: number[] = [];
  if (label === 'context') {
    for (let i = 0; i < 21; i++) {
      const t = performance.now();
      const context = core.createPublicProjectionContext(input);
      if (i > 0) constructionMs.push(performance.now() - t);
      const start = performance.now();
      const projected = core.projectPublicAction(context, action, reveal);
      if (!projected.ok) throw Error(projected.error.code);
      if (i > 0) incrementalProjectionMs.push(performance.now() - start);
    }
  }
  const decisions = [];
  for (const seed of [0, 1, 2]) {
    const start = performance.now();
    const decision = explainTacticalDecision(input, { seed });
    if (
      !input.legalActions.some((a) => JSON.stringify(a) === JSON.stringify(decision.selectedAction))
    )
      throw new Error('Illegal decision.');
    decisions.push({
      seed,
      durationMs: performance.now() - start,
      action: decision.selectedAction,
      diagnostics: decision.diagnostics,
    });
  }
  const result = {
    name: workload.name,
    historyLength: publicHistory.length,
    revealed: state.board.filter((s) => s?.revealed).length,
    hidden: state.board.filter((s) => s && !s.revealed).length,
    projectionMs,
    constructionMs,
    incrementalProjectionMs,
    decisions,
  };
  results.push(result);
  console.log(
    `${label}: ${workload.name}: ${decisions.map((d) => Math.round(d.durationMs)).join(',')} ms`,
  );
}
const sources = Object.fromEntries(
  readdirSync(process.env.CHASE_PROFILE_CORE_DIR ?? 'packages/game-core/src')
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [
      f,
      createHash('sha256')
        .update(
          readFileSync(`${process.env.CHASE_PROFILE_CORE_DIR ?? 'packages/game-core/src'}/${f}`),
        )
        .digest('hex'),
    ]),
);
writeFileSync(
  `benchmark-results/chase-v3-latency-${label}${process.argv[3] ? '-endgame' : ''}.json`,
  JSON.stringify(
    {
      label,
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sources,
      searchHash: createHash('sha256')
        .update(
          readFileSync(
            `${process.env.CHASE_PROFILE_AGENT_DIR ?? 'packages/ai-agents/src'}/tactical-search.ts`,
          ),
        )
        .digest('hex'),
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      notes: [
        'Local dirty-source latency experiment, not a pinned tournament or browser/phone measurement.',
        'Same exact decks/prefixes/seeds/default search configuration; incompatible prefixes retained as failures, never silently replaced.',
        'One projection warmup per workload; three sequential decision seeds, no decision warmup; small samples are descriptive.',
      ],
      results,
    },
    null,
    2,
  ),
);
