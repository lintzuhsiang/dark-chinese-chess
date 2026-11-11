import { describe, expect, it } from 'vitest';
import type { GameAction, PlayerId } from '@dark-chess/game-core';
import { expectedValueAgent, randomAgent } from '../../../packages/ai-agents/src/index';
import { createAgentInput } from '../src/game/agent-input';
import { createShuffledDeck } from '../src/game/deck';
import { aiToMove, initialPlay, playReducer, type PlayState } from '../src/game/play';
import { projectSession } from '../src/game/review';
import { reconstructGame } from '../src/game/reconstruct';

const deck = () => createShuffledDeck(() => 1 - Number.EPSILON);
function start(humanSeat: PlayerId = 'P1'): PlayState {
  return playReducer(initialPlay, {
    type: 'START_PLAY',
    deck: deck(),
    mode: { kind: 'AI', humanSeat, agent: 'expected-value', agentSeed: 7 },
  });
}
const click = (state: PlayState, position: number) =>
  playReducer(state, { type: 'UI', command: { type: 'CLICK', position } });
const begin = (state: PlayState) => playReducer(state, { type: 'BEGIN_AI' });
function result(state: PlayState, action: unknown = state.pending!.legalActions[0]!) {
  return playReducer(state, { type: 'AI_RESULT', token: state.pending!.token, action });
}

