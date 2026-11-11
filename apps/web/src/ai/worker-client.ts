import type { AgentInput } from '../../../../packages/ai-agents/src/types';
import { deriveBrowserDecisionSeed } from './decision-seed';
import {
  readWorkerResponse,
  sameAction,
  sameToken,
  type AgentKind,
  type AiFailure,
  type DecisionToken,
  type WorkerDecisionResponse,
} from './protocol';

export const AI_DECISION_TIMEOUT_MS = 10_000;
export type WorkerPort = Pick<
  Worker,
  'onmessage' | 'onerror' | 'onmessageerror' | 'postMessage' | 'terminate'
>;

/** One Worker per request makes termination the hard cancellation boundary. */
export function runWorkerDecision(
  request: {
    readonly token: DecisionToken;
    readonly agent: AgentKind;
    readonly agentSeed: number;
    readonly input: AgentInput;
  },
  callbacks: {
    readonly onAction: (response: Extract<WorkerDecisionResponse, { type: 'ACTION' }>) => void;
    readonly onFailure: (failure: AiFailure) => void;
  },
  dependencies: {
    readonly createWorker?: () => WorkerPort;
    readonly deriveSeed?: typeof deriveBrowserDecisionSeed;
    readonly timeoutMs?: number;
  } = {},
): () => void {
  let settled = false;
  let worker: WorkerPort | null = null;
  const timer = setTimeout(() => fail('TIMEOUT'), dependencies.timeoutMs ?? AI_DECISION_TIMEOUT_MS);
  function dispose() {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    worker?.terminate();
  }
  function fail(failure: AiFailure) {
    if (settled) return;
    dispose();
    callbacks.onFailure(failure);
  }
  const deriveSeed = dependencies.deriveSeed ?? deriveBrowserDecisionSeed;
  void Promise.resolve()
    .then(() =>
      deriveSeed(request.agentSeed, request.token.playerId, request.input.publicHistory.length),
    )
    .then((seed) => {
      if (settled) return;
      try {
        worker = dependencies.createWorker
          ? dependencies.createWorker()
          : new Worker(new URL('./agent.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<unknown>) => {
          if (settled) return;
          const response = readWorkerResponse(event.data);
          if (response === null || !sameToken(request.token, response.token))
            return fail('MALFORMED_RESPONSE');
          if (response.type === 'ERROR') return fail(response.code);
          if (!request.input.legalActions.some((action) => sameAction(action, response.action)))
            return fail('INVALID_ACTION');
          dispose();
          callbacks.onAction(response);
        };
        worker.onerror = (event) => {
          event.preventDefault();
          fail('WORKER_ERROR');
        };
        worker.onmessageerror = () => fail('MALFORMED_RESPONSE');
        // No deck/root seeds, session, state, IDs, or accessors cross into the Worker.
        worker.postMessage({
          type: 'CHOOSE_ACTION',
          token: { ...request.token },
          agent: request.agent,
          input: request.input,
          seed,
        });
      } catch {
        fail('UNAVAILABLE');
      }
    })
    .catch(() => fail('UNAVAILABLE'));
  return dispose;
}
