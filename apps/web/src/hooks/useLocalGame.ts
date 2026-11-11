import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { PlayerId } from '@dark-chess/game-core';
import type { AgentKind } from '../ai/protocol';
import { runWorkerDecision } from '../ai/worker-client';
import {
  createTurnPresentation,
  type PresentationKind,
  type TurnPresentation,
} from '../ai/turn-pacing';
import { createAgentInput } from '../game/agent-input';
import { aiToMove, initialPlay, playReducer } from '../game/play';
import { createShuffledDeck } from '../game/deck';
import { projectSession } from '../game/review';

export function useLocalGame() {
  const [play, dispatch] = useReducer(playReducer, initialPlay);
  const ui = play.ui;
  const session = ui.local.session;
  const currentState = session?.currentState;
  // Public completed-game history is stable while seeking. The board and capture
  // summary still come from the selected prefix, never from this full timeline.
  const liveView = useMemo(() => (session ? projectSession(session, null) : null), [session]);
  const view = useMemo(
    () =>
      session && ui.reviewCursor !== null ? projectSession(session, ui.reviewCursor) : liveView,
    [session, ui.reviewCursor, liveView],
  );
  const isReview = ui.reviewCursor !== null;
  const totalActions = session?.actions.length ?? 0;
  const canUndo =
    play.mode.kind === 'LOCAL' &&
    !isReview &&
    currentState?.status === 'ACTIVE' &&
    totalActions > 0;
  const canReview = !isReview && currentState?.status === 'FINISHED';

  const isAiTurn = aiToMove(play);
  const presentation = useRef<TurnPresentation | null>(null);
  useLayoutEffect(() => {
    if (!isAiTurn || play.mode.kind !== 'AI') return;
    const last = liveView?.history.at(-1);
    const kind: PresentationKind =
      last?.playerId !== play.mode.humanSeat
        ? 'OPENING'
        : last.type === 'FLIP'
          ? 'FLIP'
          : last.captured === null
            ? 'MOVE'
            : 'CAPTURE';
    // This effect follows the human action's DOM commit. Two visible animation
    // frames establish a paint opportunity before the minimum visible dwell.
    const gate = createTurnPresentation(kind);
    presentation.current = gate;
    return () => {
      gate.cancel();
      if (presentation.current === gate) presentation.current = null;
    };
  }, [isAiTurn, play.generation, play.revision, play.mode, liveView]);
  useEffect(() => {
    if (isAiTurn && play.pending === null && play.failure === null) dispatch({ type: 'BEGIN_AI' });
  }, [isAiTurn, play.pending, play.failure]);

  useEffect(() => {
    const pending = play.pending;
    if (
      pending === null ||
      play.mode.kind !== 'AI' ||
      currentState === undefined ||
      liveView === null
    )
      return;
    const gate = presentation.current;
    if (gate === null) return;
    let cancelPresentation: (() => void) | undefined;
    const input = createAgentInput(currentState, liveView.history, pending.token.playerId);
    const cancelWorker = runWorkerDecision(
      { token: pending.token, agent: play.mode.agent, agentSeed: play.mode.agentSeed, input },
      {
        onAction: (response) => {
          cancelPresentation = gate.wait(() =>
            dispatch({ type: 'AI_RESULT', token: response.token, action: response.action }),
          );
        },
        onFailure: (failure) => dispatch({ type: 'AI_FAILED', token: pending.token, failure }),
      },
    );
    return () => {
      cancelWorker();
      cancelPresentation?.();
    };
  }, [play.pending, play.mode, currentState, liveView]);

  function newAgentSeed() {
    // An unsupported crypto environment is reported by the Worker client as a
    // paused turn. It must not throw before the game/recovery UI exists.
    return globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0] ?? 0;
  }

  function startGame() {
    dispatch({ type: 'START_PLAY', deck: createShuffledDeck(), mode: { kind: 'LOCAL' } });
  }

  function startAiGame(humanSeat: PlayerId, agent: AgentKind) {
    dispatch({
      type: 'START_PLAY',
      deck: createShuffledDeck(),
      mode: { kind: 'AI', humanSeat, agent, agentSeed: newAgentSeed() },
    });
  }

  function clickSquare(position: number) {
    dispatch({ type: 'UI', command: { type: 'CLICK', position } });
  }

  function undo() {
    dispatch({ type: 'UI', command: { type: 'UNDO' } });
  }

  function restartGame(confirmed: boolean) {
    if (isReview || !currentState || (currentState.status === 'ACTIVE' && !confirmed)) return;
    dispatch({
      type: 'RESTART_PLAY',
      deck: createShuffledDeck(),
      confirmed,
      agentSeed: play.mode.kind === 'AI' ? newAgentSeed() : 0,
    });
  }

  // Rendering receives no session, deck, IDs, full state, or raw timeline.
  return {
    observation: view?.observation ?? null,
    history: view?.history ?? [],
    captured: view?.captured ?? [],
    reviewHistory: isReview ? (liveView?.history ?? []) : [],
    mode:
      play.mode.kind === 'AI'
        ? { kind: 'AI' as const, humanSeat: play.mode.humanSeat, agent: play.mode.agent }
        : { kind: 'LOCAL' as const },
    aiThinking: isAiTurn && play.failure === null,
    aiFailure: play.failure,
    isAiTurn,
    retryAi: () => dispatch({ type: 'RETRY_AI' }),
    leaveGame: (confirmed: boolean) => dispatch({ type: 'LEAVE_PLAY', confirmed }),
    startAiGame,
    canUndo,
    canReview,
    reviewCursor: ui.reviewCursor,
    totalActions,
    error: ui.local.error,
    selectedSquare: ui.selectedSquare,
    startGame,
    clickSquare,
    undo,
    restartGame,
    openReview: () => dispatch({ type: 'UI', command: { type: 'OPEN_REVIEW' } }),
    closeReview: () => dispatch({ type: 'UI', command: { type: 'CLOSE_REVIEW' } }),
    seekReview: (cursor: number) =>
      dispatch({ type: 'UI', command: { type: 'REVIEW_TO', cursor } }),
  };
}
