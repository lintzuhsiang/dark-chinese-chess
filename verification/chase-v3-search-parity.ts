/** Exact decision/coverage parity oracle captured before the approved optimization. */
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { explainTacticalDecision } from '../packages/ai-agents/src/index';
import type { AgentInput } from '../packages/ai-agents/src/types';
import {
  applyAction,
  createInitialState,
  getLegalActions,
  getObservation,
  type GameAction,
  type Piece,
} from '../packages/game-core/src/index';
const file = 'benchmark-results/chase-v3-full-replay-search-oracle.json';
if (process.argv[2] === 'record') {
  const workloads = JSON.parse(
    readFileSync('benchmark-results/chase-v3-workloads.json', 'utf8'),
  ) as { name: string; deck: Piece[]; actions: GameAction[] }[];
  const cases = [];
  for (const w of workloads.filter((w) =>
    ['opening', 'quiet-history-115', 'quiet-history-547', 'common-endgame'].includes(w.name),
  )) {
    const init = createInitialState(w.deck);
    if (!init.ok) throw Error('deck');
    let state = init.state;
    const publicHistory = [];
    for (const action of w.actions) {
      const r = applyAction(state, state.currentPlayer, action);
      if (!r.ok) throw Error(r.error.code);
      state = r.state;
      publicHistory.push(r.event);
    }
    const input: AgentInput = {
      observation: getObservation(state),
      legalActions: getLegalActions(state, state.currentPlayer),
      publicHistory,
      perspective: state.currentPlayer,
    };
    const decision = explainTacticalDecision(input, { seed: 0 });
    cases.push({ name: w.name, input, seed: 0, decision });
    console.log('Recorded ' + w.name);
  }
  writeFileSync(file, JSON.stringify(cases));
} else if (process.argv[2] === 'verify') {
  const cases = JSON.parse(readFileSync(file, 'utf8')) as {
    name: string;
    input: AgentInput;
    seed: number;
    decision: ReturnType<typeof explainTacticalDecision>;
  }[];
  for (const c of cases) {
    const snapshot = JSON.stringify(c.input);
    const actual = explainTacticalDecision(c.input, { seed: c.seed });
    if (!isDeepStrictEqual(actual, c.decision))
      throw Error('Decision/coverage parity mismatch: ' + c.name);
    if (JSON.stringify(c.input) !== snapshot) throw Error('Mutated input');
    console.log('Exact decision/coverage parity: ' + c.name);
  }
} else throw Error('Use record before optimization, verify afterward.');
