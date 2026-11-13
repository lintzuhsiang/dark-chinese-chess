/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { CORE_REVISION } from '../../../scripts/ai-eval/baseline';
import { finishedBranchGame } from './review-fixtures';
import type { CoreIdentity } from '../src/replay/model';

const root = new URL('../../../', import.meta.url);
export const replayCore: CoreIdentity = {
  revision: CORE_REVISION,
  files: Object.fromEntries(
    [
      ...readdirSync(new URL('packages/game-core/src/', root))
        .filter((p) => p.endsWith('.ts'))
        .map((p) => `packages/game-core/src/${p}`),
      'docs/game-rules.md',
    ].map((path) => [
      path,
      createHash('sha256')
        .update(readFileSync(new URL(path, root)))
        .digest('hex'),
    ]),
  ),
};

export function replayFixture() {
  const game = finishedBranchGame();
  const session = game.final.session!;
  const values = {
    GENERAL: 8,
    ADVISOR: 6,
    ELEPHANT: 5,
    CHARIOT: 4,
    HORSE: 3,
    CANNON: 5,
    SOLDIER: 2,
  };
  const report = {
    metadata: {
      coreRevision: CORE_REVISION,
      deckSeed: 70000,
      agentSeed: 123,
      initialization: 'EXPLICIT_DECK',
      agentConfiguration: { P1: 'test-A', P2: 'test-B' },
      environment: { node: 'test', platform: 'test' },
    },
    initialDeck: session.initialDeck,
    actions: session.actions,
    publicHistory: game.events,
    finalState: session.currentState,
    outcome: { type: 'COMPLETED', result: session.currentState.result },
    decisions: session.actions.map((entry, ply) => ({
      playerId: entry.playerId,
      ply,
      durationMs: ply + 0.5,
      status: 'ACCEPTED',
    })),
  };
  const match = {
    pairIndex: 0,
    leg: 0,
    deckSeed: 70000,
    agentSeed: 123,
    seats: { P1: 'A', P2: 'B' },
    gameLength: session.actions.length,
    gameResult: session.currentState.result,
    report,
    scoreA: 0.5,
    failure: null,
  };
  return {
    game,
    tournament: {
      schemaVersion: 1,
      configuration: {
        agents: {
          A: { id: 'test-A', configuration: { pieceValues: values } },
          B: { id: 'test-B', configuration: { pieceValues: { ...values, CANNON: 6 } } },
        },
      },
      manifest: {
        coreRevision: CORE_REVISION,
        runner: { implementation: 'ai-eval-v2' },
        sourceStableDuringRun: false,
        source: {
          files: Object.entries(replayCore.files).map(([path, sha256]) => ({ path, sha256 })),
        },
      },
      matches: [match, { ...match, leg: 1, report: { ...report } }],
    },
  };
}
