/** Evaluation-only rotation audit and independent, naturally reached tactical bank. */
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applyAction,
  createInitialState,
  getLegalActions,
  getObservation,
  type GameAction,
  type ActionEvent,
  type GameState,
} from '../../packages/game-core/src/index';
import { assertCoreBaseline } from '../ai-eval/baseline';
import {
  createEnvironment,
  createPublicMemory,
  actionId,
  decodeAction,
  type PublicInput,
} from './environment';

export const rotateAction = (a: GameAction): GameAction =>
  a.type === 'FLIP'
    ? { type: 'FLIP', position: 31 - a.position }
    : { type: 'MOVE', from: 31 - a.from, to: 31 - a.to };
export const rotateId = (id: number) => actionId(rotateAction(decodeAction(id)));
export const rotateEvent = (e: ActionEvent): ActionEvent =>
  e.type === 'FLIP'
    ? { ...e, position: 31 - e.position }
    : { ...e, from: 31 - e.from, to: 31 - e.to };
const sorted = (ids: readonly number[]) => [...ids].sort((a, b) => a - b);
export function rotateInput(o: PublicInput): PublicInput {
  const ref = (v: number) => (v ? 33 - v : 0);
  return {
    ...o,
    board: [...o.board].reverse(),
    references: [...o.references].reverse().map(ref),
    history: o.history.map((e) => e.map((v, i) => ([2, 3, 4, 5].includes(i) ? ref(v) : v))),
    legal: sorted(o.legal.map(rotateId)),
  };
}
function equal(actual: unknown, expected: unknown, label: string) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`Rotation mismatch: ${label}`);
}
function compare(a: GameState, b: GameState) {
  const o = getObservation(a);
  equal(getObservation(b), { ...o, board: [...o.board].reverse() }, 'public observation / outcome');
  equal(
    sorted(getLegalActions(b, b.currentPlayer).map(actionId)),
    sorted(getLegalActions(a, a.currentPlayer).map((x) => actionId(rotateAction(x)))),
    'legal actions',
  );
  equal([b.plyCount, b.noProgressCount], [a.plyCount, a.noProgressCount], 'counters');
}
type Archive = ReturnType<ReturnType<typeof createEnvironment>['archive']>;
export function validateRotation(archive: Archive) {
  const initial = createInitialState([...archive.initialDeck].reverse());
  const original = createInitialState(archive.initialDeck);
  if (!initial.ok || !original.ok) throw new Error('Invalid replay deck');
  let a = original.state,
    b = initial.state;
  const ma = createPublicMemory(),
    mb = createPublicMemory();
  let prefixChecks = 0,
    branchChecks = 0,
    terminalChecks = 0;
  function check() {
    compare(a, b);
    const oa = ma.encode(getObservation(a), getLegalActions(a, a.currentPlayer));
    const ob = mb.encode(getObservation(b), getLegalActions(b, b.currentPlayer));
    equal(
      { ...ob, legal: sorted(ob.legal) },
      rotateInput(oa),
      'encoded public input / references / recent history',
    );
    prefixChecks++;
  }
  check();
  for (const { action } of archive.actions) {
    const x = applyAction(a, a.currentPlayer, action);
    const y = applyAction(b, b.currentPlayer, rotateAction(action));
    if (!x.ok || !y.ok) throw new Error('Rotation prefix rejected by Core');
    equal(y.event, rotateEvent(x.event), 'full public history event');
    equal(x.event, archive.publicHistory[a.plyCount], 'original full history');
    ma.accept(x.event);
    mb.accept(y.event);
    a = x.state;
    b = y.state;
    check();
  }
  equal(a, archive.finalState, 'original archive replay');
  equal(
    archive.publicHistory.map(rotateEvent).map(rotateEvent),
    archive.publicHistory,
    'history involution',
  );
  // Check every legal first action and every legal reply, including terminal reasons.
  for (const action of getLegalActions(a, a.currentPlayer)) {
    const x = applyAction(a, a.currentPlayer, action);
    const y = applyAction(b, b.currentPlayer, rotateAction(action));
    if (!x.ok || !y.ok) throw new Error('Rotated branch rejected');
    compare(x.state, y.state);
    equal(y.event, rotateEvent(x.event), 'branch event');
    branchChecks++;
    if (x.state.result) terminalChecks++;
    for (const reply of getLegalActions(x.state, x.state.currentPlayer)) {
      const xx = applyAction(x.state, x.state.currentPlayer, reply);
      const yy = applyAction(y.state, y.state.currentPlayer, rotateAction(reply));
      if (!xx.ok || !yy.ok) throw new Error('Rotated reply rejected');
      compare(xx.state, yy.state);
      equal(yy.event, rotateEvent(xx.event), 'reply event');
      branchChecks++;
      if (xx.state.result) terminalChecks++;
    }
  }
  return {
    observation: ma.encode(getObservation(a), getLegalActions(a, a.currentPlayer)),
    rotated: mb.encode(getObservation(b), getLegalActions(b, b.currentPlayer)),
    validation: { prefixChecks, branchChecks, terminalChecks },
  };
}
export function classify(state: GameState) {
  const wins: number[] = [],
    safe: number[] = [],
    unsafe: number[] = [];
  const obs = getObservation(state);
  // Fully revealed only: exact authoritative two-ply outcomes, no hidden-deck oracle.
  if (obs.board.some((s) => s.kind === 'HIDDEN')) return { wins, safe, unsafe };
  const actor = state.currentPlayer;
  for (const action of getLegalActions(state, actor)) {
    const next = applyAction(state, actor, action);
    if (!next.ok) throw new Error('Legal action rejected');
    const result = next.state.result;
    if (result?.type === 'WIN' && result.winner === actor) wins.push(actionId(action));
    const loses =
      (result?.type === 'WIN' && result.winner !== actor) ||
      getLegalActions(next.state, next.state.currentPlayer).some((reply) => {
        const branch = applyAction(next.state, next.state.currentPlayer, reply);
        return (
          branch.ok && branch.state.result?.type === 'WIN' && branch.state.result.winner !== actor
        );
      });
    (loses ? unsafe : safe).push(actionId(action));
  }
  return { wins, safe, unsafe };
}
export function semanticKey(o: PublicInput) {
  const key = (x: PublicInput) => JSON.stringify([x.board, x.player, x.color]);
  return [key(o), key(rotateInput(o))].sort()[0]!;
}
function generate(
  start: number,
  quotas: { early: number; win: number; defense: number },
  excluded: Set<string>,
  deadline: number,
) {
  const bank = [],
    counts = { early: 0, win: 0, defense: 0 };
  let games = 0,
    transitions = 0;
  for (
    let seed = start;
    Object.keys(quotas).some(
      (k) => counts[k as keyof typeof counts] < quotas[k as keyof typeof quotas],
    );
    seed++
  ) {
    if (++games > 12000 || Date.now() > deadline)
      throw new Error(`Generation bound reached: ${JSON.stringify(counts)}`);
    const env = createEnvironment(seed);
    let rng = (seed ^ 0x91ab1234) >>> 0;
    while (!env.summary().result) {
      const observation = env.observe();
      let category: keyof typeof counts | null = null;
      let labels = { wins: [] as number[], safe: [] as number[], unsafe: [] as number[] };
      if (observation.ply === 20 && counts.early < quotas.early) category = 'early';
      else if (
        !observation.board.includes(1) &&
        observation.board.filter((v) => v > 1).length <= 6
      ) {
        labels = classify(env.archive().finalState);
        if (labels.wins.length && counts.win < quotas.win) category = 'win';
        else if (
          !labels.wins.length &&
          labels.safe.length &&
          labels.unsafe.length &&
          counts.defense < quotas.defense
        )
          category = 'defense';
      }
      const key = semanticKey(observation);
      if (category && !excluded.has(key)) {
        const archive = env.archive();
        const checked = validateRotation(archive);
        const rotatedLabels = classify(
          (() => {
            const rotatedEnv = createEnvironment(seed, [...archive.initialDeck].reverse());
            for (const { action } of archive.actions)
              rotatedEnv.step(actionId(rotateAction(action)));
            return rotatedEnv.archive().finalState;
          })(),
        );
        for (const group of ['wins', 'safe', 'unsafe'] as const)
          equal(
            sorted(rotatedLabels[group]),
            sorted(labels[group].map(rotateId)),
            `tactical ${group}`,
          );
        excluded.add(key);
        counts[category]++;
        bank.push({
          id: `${seed}-${observation.ply}`,
          category,
          semanticKey: key,
          labels,
          ...checked,
        });
        break; // At most one selected position per independently seeded game.
      }
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      env.step(observation.legal[rng % observation.legal.length]!);
      transitions++;
      if (transitions % 10000 === 0)
        process.stderr.write(JSON.stringify({ games, transitions, counts }) + '\n');
    }
  }
  return { bank, counts, games, transitions };
}
export function generateBank(output: string, phase: string) {
  if (!['stage1', 'stage2', 'reserved'].includes(phase)) throw new Error('Unknown phase');
  assertCoreBaseline();
  const root = resolve(output);
  if (!root.startsWith(resolve('benchmark-results/ai7-selfplay') + '/'))
    throw new Error('Invalid output');
  mkdirSync(root, { recursive: true });
  const target = resolve(root, `${phase}.json`);
  if (existsSync(target)) throw new Error('Refusing to overwrite bank');
  const excluded = new Set<string>();
  // Independent seed ranges plus semantic rotation-orbit deduplication across splits.
  if (phase !== 'stage1') {
    for (const prior of phase === 'reserved' ? ['stage1', 'stage2'] : ['stage1']) {
      const value = JSON.parse(readFileSync(resolve(root, `${prior}.json`), 'utf8')) as {
        bank: { semanticKey: string }[];
      };
      for (const row of value.bank) excluded.add(row.semanticKey);
    }
  }
  const quotas =
    phase === 'stage1'
      ? { early: 5, win: 5, defense: 10 }
      : phase === 'stage2'
        ? { early: 0, win: 200, defense: 200 }
        : { early: 0, win: 100, defense: 100 };
  const start = phase === 'stage1' ? 11000000 : phase === 'stage2' ? 12000000 : 13000000;
  const result = generate(start, quotas, excluded, Date.now() + 15 * 60 * 1000);
  const text = JSON.stringify({ version: 'symmetry-bank-v1', phase, seedStart: start, ...result });
  if (Buffer.byteLength(text) > 50_000_000) throw new Error('Bank exceeds 50MB bound');
  writeFileSync(target, text);
  writeFileSync(target + '.sha256', createHash('sha256').update(text).digest('hex') + '\n');
  process.stdout.write(JSON.stringify({ phase, ...result, bank: result.bank.length }) + '\n');
}
export function verifyBank(output: string, phase: string) {
  assertCoreBaseline();
  const bank = JSON.parse(readFileSync(resolve(output, `${phase}.json`), 'utf8')) as {
    bank: { id: string; observation: PublicInput; rotated: PublicInput }[];
  };
  for (const row of bank.bank) {
    const [seed, ply] = row.id.split('-').map(Number);
    const env = createEnvironment(seed!);
    let rng = (seed! ^ 0x91ab1234) >>> 0;
    for (let i = 0; i < ply!; i++) {
      const o = env.observe();
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      env.step(o.legal[rng % o.legal.length]!);
    }
    const checked = validateRotation(env.archive());
    equal(checked.observation, row.observation, 'reproduced bank input');
    equal(checked.rotated, row.rotated, 'reproduced rotated input');
  }
  process.stdout.write(JSON.stringify({ verified: bank.bank.length, phase }) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[4] === '--verify') verifyBank(process.argv[2]!, process.argv[3]!);
  else generateBank(process.argv[2]!, process.argv[3] ?? 'stage1');
}
