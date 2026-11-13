// Separate offline experiments. None of these scores occurred in the recorded search.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  createPublicProjectionContext,
  projectPublicAction,
  getPublicOrdinaryMoves,
} from '../../packages/game-core/src/index';
import { evaluatePosition } from '../../packages/ai-agents/src/heuristic-evaluation';
import { evaluateProgressPosition } from '../../packages/ai-agents/src/progress-agent';
import {
  evaluateStrategicPosition,
  STRATEGIC_PRESETS,
} from '../../packages/ai-agents/src/strategic-agent';
import { diagnoseDecision, candidateTable } from './search-diagnostics';
import { tacticalDescriptor } from './tactical-descriptor';
import { progressDescriptor, strategicDescriptor } from './feature-descriptor';
import type { AgentInput } from '../../packages/ai-agents/src/types';
import type { GameAction } from '../../packages/game-core/src/index';

const [source, output] = process.argv.slice(2);
if (!source || !output)
  throw new Error('Usage: search-diagnostics-counterfactual.ts TRACE NEW_OUTPUT');
const artifact = JSON.parse(readFileSync(source, 'utf8')) as {
  traces: {
    actionPly: number;
    input: AgentInput;
    decisionSeed: number;
    recordedAction: GameAction;
  }[];
};
const comparisons = artifact.traces
  .filter((t) => t.actionPly === 70 || t.actionPly === 33)
  .map((t) => {
    const effects = t.input.legalActions
      .filter((a) => a.type === 'MOVE')
      .map((action) => {
        const result = projectPublicAction(createPublicProjectionContext(t.input), action);
        if (!result.ok) throw new Error(result.error.code);
        const position = {
          observation: result.observation,
          publicHistory: [...t.input.publicHistory, result.event],
          perspective: t.input.perspective,
        };
        const base = evaluatePosition(position);
        const us = position.observation.playerColors[t.input.perspective]!;
        const enemy = us === 'RED' ? 'BLACK' : 'RED';
        const beforeThreats = new Set(
          getPublicOrdinaryMoves(t.input.observation.board, us)
            .filter((a) => t.input.observation.board[a.to]?.kind === 'REVEALED')
            .map((a) => a.to),
        );
        const afterThreats = new Set(
          getPublicOrdinaryMoves(position.observation.board, us)
            .filter((a) => position.observation.board[a.to]?.kind === 'REVEALED')
            .map((a) => a.to),
        );
        let permittedQuietReplies = 0,
          safeQuietReplies = 0;
        if (position.observation.status === 'ACTIVE')
          for (const reply of getPublicOrdinaryMoves(position.observation.board, enemy)) {
            if (position.observation.board[reply.to]?.kind !== 'EMPTY') continue;
            const next = projectPublicAction(result.nextContext, reply);
            if (!next.ok) continue;
            permittedQuietReplies++;
            if (!getPublicOrdinaryMoves(next.observation.board, us).some((a) => a.to === reply.to))
              safeQuietReplies++;
          }
        return {
          action,
          base,
          progress: evaluateProgressPosition(position, base),
          blockers: evaluateStrategicPosition(position, STRATEGIC_PRESETS.blockers, base),
          beforeThreatenedTargets: [...beforeThreats],
          afterThreatenedTargets: [...afterThreats],
          newThreatenedTargets: [...afterThreats].filter((p) => !beforeThreats.has(p)),
          permittedQuietReplies,
          safeQuietReplies,
          safeReplyDefinition:
            'Quiet Core-permitted opponent MOVE whose destination is not an ordinary public capture target after that reply. No forced-win proof; excludes flips.',
        };
      });
    const policies = [
      tacticalDescriptor('counterfactual-6a'),
      progressDescriptor('counterfactual-6b'),
      strategicDescriptor('counterfactual-6c', 'blockers'),
    ].map((agent) => {
      const { decision } = diagnoseDecision(t.input, t.decisionSeed, agent);
      return {
        implementation: agent.implementation,
        selectedAction: decision.selectedAction,
        diagnostics: decision.diagnostics,
        roots: candidateTable(decision),
      };
    });
    return { actionPly: t.actionPly, policies, effects };
  });
writeFileSync(
  output,
  JSON.stringify(
    {
      mode: 'counterfactual-only',
      source,
      notice:
        'Separate reruns and post-action static measurements; never charged to original diagnostic search budget. Different policy outcomes are not proven improvements.',
      comparisons,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
