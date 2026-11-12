/** Read-only AI-6 architecture probe. This is not a search policy or a tournament. */
import { performance } from 'node:perf_hooks';
import {
  explainExpectedValueDecision,
  getHiddenPieceDistribution,
  randomAgent,
} from '../../packages/ai-agents/src/index';
import { projectPermittedPublicAction } from '../../packages/game-core/src/index';
import { CORE_REVISION } from './baseline';
import { createMatchRunner } from './match';

const runner = createMatchRunner({
  deckSeed: 50000,
  agentSeed: 20261111,
  agents: { P1: randomAgent, P2: randomAgent },
});
const request = runner.requestDecision();
if (request === null) throw new Error('Expected a nonterminal opening.');
// Read only the public input. No snapshot, deck, or hidden identities enter the probe.
const { input } = request;
const before = JSON.stringify(input);
const distribution = getHiddenPieceDistribution(input);
let rootBranches = 0;
let secondPlyFlipBranchesOnly = 0;
const started = performance.now();
for (const action of input.legalActions) {
  if (action.type !== 'FLIP') throw new Error('Opening should contain only FLIPs.');
  for (const outcome of distribution.outcomes) {
    const next = projectPermittedPublicAction(input, action, outcome.piece);
    if (!next.ok) throw new Error(`Core rejected an opening branch: ${next.error.code}`);
    rootBranches += 1;
    const child = {
      observation: next.observation,
      publicHistory: [...input.publicHistory, next.event],
    };
    const hidden = child.observation.board.filter((square) => square.kind === 'HIDDEN').length;
    secondPlyFlipBranchesOnly += hidden * getHiddenPieceDistribution(child).outcomes.length;
  }
}
const projectionMs = performance.now() - started;
const evDecisionMs: number[] = [];
for (let seed = 0; seed < 12; seed += 1) {
  const start = performance.now();
  const decision = explainExpectedValueDecision(input, { seed });
  evDecisionMs.push(performance.now() - start);
  if (
    !input.legalActions.some(
      (action) => JSON.stringify(action) === JSON.stringify(decision.selectedAction),
    )
  ) {
    throw new Error('EV returned an action outside the supplied set.');
  }
}
if (rootBranches !== 448 || secondPlyFlipBranchesOnly !== 192448) {
  throw new Error('Opening branch-count invariant failed.');
}
if (JSON.stringify(input) !== before) throw new Error('Probe mutated public input.');
console.log(
  JSON.stringify(
    {
      coreRevision: CORE_REVISION,
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      rootActions: input.legalActions.length,
      positiveRevealTypes: distribution.outcomes.length,
      rootBranches,
      secondPlyFlipBranchesOnly,
      projectionMs,
      evDecisionMs,
      notes: [
        'Counts cover FLIP paths only, not all second-ply actions.',
        'Second-ply counts are calculated, not recursively projected or timed.',
        'Timings are local Node opening probes, not browser or six-ply search latency.',
        'No actions were committed and no tournament was run.',
      ],
    },
    null,
    2,
  ),
);
