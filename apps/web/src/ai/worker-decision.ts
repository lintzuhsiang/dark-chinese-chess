import {
  expectedValueAgent,
  heuristicAgent,
  randomAgent,
  safetyTieAgent,
  tacticalAgent,
} from '../../../../packages/ai-agents/src/index';
import type { GameAgent } from '../../../../packages/ai-agents/src/types';
import { readAction, type WorkerDecisionRequest, type WorkerDecisionResponse } from './protocol';

const agents = {
  'tactical-6a': tacticalAgent,
  'expected-value': expectedValueAgent,
  'safety-tie-1': safetyTieAgent,
  heuristic: heuristicAgent,
  random: randomAgent,
};

export async function executeAgentDecision(
  request: WorkerDecisionRequest,
  policy: GameAgent = agents[request.agent],
): Promise<WorkerDecisionResponse> {
  const started = performance.now();
  const token = {
    requestId: request.token.requestId,
    generation: request.token.generation,
    revision: request.token.revision,
    playerId: request.token.playerId,
  };
  try {
    // Transport tokens/Agent identity stay outside the policy callable contract.
    const action = readAction(await policy.chooseAction(request.input, { seed: request.seed }));
    if (action === null) throw new Error('Malformed proposal.');
    return { type: 'ACTION', token, action, durationMs: performance.now() - started };
  } catch {
    return { type: 'ERROR', token, code: 'AGENT_ERROR', durationMs: performance.now() - started };
  }
}
