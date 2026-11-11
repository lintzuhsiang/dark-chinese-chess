import { getLegalActions } from '@dark-chess/game-core';
import type { Piece, PlayerId } from '@dark-chess/game-core';
import {
  readAction,
  sameAction,
  sameToken,
  type AgentKind,
  type AiFailure,
  type DecisionToken,
} from '../ai/protocol';
import {
  boardUiReducer,
  initialBoardUi,
  type BoardUiCommand,
  type BoardUiState,
} from './interaction';
import { sessionReducer } from './session';

export type PlayMode =
  | { readonly kind: 'LOCAL' }
  | {
      readonly kind: 'AI';
      readonly humanSeat: PlayerId;
      readonly agent: AgentKind;
      readonly agentSeed: number;
    };
export interface PlayState {
  readonly ui: BoardUiState;
  readonly mode: PlayMode;
  readonly generation: number;
  readonly revision: number;
  readonly nextRequestId: number;
  readonly pending: {
    readonly token: DecisionToken;
    readonly legalActions: ReturnType<typeof getLegalActions>;
  } | null;
  readonly failure: AiFailure | null;
}

export type PlayCommand =
  | { readonly type: 'START_PLAY'; readonly deck: readonly Piece[]; readonly mode: PlayMode }
  | {
      readonly type: 'RESTART_PLAY';
      readonly deck: readonly Piece[];
      readonly confirmed: boolean;
      readonly agentSeed: number;
    }
  | { readonly type: 'LEAVE_PLAY'; readonly confirmed: boolean }
  | {
      readonly type: 'UI';
      readonly command: Exclude<BoardUiCommand, { type: 'START' | 'RESTART' }>;
    }
  | { readonly type: 'BEGIN_AI' }
  | { readonly type: 'AI_RESULT'; readonly token: DecisionToken; readonly action: unknown }
  | { readonly type: 'AI_FAILED'; readonly token: DecisionToken; readonly failure: AiFailure }
  | { readonly type: 'RETRY_AI' };

export const initialPlay: PlayState = {
  ui: initialBoardUi,
  mode: { kind: 'LOCAL' },
  generation: 0,
  revision: 0,
  nextRequestId: 0,
  pending: null,
  failure: null,
};

export function aiToMove(state: PlayState): boolean {
  const current = state.ui.local.session?.currentState;
  return (
    state.mode.kind === 'AI' &&
    current?.status === 'ACTIVE' &&
    current.currentPlayer !== state.mode.humanSeat &&
    state.ui.reviewCursor === null
  );
}

function matchesPending(state: PlayState, token: DecisionToken): boolean {
  return (
    state.pending !== null &&
    sameToken(state.pending.token, token) &&
    state.generation === token.generation &&
    state.revision === token.revision &&
    state.ui.local.session?.currentState.currentPlayer === token.playerId &&
    aiToMove(state)
  );
}

/** Trusted browser coordinator. Session stays the sole canonical timeline owner. */
export function playReducer(state: PlayState, command: PlayCommand): PlayState {
  if (command.type === 'START_PLAY' || command.type === 'RESTART_PLAY') {
    const ui = boardUiReducer(
      state.ui,
      command.type === 'START_PLAY'
        ? { type: 'START', deck: command.deck }
        : { type: 'RESTART', deck: command.deck, confirmed: command.confirmed },
    );
    if (ui.local.session === state.ui.local.session) return { ...state, ui };
    const mode =
      command.type === 'START_PLAY'
        ? command.mode
        : state.mode.kind === 'AI'
          ? { ...state.mode, agentSeed: command.agentSeed }
          : state.mode;
    return {
      ...state,
      ui,
      mode,
      generation: state.generation + 1,
      revision: state.revision + 1,
      pending: null,
      failure: null,
    };
  }
  if (command.type === 'LEAVE_PLAY') {
    if (state.ui.local.session?.currentState.status === 'ACTIVE' && !command.confirmed)
      return state;
    return {
      ...initialPlay,
      generation: state.generation + 1,
      revision: state.revision + 1,
      nextRequestId: state.nextRequestId,
    };
  }
  if (command.type === 'BEGIN_AI') {
    const session = state.ui.local.session;
    if (!aiToMove(state) || state.pending !== null || state.failure !== null || session === null)
      return state;
    const requestId = state.nextRequestId + 1;
    const token = {
      requestId,
      generation: state.generation,
      revision: state.revision,
      playerId: session.currentState.currentPlayer,
    };
    return {
      ...state,
      nextRequestId: requestId,
      pending: { token, legalActions: getLegalActions(session.currentState, token.playerId) },
      ui: { ...state.ui, selectedSquare: null },
    };
  }
  if (command.type === 'AI_RESULT') {
    if (!matchesPending(state, command.token)) return state;
    const action = readAction(command.action);
    if (
      action === null ||
      !state.pending!.legalActions.some((offered) => sameAction(offered, action))
    )
      return { ...state, pending: null, failure: 'INVALID_ACTION' };
    // Validate against the actual current state at this commit boundary, then
    // append only an accepted action through the unchanged Session reducer.
    const local = sessionReducer(state.ui.local, {
      type: 'SUBMIT',
      playerId: command.token.playerId,
      action,
    });
    if (local.session === state.ui.local.session)
      return { ...state, pending: null, failure: 'INVALID_ACTION' };
    return {
      ...state,
      ui: { ...state.ui, local, selectedSquare: null },
      revision: state.revision + 1,
      pending: null,
      failure: null,
    };
  }
  if (command.type === 'AI_FAILED')
    return matchesPending(state, command.token)
      ? { ...state, pending: null, failure: command.failure }
      : state;
  if (command.type === 'RETRY_AI')
    return aiToMove(state) && state.pending === null && state.failure !== null
      ? { ...state, failure: null }
      : state;
  if (
    state.mode.kind === 'AI' &&
    (command.command.type === 'UNDO' || (command.command.type === 'CLICK' && aiToMove(state)))
  )
    return state;
  const ui = boardUiReducer(state.ui, command.command);
  const changed = ui.local.session !== state.ui.local.session;
  return { ...state, ui, revision: state.revision + (changed ? 1 : 0) };
}
