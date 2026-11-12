import { mkdirSync, writeFileSync } from 'node:fs';
import { diagnoseChaseV3 } from '../../verification/chase-v3-diagnostics';
import { assertCoreBaseline, CORE_REVISION } from './baseline';
import {
  applyAction,
  getLegalActions,
  getObservation,
  getPublicOrdinaryMoves,
  type GameAction,
} from '../../packages/game-core/src/index';
import {
  accept,
  tacticalSnapshot,
} from '../../packages/game-core/tests/public-projection-fixtures';

assertCoreBaseline();
const cases = diagnoseChaseV3();
// This control uses an existing synthetic tactical snapshot; it is deliberately
// separate from the nine real-initial-deck prefixes. No v3 outcome code is used.
const cannon = tacticalSnapshot([
  [1, 'RED', 'CANNON'],
  [12, 'BLACK', 'HORSE'],
  [2, 'BLACK', 'GENERAL'],
  [4, 'BLACK', 'SOLDIER'],
  [5, 'BLACK', 'SOLDIER'],
]);
const move = (from: number, to: number): GameAction => ({ type: 'MOVE', from, to });
for (const action of [move(1, 0), move(12, 13), move(0, 1)]) accept(cannon, action);
const defenderAlternatives = getLegalActions(cannon.state, 'P2').map((action) => {
  const next = applyAction(cannon.state, 'P2', action);
  if (!next.ok) throw new Error(next.error.code);
  return { action, result: next.state.result };
});
const winningAlternative = defenderAlternatives.find(
  ({ action }) => action.type === 'MOVE' && action.from === 2 && action.to === 1,
);
if (winningAlternative?.result?.type !== 'WIN' || winningAlternative.result.winner !== 'P2')
  throw new Error('Expected a winning defender alternative.');
accept(cannon, move(13, 12));
const ordinaryAfterEscape = getPublicOrdinaryMoves(getObservation(cannon.state).board, 'RED');
if (
  ordinaryAfterEscape.length !== 1 ||
  ordinaryAfterEscape[0]!.from !== 1 ||
  ordinaryAfterEscape[0]!.to !== 0 ||
  cannon.state.result !== null
)
  throw new Error('Unexpected Cannon control.');
const cycle = [move(1, 0), move(12, 13), move(0, 1), move(13, 12)];
for (let index = 0; index < 8; index += 1) accept(cannon, cycle[index % 4]!);
const currentOutcome = getObservation(cannon.state).result;
if (currentOutcome?.type !== 'WIN' || currentOutcome.reason !== 'NO_LEGAL_ACTION')
  throw new Error('Expected current chase-only immobilization loss.');
const terminalAudit = {
  fixtureKind: 'synthetic capture-ledger tactical control',
  defenderAlternatives,
  ordinaryAfterEscape,
  currentOutcomeAfterTwelveActions: currentOutcome,
  note: 'V3 would assess chase-only stalemate after four actions under its two-threat limit, but General2→1 is a winning defender alternative. This is not proof of a forced draw.',
};
mkdirSync('benchmark-results', { recursive: true });
writeFileSync(
  'benchmark-results/chase-v3-diagnostics.json',
  JSON.stringify(
    {
      coreRevision: CORE_REVISION,
      note: 'Current-rule reproductions, not a v3 implementation. Tracker IDs are trusted diagnostic data, never AgentInput.',
      cases,
      terminalAudit,
    },
    null,
    2,
  ) + '\n',
);
for (const fixture of cases)
  console.log(
    `${fixture.name}: ${fixture.actions.length} accepted actions; public/private consistency and exact replay passed.`,
  );
