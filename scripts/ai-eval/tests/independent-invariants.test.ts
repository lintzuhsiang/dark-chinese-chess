import { describe, expect, it } from 'vitest';
import type { GameAction, GameState, PlayerId } from '../../../packages/game-core/src/index';
import type { AgentInput, GameAgent } from '../../../packages/ai-agents/src/index';
import { randomAgent } from '../../../packages/ai-agents/src/index';
import { reconstructGame } from '../../../apps/web/src/game/reconstruct';
import { cycle, opening, pairDeck } from '../../../apps/web/tests/history-fixtures';
import { createAgentInput } from '../agent-input';
import { createMatchRunner, runMatch, verifyReplay } from '../match';
import { deriveDecisionSeed } from '../seeds';

type Runner = ReturnType<typeof createMatchRunner>;
type Request = NonNullable<ReturnType<Runner['requestDecision']>>;

const seeds = { deckSeed: 1543, agentSeed: 9017 };
const agents = { P1: randomAgent, P2: randomAgent };
const options = () => ({ ...seeds, agents });

function request(runner: Runner): Request {
  const prepared = runner.requestDecision();
  if (prepared === null) throw new Error('QA fixture expected an active decision.');
  return prepared;
}

function response(prepared: Request, action = prepared.input.legalActions[0]!) {
  return {
    requestId: prepared.requestId,
    generation: prepared.generation,
    revision: prepared.revision,
    playerId: prepared.playerId,
    action,
  };
}

function opposite(player: PlayerId): PlayerId {
  return player === 'P1' ? 'P2' : 'P1';
}

