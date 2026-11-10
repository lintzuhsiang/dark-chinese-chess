import { isDeepStrictEqual } from 'node:util';
import { createSeededRandom } from '../../packages/ai-agents/src/index';
import type { ActionEvent, GameAction, GameState, Piece } from '../../packages/game-core/src/index';
import { applyAction, createInitialState } from '../../packages/game-core/src/index';
import { createShuffledDeck } from '../../apps/web/src/game/deck';
import { reconstructGame } from '../../apps/web/src/game/reconstruct';
import type { AcceptedAction } from '../../apps/web/src/game/reconstruct';
import { createAgentInput } from './agent-input';
import { assertCoreBaseline, CORE_REVISION } from './baseline';
import { DECISION_SEED_ALGORITHM, deriveDecisionSeed } from './seeds';
import type {
  CommitResult,
  DecisionRequest,
  DecisionResponse,
  MatchError,
  MatchOptions,
  MatchOutcome,
  MatchReport,
  MatchSnapshot,
} from './types';

export type * from './types';

let nextGeneration = 0;

function sameAction(offered: GameAction, proposed: GameAction): boolean {
  if (typeof proposed !== 'object' || proposed === null || Array.isArray(proposed)) return false;
  if (offered.type === 'FLIP') {
    return (
      proposed.type === 'FLIP' &&
      proposed.position === offered.position &&
      Object.keys(proposed).length === 2
    );
  }
  return (
    proposed.type === 'MOVE' &&
    proposed.from === offered.from &&
    proposed.to === offered.to &&
    Object.keys(proposed).length === 3
  );
}

function rejection(code: MatchError['code'], message: string): CommitResult {
  return { ok: false, error: { code, message } };
}

export function createMatchRunner(options: MatchOptions) {
  assertCoreBaseline();
  // Both streams are independently initialized; shuffle never consumes Agent draws.
  const shuffleRandom = createSeededRandom(options.deckSeed);
  deriveDecisionSeed(options.agentSeed, 'P1', 0); // Validate before issuing requests.
  const agentSeed = options.agentSeed;
  const deck = options.initialDeck ?? createShuffledDeck(shuffleRandom);
  const initialized = createInitialState(deck);
  if (!initialized.ok) throw new Error('Cannot start match: INVALID_DECK');
  const initialDeck: readonly Piece[] = initialized.state.board.map((square) => ({
    ...square!.piece,
  }));
  const policies = {
    P1: options.agents.P1.chooseAction.bind(options.agents.P1),
    P2: options.agents.P2.chooseAction.bind(options.agents.P2),
  };
  let state: GameState = initialized.state;
  let actions: AcceptedAction[] = [];
  // Append-only public projection of successful Core results, never an independent authority.
  let publicHistory: ActionEvent[] = [];
  let generation = ++nextGeneration;
  let revision = 0;
  let requestId = 0;
  let pending: DecisionRequest | null = null;

  function getSnapshot(): MatchSnapshot {
    return structuredClone({ initialDeck, state, actions, publicHistory, generation, revision });
  }

  function requestDecision(): DecisionRequest | null {
    if (state.status === 'FINISHED') return null;
    const playerId = state.currentPlayer;
    const input = createAgentInput(state, publicHistory, playerId);
    pending = Object.freeze({
      requestId: ++requestId,
      generation,
      revision,
      playerId,
      input,
      seed: deriveDecisionSeed(agentSeed, playerId, state.plyCount),
    });
    return pending;
  }

  function commitDecision(response: DecisionResponse): CommitResult {
    if (typeof response !== 'object' || response === null) {
      return rejection('MISMATCHED_RESPONSE', 'Missing response envelope.');
    }
    if (response.generation !== generation || response.revision !== revision) {
      return rejection('STALE_RESPONSE', 'Response belongs to a different generation or revision.');
    }
    if (pending === null) return rejection('NO_PENDING_REQUEST', 'No decision is pending.');
    if (
      response.requestId !== pending.requestId ||
      response.playerId !== pending.playerId ||
      response.playerId !== state.currentPlayer ||
      state.status !== 'ACTIVE'
    ) {
      return rejection('MISMATCHED_RESPONSE', 'Response does not match the current request.');
    }
    const action = pending.input.legalActions.find((offered) =>
      sameAction(offered, response.action),
    );
    if (action === undefined)
      return rejection('INVALID_ACTION', 'Proposal is not an offered action.');
    const result = applyAction(state, response.playerId, action);
    if (!result.ok) {
      // A screened action rejected at the same revision indicates a host/Core invariant failure.
      throw new Error(`Core rejected a current permitted action: ${result.error.code}`);
    }
    const event = result.event;
    const accepted: GameAction =
      event.type === 'FLIP'
        ? { type: 'FLIP', position: event.position }
        : { type: 'MOVE', from: event.from, to: event.to };
    state = result.state;
    actions = [...actions, { playerId: response.playerId, action: accepted }];
    publicHistory = [...publicHistory, event];
    revision += 1;
    pending = null;
    return { ok: true, event: structuredClone(event) };
  }

  async function step(): Promise<CommitResult | null> {
    const request = requestDecision();
    if (request === null) return null;
    let action: GameAction;
    try {
      action = await policies[request.playerId](request.input, { seed: request.seed });
    } catch (cause) {
      return rejection('AGENT_ERROR', cause instanceof Error ? cause.message : String(cause));
    }
    return commitDecision({
      requestId: request.requestId,
      generation: request.generation,
      revision: request.revision,
      playerId: request.playerId,
      action,
    });
  }

  function restart(): void {
    const initial = createInitialState(initialDeck);
    if (!initial.ok) throw new Error('Private initial deck became invalid.');
    state = initial.state;
    actions = [];
    publicHistory = [];
    generation = ++nextGeneration;
    revision += 1;
    pending = null;
  }

  return { getSnapshot, requestDecision, commitDecision, step, restart };
}

