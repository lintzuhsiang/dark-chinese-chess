import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../../../packages/game-core/tests/fixtures';
import { rebasedLegacy, sacrifice } from '../../../packages/ai-agents/tests/ai51-fixtures';
import { createAgentInput } from '../src/game/agent-input';
import { executeAgentDecision } from '../src/ai/worker-decision';
import { readWorkerResponse, type WorkerDecisionRequest } from '../src/ai/protocol';
import { runWorkerDecision, type WorkerPort } from '../src/ai/worker-client';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const input = () => createAgentInput(initialState(), [], 'P1');
const token = { requestId: 1, generation: 3, revision: 4, playerId: 'P1' as const };
const response = {
  type: 'ACTION' as const,
  token,
  action: { type: 'FLIP' as const, position: 0 },
  durationMs: 1,
};

function workerFixture() {
  const port: WorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  const onAction = vi.fn();
  const onFailure = vi.fn();
  const createWorker = vi.fn(() => port);
  const deriveSeed = vi.fn(async () => 123);
  const cancel = runWorkerDecision(
    { token, agent: 'expected-value', agentSeed: 77, input: input() },
    { onAction, onFailure },
    { createWorker, deriveSeed, timeoutMs: 100 },
  );
  const emit = (data: unknown) =>
    port.onmessage?.call(port as Worker, new MessageEvent('message', { data }));
  return { port, onAction, onFailure, createWorker, deriveSeed, cancel, emit };
}

describe('browser decision seeds and Worker contract', () => {
  it.each(['random', 'heuristic', 'expected-value', 'safety-tie-1', 'tactical-6a'] as const)(
    'runs the real %s policy from public input in the Worker handler',
    async (agent) => {
      const request: WorkerDecisionRequest = {
        type: 'CHOOSE_ACTION',
        token,
        agent,
        input: input(),
        seed: 123,
      };
      const value = await executeAgentDecision(request);
      expect(value.type).toBe('ACTION');
      if (value.type !== 'ACTION') throw new Error('Expected action.');
      expect(request.input.legalActions).toContainEqual(value.action);
      expect(value.durationMs).toBeGreaterThanOrEqual(0);
      expect(value.token).toEqual(token);
      expect(JSON.stringify(value)).not.toMatch(/agentSeed|initialDeck|pieceId|GameState/);
    },
  );

  it('routes the real sacrifice input to the new variant while preserving baseline EV', async () => {
    const fixture = rebasedLegacy(sacrifice);
    const publicInput = createAgentInput(fixture.state, fixture.history, 'P1');
    const request: WorkerDecisionRequest = {
      type: 'CHOOSE_ACTION',
      token,
      agent: 'safety-tie-1',
      input: publicInput,
      seed: sacrifice.seed,
    };
    const safe = await executeAgentDecision(request);
    const tactical = await executeAgentDecision({ ...request, agent: 'tactical-6a' });
    const baseline = await executeAgentDecision({ ...request, agent: 'expected-value' });
    expect(safe.type === 'ACTION' && safe.action).toEqual({ type: 'MOVE', from: 10, to: 9 });
    expect(tactical.type === 'ACTION' && tactical.action).toEqual({
      type: 'MOVE',
      from: 10,
      to: 9,
    });
    expect(baseline.type === 'ACTION' && baseline.action).toEqual({
      type: 'MOVE',
      from: 10,
      to: 14,
    });
  });

  it('passes only input/seed to a policy and allowlists its action response', async () => {
    const chooseAction = vi.fn(async () => ({
      type: 'FLIP' as const,
      position: 0,
      secret: 'must-not-cross',
    }));
    const request: WorkerDecisionRequest = {
      type: 'CHOOSE_ACTION',
      token,
      agent: 'random',
      input: input(),
      seed: 123,
    };
    const actual = await executeAgentDecision(request, { chooseAction });
    expect(chooseAction).toHaveBeenCalledWith(request.input, { seed: 123 });
    expect(actual.type === 'ACTION' && actual.action).toEqual({ type: 'FLIP', position: 0 });
    expect(JSON.stringify(actual)).not.toContain('must-not-cross');
    const failed = await executeAgentDecision(request, {
      async chooseAction() {
        throw new Error('private exception details');
      },
    });
    expect(failed.type).toBe('ERROR');
    expect(JSON.stringify(failed)).not.toContain('private exception');
  });
});