describe('independent match integrity and information boundary', () => {
  it('uses stored GameResult for a fixed win and does not request terminal decisions', async () => {
    const report = await runMatch({ ...options(), agentSeed: 7 });
    const result = { type: 'WIN', winner: 'P1', reason: 'NO_PIECES' } as const;
    expect(report.outcome).toEqual({ type: 'COMPLETED', result });
    expect(report.finalState.result).toEqual(result);
    expect(report.finalState.currentPlayer).toBe('P2');
    expect(verifyReplay(report)).toEqual({ ok: true });

    const tampered = structuredClone(report);
    Object.assign(tampered.outcome, { result: { ...result, winner: 'P2' } });
    expect(verifyReplay(tampered).ok).toBe(false);

    const runner = createMatchRunner({ ...options(), agentSeed: 7 });
    for (const entry of report.actions) {
      const prepared = request(runner);
      expect(prepared.playerId).toBe(entry.playerId);
      expect(runner.commitDecision(response(prepared, entry.action)).ok).toBe(true);
    }
    const terminal = runner.getSnapshot();
    expect(terminal.state).toEqual(report.finalState);
    expect(runner.requestDecision()).toBeNull();
    expect(await runner.step()).toBeNull();
    expect(runner.getSnapshot()).toEqual(terminal);
  });
  it('passes only public fields and a separately derived seed to either seat', async () => {
    const observed: { input: AgentInput; options: { readonly seed: number } }[] = [];
    const recorder: GameAgent = {
      async chooseAction(input, decisionOptions) {
        observed.push({ input, options: decisionOptions });
        return randomAgent.chooseAction(input, decisionOptions);
      },
    };
    const report = await runMatch({
      ...seeds,
      agents: { P1: recorder, P2: recorder },
      maxPlies: 4,
    });
    expect(report.outcome).toEqual({ type: 'TRUNCATED', reason: 'PLY_LIMIT' });
    expect(observed).toHaveLength(4);
    expect(observed.map(({ input }) => input.perspective)).toEqual(['P1', 'P2', 'P1', 'P2']);
    for (const [ply, call] of observed.entries()) {
      expect(Object.keys(call.input).sort()).toEqual([
        'legalActions',
        'observation',
        'perspective',
        'publicHistory',
      ]);
      expect(Object.keys(call.options)).toEqual(['seed']);
      expect(call.options.seed).toBe(
        deriveDecisionSeed(seeds.agentSeed, call.input.perspective, ply),
      );
      expect(call.input.publicHistory).toHaveLength(ply);
      expect(call.input.observation.currentPlayer).toBe(call.input.perspective);
      expect(JSON.stringify(call.input)).not.toMatch(
        /"id"|initialDeck|attackerId|targetId|positionCounts|deckSeed|agentSeed|masterSeed|requestId|generation|revision/,
      );
    }
    expect(observed[0]!.input.observation.playerColors).toEqual({ P1: null, P2: null });
    const first = report.publicHistory[0]!;
    expect(first.type).toBe('FLIP');
    expect(report.finalState.playerColors).toEqual({
      P1: first.piece.color,
      P2: first.piece.color === 'RED' ? 'BLACK' : 'RED',
    });
    expect(verifyReplay(report)).toEqual({ ok: true });
  });

  it('keeps shuffle and decision randomness independent at the same public prefix', () => {
    const original = createMatchRunner(options());
    const otherAgentSeed = createMatchRunner({ ...options(), agentSeed: seeds.agentSeed + 1 });
    const otherDeckSeed = createMatchRunner({ ...options(), deckSeed: seeds.deckSeed + 1 });
    expect(otherAgentSeed.getSnapshot().initialDeck).toEqual(original.getSnapshot().initialDeck);
    const first = request(original);
    const changedDeck = request(otherDeckSeed);
    expect(changedDeck.input).toEqual(first.input);
    expect(changedDeck.seed).toBe(first.seed);
    expect(request(otherAgentSeed).seed).toBe(deriveDecisionSeed(seeds.agentSeed + 1, 'P1', 0));
  });

  it.each([
    ['after a capture', opening.slice(0, 5)],
    ['during a chase', opening],
    ['before the prohibited third return', [...opening, ...cycle, ...cycle, ...cycle.slice(0, -1)]],
  ] as const)('is hidden-permutation independent %s', async (_name, actions) => {
    const entries = actions.map((action, index) => ({
      playerId: index % 2 === 0 ? ('P1' as const) : ('P2' as const),
      action,
    }));
    const { state, events } = reconstructGame(pairDeck(), entries);
    const hidden = state.board.flatMap((square, index) =>
      square && !square.revealed ? [index] : [],
    );
    const from = hidden[0]!;
    const to = hidden.find((index) => {
      const first = state.board[from]!.piece;
      const other = state.board[index]!.piece;
      return first.color !== other.color || first.rank !== other.rank;
    });
    if (to === undefined) throw new Error('QA fixture requires distinct hidden types.');
    const permuted = [...state.board];
    [permuted[from], permuted[to]] = [state.board[to]!, state.board[from]!];
    const alternative: GameState = { ...state, board: permuted };
    const input = createAgentInput(state, events, state.currentPlayer);
    const other = createAgentInput(alternative, events, state.currentPlayer);
    expect(alternative.board).not.toEqual(state.board);
    expect(other).toEqual(input);
    expect(await randomAgent.chooseAction(other, { seed: 2147 })).toEqual(
      await randomAgent.chooseAction(input, { seed: 2147 }),
    );
  });

  it.each([0, 1, 2])(
    'finishes and exactly replays a reproducible full game (Agent seed %i)',
    async (agentSeed) => {
      const first = await runMatch({ ...options(), agentSeed });
      const second = await runMatch({ ...options(), agentSeed });
      expect(first.outcome.type).toBe('COMPLETED');
      expect(first.finalState.status).toBe('FINISHED');
      expect(first.finalState.result).not.toBeNull();
      expect(first.actions.length).toBeGreaterThan(0);
      expect(new Set(first.actions.map((entry) => entry.playerId))).toEqual(new Set(['P1', 'P2']));
      expect(first.actions).toEqual(second.actions);
      expect(first.publicHistory).toEqual(second.publicHistory);
      expect(first.finalState).toEqual(second.finalState);
      expect(first.outcome).toEqual(second.outcome);
      const reconstructed = reconstructGame(first.initialDeck, first.actions);
      expect(reconstructed.state).toEqual(first.finalState);
      expect(reconstructed.events).toEqual(first.publicHistory);
      expect(verifyReplay(first)).toEqual({ ok: true });
    },
  );

  it('retains a failed Agent attempt and an administrative truncation without inventing GameResult', async () => {
    const broken: GameAgent = {
      async chooseAction() {
        throw new Error('QA expected Agent failure');
      },
    };
    const failed = await runMatch({ ...options(), agents: { P1: broken, P2: randomAgent } });
    expect(failed.outcome.type).toBe('FAILED');
    expect(failed.actions).toEqual([]);
    expect(failed.publicHistory).toEqual([]);
    expect(failed.finalState.result).toBeNull();
    expect(verifyReplay(failed)).toEqual({ ok: true });
    const truncated = await runMatch({ ...options(), maxPlies: 0 });
    expect(truncated.outcome).toEqual({ type: 'TRUNCATED', reason: 'PLY_LIMIT' });
    expect(truncated.finalState.result).toBeNull();
    expect(truncated.actions).toEqual([]);
  });

  it('rejects tampering with canonical actions, public events, or full replayed state', async () => {
    const report = await runMatch({ ...options(), maxPlies: 4 });
    const badAction = structuredClone(report);
    Object.assign(badAction.actions[0]!.action, { position: 32 });
    expect(verifyReplay(badAction).ok).toBe(false);
    const badEvent = structuredClone(report);
    Object.assign(badEvent.publicHistory[0]!.piece, { rank: 'SOLDIER', color: 'PURPLE' });
    expect(verifyReplay(badEvent).ok).toBe(false);
    const badState = structuredClone(report);
    Object.assign(badState.finalState, { noProgressCount: 43 });
    expect(verifyReplay(badState).ok).toBe(false);
  });

  it('records the seeds and configuration actually started before an awaited decision', async () => {
    let resolveDecision: ((action: GameAction) => void) | undefined;
    let proposed: GameAction | undefined;
    const delayed: GameAgent = {
      chooseAction(input) {
        proposed = input.legalActions[0]!;
        return new Promise<GameAction>((resolve) => {
          resolveDecision = resolve;
        });
      },
    };
    const configuration = { P1: 'qa-delayed-v1', P2: 'random-v1' };
    const mutableOptions = {
      ...options(),
      agents: { P1: delayed, P2: randomAgent },
      agentConfiguration: configuration,
      maxPlies: 1,
    };
    const pending = runMatch(mutableOptions);
    if (!resolveDecision || !proposed) throw new Error('QA delayed Agent did not start.');
    Object.assign(mutableOptions, { deckSeed: 15, agentSeed: 19, initialDeck: [] });
    configuration.P1 = 'changed-after-start';
    resolveDecision(proposed);
    const report = await pending;
    expect(report.metadata).toMatchObject({
      deckSeed: seeds.deckSeed,
      agentSeed: seeds.agentSeed,
      initialization: 'SEEDED_SHUFFLE',
      agentConfiguration: { P1: 'qa-delayed-v1', P2: 'random-v1' },
    });
  });
});