export async function runMatch(
  options: MatchOptions & { readonly maxPlies?: number },
): Promise<MatchReport> {
  const maxPlies = options.maxPlies ?? 4096;
  if (!Number.isSafeInteger(maxPlies) || maxPlies < 0) {
    throw new RangeError('maxPlies must be a nonnegative safe integer.');
  }
  // Capture provenance before calling any asynchronous policy.
  const runOptions: MatchOptions = {
    deckSeed: options.deckSeed,
    agentSeed: options.agentSeed,
    agents: { P1: options.agents.P1, P2: options.agents.P2 },
    agentConfiguration: structuredClone(
      options.agentConfiguration ?? {
        P1: 'unspecified',
        P2: 'unspecified',
      },
    ),
    ...(options.initialDeck === undefined
      ? {}
      : { initialDeck: structuredClone(options.initialDeck) }),
  };
  const runner = createMatchRunner(runOptions);
  let outcome: MatchOutcome;
  while (true) {
    const snapshot = runner.getSnapshot();
    if (snapshot.state.status === 'FINISHED') {
      if (snapshot.state.result === null) throw new Error('Finished match has no GameResult.');
      outcome = { type: 'COMPLETED', result: snapshot.state.result };
      break;
    }
    if (snapshot.actions.length >= maxPlies) {
      outcome = { type: 'TRUNCATED', reason: 'PLY_LIMIT' };
      break;
    }
    const result = await runner.step();
    if (result === null) throw new Error('Active match did not issue a decision.');
    if (!result.ok) {
      outcome = { type: 'FAILED', error: result.error };
      break;
    }
  }
  const snapshot = runner.getSnapshot();
  return {
    metadata: {
      coreRevision: CORE_REVISION,
      deckSeed: runOptions.deckSeed,
      agentSeed: runOptions.agentSeed,
      randomAlgorithm: 'mulberry32-v1',
      decisionSeedAlgorithm: DECISION_SEED_ALGORITHM,
      initialization: runOptions.initialDeck === undefined ? 'SEEDED_SHUFFLE' : 'EXPLICIT_DECK',
      agentConfiguration: structuredClone(
        runOptions.agentConfiguration ?? {
          P1: 'unspecified',
          P2: 'unspecified',
        },
      ),
      maxPlies,
      environment: { node: process.version, platform: process.platform, arch: process.arch },
    },
    initialDeck: snapshot.initialDeck,
    actions: snapshot.actions,
    publicHistory: snapshot.publicHistory,
    finalState: snapshot.state,
    outcome,
  };
}

export function verifyReplay(
  report: MatchReport,
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  try {
    assertCoreBaseline();
    if (report.metadata.coreRevision !== CORE_REVISION) throw new Error('Core revision mismatch.');
    const reconstructed = reconstructGame(report.initialDeck, report.actions);
    if (!isDeepStrictEqual(reconstructed.state, report.finalState)) {
      throw new Error('Replayed full state differs from recorded final state.');
    }
    if (!isDeepStrictEqual(reconstructed.events, report.publicHistory)) {
      throw new Error('Replayed public events differ from recorded history.');
    }
    if (report.outcome.type === 'COMPLETED') {
      if (
        reconstructed.state.status !== 'FINISHED' ||
        !isDeepStrictEqual(reconstructed.state.result, report.outcome.result)
      ) {
        throw new Error('Recorded GameResult differs from replay.');
      }
    } else if (reconstructed.state.status !== 'ACTIVE') {
      throw new Error('An unfinished execution outcome records a terminal game.');
    }
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}
