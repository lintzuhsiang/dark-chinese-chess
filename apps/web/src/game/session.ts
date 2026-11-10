import { applyAction, createInitialState } from '@dark-chess/game-core';
import type { ActionError, GameAction, GameState, Piece, PlayerId } from '@dark-chess/game-core';
import { reconstructGame } from './reconstruct';
import type { AcceptedAction } from './reconstruct';

export interface LocalGameSession {
  readonly initialDeck: readonly Piece[];
  readonly actions: readonly AcceptedAction[];
  readonly currentState: GameState;
}

export interface LocalGameState {
  readonly session: LocalGameSession | null;
  readonly error: ActionError | { readonly code: 'INVALID_DECK' } | null;
}

export type SessionCommand =
  | { readonly type: 'START'; readonly deck: readonly Piece[] }
  | { readonly type: 'RESTART'; readonly deck: readonly Piece[]; readonly confirmed: boolean }
  | { readonly type: 'UNDO' }
  | { readonly type: 'SUBMIT'; readonly playerId: PlayerId; readonly action: GameAction };

export const initialLocalGame: LocalGameState = { session: null, error: null };

export function sessionReducer(state: LocalGameState, command: SessionCommand): LocalGameState {
  if (command.type === 'START' || command.type === 'RESTART') {
    if (
      command.type === 'RESTART' &&
      (state.session === null ||
        (state.session.currentState.status === 'ACTIVE' && !command.confirmed))
    ) {
      return { ...state, error: { code: 'INVALID_ACTION' } };
    }
    const result = createInitialState(command.deck);
    if (!result.ok) return { ...state, error: result.error };
    if (command.type === 'START' && state.session !== null)
      return { ...state, error: { code: 'INVALID_ACTION' } };
    return {
      session: {
        initialDeck: command.deck.map(({ id, color, rank }) => ({ id, color, rank })),
        actions: [],
        currentState: result.state,
      },
      error: null,
    };
  }
  if (state.session === null) return { ...state, error: { code: 'INVALID_ACTION' } };
  if (command.type === 'UNDO') {
    if (state.session.currentState.status === 'FINISHED')
      return { ...state, error: { code: 'GAME_FINISHED' } };
    if (state.session.actions.length === 0) return { ...state, error: { code: 'INVALID_ACTION' } };
    const actions = state.session.actions.slice(0, -1);
    const reconstructed = reconstructGame(state.session.initialDeck, actions);
    return {
      session: { ...state.session, actions, currentState: reconstructed.state },
      error: null,
    };
  }
  const result = applyAction(state.session.currentState, command.playerId, command.action);
  if (!result.ok) return { ...state, error: result.error };
  const event = result.event;
  const action: GameAction =
    event.type === 'FLIP'
      ? { type: 'FLIP', position: event.position }
      : { type: 'MOVE', from: event.from, to: event.to };
  return {
    session: {
      ...state.session,
      currentState: result.state,
      actions: [...state.session.actions, { playerId: command.playerId, action }],
    },
    error: null,
  };
}