describe('trusted browser play coordinator', () => {
  it('assigns colors from the human first FLIP, blocks human input/Undo during AI turn, and commits only once', () => {
    let state = start();
    expect(aiToMove(state)).toBe(false);
    expect(begin(state)).toBe(state);
    state = click(state, 16);
    expect(state.ui.local.session!.currentState.playerColors).toEqual({ P1: 'BLACK', P2: 'RED' });
    expect(click(state, 17)).toBe(state);
    expect(playReducer(state, { type: 'UI', command: { type: 'UNDO' } })).toBe(state);
    state = begin(state);
    expect(begin(state)).toBe(state);
    const pending = state.pending!;
    const accepted = result(state);
    expect(accepted.ui.local.session!.actions).toHaveLength(2);
    expect(accepted.revision).toBe(state.revision + 1);
    expect(aiToMove(accepted)).toBe(false);
    expect(
      playReducer(accepted, {
        type: 'AI_RESULT',
        token: pending.token,
        action: pending.legalActions[0],
      }),
    ).toBe(accepted);
  });

  it('allows AI as P1 to open and then gives the human P2 the opposite color', () => {
    const state = begin(start('P2'));
    expect(state.pending!.token.playerId).toBe('P1');
    const accepted = result(state, { type: 'FLIP', position: 16 });
    expect(accepted.ui.local.session!.currentState.currentPlayer).toBe('P2');
    expect(accepted.ui.local.session!.currentState.playerColors).toEqual({
      P1: 'BLACK',
      P2: 'RED',
    });
    expect(aiToMove(accepted)).toBe(false);
  });

  it.each(['requestId', 'generation', 'revision', 'playerId'] as const)(
    'rejects a mismatched %s without consuming the live request',
    (field) => {
      const state = begin(start('P2'));
      const token = {
        ...state.pending!.token,
        [field]: field === 'playerId' ? ('P2' as const) : state.pending!.token[field] + 1,
      };
      expect(
        playReducer(state, { type: 'AI_RESULT', token, action: state.pending!.legalActions[0] }),
      ).toBe(state);
      expect(playReducer(state, { type: 'AI_FAILED', token, failure: 'TIMEOUT' })).toBe(state);
    },
  );

  it('invalidates old generations on restart, keeps revision/request IDs monotonic, and rejects a late failure', () => {
    const state = begin(start('P2'));
    const old = state.pending!;
    expect(
      playReducer(state, { type: 'RESTART_PLAY', deck: deck(), confirmed: false, agentSeed: 9 })
        .generation,
    ).toBe(state.generation);
    let restarted = playReducer(state, {
      type: 'RESTART_PLAY',
      deck: deck(),
      confirmed: true,
      agentSeed: 9,
    });
    expect(restarted.generation).toBe(state.generation + 1);
    expect(restarted.revision).toBeGreaterThan(state.revision);
    restarted = begin(restarted);
    expect(restarted.pending!.token.requestId).toBeGreaterThan(old.token.requestId);
    expect(
      playReducer(restarted, { type: 'AI_RESULT', token: old.token, action: old.legalActions[0] }),
    ).toBe(restarted);
    expect(
      playReducer(restarted, { type: 'AI_FAILED', token: old.token, failure: 'WORKER_ERROR' }),
    ).toBe(restarted);
    expect(restarted.ui.local.session!.actions).toHaveLength(0);
  });

  it('cancels the request on leaving/switching modes and preserves local two-player Undo', () => {
    const state = begin(start('P2'));
    expect(playReducer(state, { type: 'LEAVE_PLAY', confirmed: false })).toBe(state);
    const menu = playReducer(state, { type: 'LEAVE_PLAY', confirmed: true });
    expect(menu.pending).toBeNull();
    expect(menu.ui.local.session).toBeNull();
    let local = playReducer(menu, { type: 'START_PLAY', deck: deck(), mode: { kind: 'LOCAL' } });
    expect(
      playReducer(local, {
        type: 'AI_RESULT',
        token: state.pending!.token,
        action: { type: 'FLIP', position: 0 },
      }),
    ).toBe(local);
    local = click(local, 0);
    local = click(local, 1);
    expect(local.ui.local.session!.actions).toHaveLength(2);
    const undone = playReducer(local, { type: 'UI', command: { type: 'UNDO' } });
    expect(undone.ui.local.session!.actions).toHaveLength(1);
    expect(begin(undone)).toBe(undone);
  });

  it('pauses on invalid proposals without timeline mutation; retry creates a fresh request at the same ply', () => {
    const state = begin(start('P2'));
    const failed = result(state, { type: 'MOVE', from: 0, to: 1 });
    expect(failed.failure).toBe('INVALID_ACTION');
    expect(failed.ui.local.session).toBe(state.ui.local.session);
    expect(begin(failed)).toBe(failed);
    const retried = begin(playReducer(failed, { type: 'RETRY_AI' }));
    expect(retried.pending!.token.requestId).toBeGreaterThan(state.pending!.token.requestId);
    expect(retried.pending!.token.revision).toBe(state.revision);
    expect(retried.mode).toEqual(state.mode);
    expect(retried.ui.local.session!.actions).toHaveLength(0);
  });

  it('revalidates in Core at the actual commit boundary, even if an illegal action is in the pending offer', () => {
    const state = begin(start('P2'));
    const forged: PlayState = {
      ...state,
      pending: { token: state.pending!.token, legalActions: [{ type: 'MOVE', from: 0, to: 1 }] },
    };
    const rejected = result(forged);
    expect(rejected.failure).toBe('INVALID_ACTION');
    expect(rejected.ui.local.session).toBe(state.ui.local.session);
    expect(rejected.revision).toBe(state.revision);
  });

  it.each(['TIMEOUT', 'WORKER_ERROR', 'UNAVAILABLE', 'MALFORMED_RESPONSE', 'AGENT_ERROR'] as const)(
    'retains the game on %s and waits for explicit retry',
    (failure) => {
      const state = begin(start('P2'));
      const paused = playReducer(state, {
        type: 'AI_FAILED',
        token: state.pending!.token,
        failure,
      });
      expect(paused.failure).toBe(failure);
      expect(paused.pending).toBeNull();
      expect(paused.ui.local.session).toBe(state.ui.local.session);
      expect(click(paused, 5)).toBe(paused);
      expect(begin(paused)).toBe(paused);
    },
  );

  it.each(['P1', 'P2'] as const)(
    'plays a full game as human %s, exactly replays, and never requests AI in terminal Review',
    async (humanSeat) => {
      let state = start(humanSeat);
      for (
        let ply = 0;
        ply < 600 && state.ui.local.session!.currentState.status === 'ACTIVE';
        ply += 1
      ) {
        const session = state.ui.local.session!;
        const history = projectSession(session, null).history;
        const request = createAgentInput(
          session.currentState,
          history,
          session.currentState.currentPlayer,
        );
        const action: GameAction = await (
          aiToMove(state) ? expectedValueAgent : randomAgent
        ).chooseAction(request, { seed: ply * 17 + 923 });
        if (aiToMove(state)) state = result(begin(state), action);
        else if (action.type === 'FLIP') state = click(state, action.position);
        else state = click(click(state, action.from), action.to);
      }
      const session = state.ui.local.session!;
      expect(session.currentState.status).toBe('FINISHED');
      expect(begin(state)).toBe(state);
      const replay = reconstructGame(session.initialDeck, session.actions);
      expect(replay.state).toEqual(session.currentState);
      state = playReducer(state, { type: 'UI', command: { type: 'OPEN_REVIEW' } });
      expect(state.ui.reviewCursor).toBe(0);
      expect(begin(state)).toBe(state);
      expect(click(state, 0).ui.local.session).toBe(session);
    },
    30000,
  );
});