describe('Worker lifecycle and failure recovery', () => {
  it('sends only the public envelope/derived seed and consumes a response once', async () => {
    vi.useFakeTimers();
    const f = workerFixture();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.deriveSeed).toHaveBeenCalledWith(77, 'P1', 0);
    const posted = vi.mocked(f.port.postMessage).mock.calls[0]![0];
    expect(Object.keys(posted).sort()).toEqual(['agent', 'input', 'seed', 'token', 'type']);
    expect(posted.seed).toBe(123);
    expect(JSON.stringify(posted)).not.toMatch(
      /agentSeed|initialDeck|"id"|positionCounts|noProgressCount/,
    );
    f.emit(response);
    f.emit(response);
    expect(f.onAction).toHaveBeenCalledTimes(1);
    expect(f.port.terminate).toHaveBeenCalledTimes(1);
    f.cancel();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.onFailure).not.toHaveBeenCalled();
    expect(f.port.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates timed-out work and rejects a late response without a fallback action', async () => {
    vi.useFakeTimers();
    const f = workerFixture();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.onFailure).toHaveBeenCalledExactlyOnceWith('TIMEOUT');
    f.emit(response);
    expect(f.onAction).not.toHaveBeenCalled();
    expect(f.port.terminate).toHaveBeenCalledTimes(1);
  });

  it('cancels on restart/unmount, including while asynchronous seed derivation is pending', async () => {
    vi.useFakeTimers();
    const f = workerFixture();
    f.cancel();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.createWorker).not.toHaveBeenCalled();
    expect(f.onAction).not.toHaveBeenCalled();
    expect(f.onFailure).not.toHaveBeenCalled();
    const started = workerFixture();
    await vi.advanceTimersByTimeAsync(0);
    started.cancel();
    started.emit(response);
    expect(started.port.terminate).toHaveBeenCalledTimes(1);
    expect(started.onAction).not.toHaveBeenCalled();
    expect(started.onFailure).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'MALFORMED_RESPONSE'],
    [{ ...response, token: { ...token, generation: 2 } }, 'MALFORMED_RESPONSE'],
    [{ ...response, durationMs: Infinity }, 'MALFORMED_RESPONSE'],
    [{ ...response, action: { type: 'MOVE', from: 0, to: 1 } }, 'INVALID_ACTION'],
    [{ type: 'ERROR', token, code: 'AGENT_ERROR', durationMs: 1 }, 'AGENT_ERROR'],
  ])('pauses for malformed/invalid/error responses: %j', async (message, failure) => {
    vi.useFakeTimers();
    const f = workerFixture();
    await vi.advanceTimersByTimeAsync(0);
    f.emit(message);
    expect(f.onFailure).toHaveBeenCalledExactlyOnceWith(failure);
    expect(f.onAction).not.toHaveBeenCalled();
    expect(f.port.terminate).toHaveBeenCalledTimes(1);
  });

  it('handles Worker startup, runtime, and message decoding failures', async () => {
    vi.useFakeTimers();
    const onFailure = vi.fn();
    runWorkerDecision(
      { token, agent: 'random', agentSeed: 0, input: input() },
      { onAction: vi.fn(), onFailure },
      {
        deriveSeed: async () => 0,
        createWorker: () => {
          throw new Error('not supported');
        },
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('UNAVAILABLE');
    const runtime = workerFixture();
    await vi.advanceTimersByTimeAsync(0);
    runtime.port.onerror?.call(
      runtime.port as Worker,
      { preventDefault: vi.fn() } as unknown as ErrorEvent,
    );
    expect(runtime.onFailure).toHaveBeenCalledExactlyOnceWith('WORKER_ERROR');
    const decode = workerFixture();
    await vi.advanceTimersByTimeAsync(0);
    decode.port.onmessageerror?.call(decode.port as Worker, new MessageEvent('messageerror'));
    expect(decode.onFailure).toHaveBeenCalledExactlyOnceWith('MALFORMED_RESPONSE');
  });

  it('filters extra properties and rejects out-of-board actions at the transport boundary', () => {
    expect(
      readWorkerResponse({
        ...response,
        action: { ...response.action, id: 'private' },
        rootSeed: 77,
      }),
    ).toEqual(response);
    expect(readWorkerResponse({ ...response, action: { type: 'FLIP', position: 32 } })).toBeNull();
    expect(
      readWorkerResponse({ ...response, action: { type: 'MOVE', from: 0.5, to: 1 } }),
    ).toBeNull();
  });
});
