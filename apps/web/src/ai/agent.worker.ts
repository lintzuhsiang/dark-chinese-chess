import { executeAgentDecision } from './worker-decision';
import type { WorkerDecisionRequest, WorkerDecisionResponse } from './protocol';

// A minimal Worker surface avoids mixing DOM and WebWorker ambient libraries.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerDecisionRequest>) => void) | null;
  postMessage: (response: WorkerDecisionResponse) => void;
};
scope.onmessage = (event) => {
  void executeAgentDecision(event.data).then((response) => scope.postMessage(response));
};