describe('independent trusted response-commit invariants', () => {
  it('rejects mismatched tokens and illegal proposals without changing accepted state', () => {
    const runner = createMatchRunner(options());
    const prepared = request(runner);
    const before = runner.getSnapshot();
    const invalid = [
      { ...response(prepared), requestId: prepared.requestId + 1 },
      { ...response(prepared), playerId: opposite(prepared.playerId) },
      response(prepared, { type: 'FLIP', position: 32 }),
      response(prepared, { type: 'MOVE', from: 0, to: 1 }),
    ];
    for (const proposed of invalid) {
      expect(runner.commitDecision(proposed).ok).toBe(false);
      expect(runner.getSnapshot()).toEqual(before);
    }
    expect(runner.commitDecision(response(prepared)).ok).toBe(true);
    const accepted = runner.getSnapshot();
    expect(runner.commitDecision(response(prepared)).ok).toBe(false);
    expect(runner.getSnapshot()).toEqual(accepted);
  });

  it('rejects superseded requests and another runner even when request counts match', () => {
    const runner = createMatchRunner(options());
    const older = request(runner);
    const newer = request(runner);
    expect(runner.commitDecision(response(older)).ok).toBe(false);
    expect(runner.commitDecision(response(newer)).ok).toBe(true);
    const other = createMatchRunner(options());
    const foreign = request(other);
    const fresh = createMatchRunner(options());
    const local = request(fresh);
    expect(foreign.requestId).toBe(local.requestId);
    expect(foreign.revision).toBe(local.revision);
    expect(foreign.generation).not.toBe(local.generation);
    expect(fresh.commitDecision(response(foreign)).ok).toBe(false);
    expect(fresh.commitDecision(response(local)).ok).toBe(true);
  });

  it('rejects a response after restart despite matching the opening action count', () => {
    const runner = createMatchRunner(options());
    const older = request(runner);
    runner.restart();
    const restarted = runner.getSnapshot();
    expect(restarted.actions).toHaveLength(0);
    expect(restarted.generation).not.toBe(older.generation);
    expect(restarted.revision).toBeGreaterThan(older.revision);
    expect(runner.commitDecision(response(older)).ok).toBe(false);
    expect(runner.getSnapshot()).toEqual(restarted);
  });

  it('checks revision after an awaited Agent response resolves', async () => {
    let resolveDecision: ((action: GameAction) => void) | undefined;
    let proposed: GameAction | undefined;
    const delayed: GameAgent = {
      chooseAction(input) {
        proposed = input.legalActions[0]!;
        return new Promise<GameAction>((resolve) => {
          resolveDecision = resolve;
        });
      },
    };
    const runner = createMatchRunner({ ...options(), agents: { P1: delayed, P2: randomAgent } });
    const pending = runner.step();
    if (!resolveDecision || !proposed)
      throw new Error('QA delayed Agent did not receive a request.');
    runner.restart();
    const afterRestart = runner.getSnapshot();
    resolveDecision(proposed);
    expect((await pending)?.ok).toBe(false);
    expect(runner.getSnapshot()).toEqual(afterRestart);
  });

  it('does not let trusted snapshot mutation edit authoritative state or transcript', () => {
    const runner = createMatchRunner(options());
    const prepared = request(runner);
    expect(runner.commitDecision(response(prepared)).ok).toBe(true);
    const before = runner.getSnapshot();
    const exposed = runner.getSnapshot();
    try {
      Object.assign(exposed.state, { currentPlayer: 'P1', noProgressCount: 57 });
      Object.assign(exposed.initialDeck[0]!, { rank: 'SOLDIER' });
      Object.assign(exposed.actions[0]!.action, { position: 31 });
      Object.assign(exposed.publicHistory[0]!.piece, { rank: 'SOLDIER' });
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
    }
    expect(runner.getSnapshot()).toEqual(before);
  });
});
