import { getObservation } from '@dark-chess/game-core';
import type { GameAction, Piece } from '@dark-chess/game-core';
import { initialLocalGame, sessionReducer } from './session';
import type { LocalGameState } from './session';
import { isReviewCursor } from './review';

// React-owned interaction state; selection is never part of the domain/session.
export interface BoardUiState {
  readonly local: LocalGameState;
  readonly selectedSquare: number | null;
  readonly reviewCursor: number | null;
}

export type BoardUiCommand =
  | { readonly type: 'START'; readonly deck: readonly Piece[] }
  | { readonly type: 'RESTART'; readonly deck: readonly Piece[]; readonly confirmed: boolean }
  | { readonly type: 'UNDO' }
  | { readonly type: 'OPEN_REVIEW' }
  | { readonly type: 'CLOSE_REVIEW' }
  | { readonly type: 'REVIEW_TO'; readonly cursor: number }
  | { readonly type: 'CLICK'; readonly position: number };

export const initialBoardUi: BoardUiState = {
  local: initialLocalGame,
  selectedSquare: null,
  reviewCursor: null,
};

export function boardUiReducer(state: BoardUiState, command: BoardUiCommand): BoardUiState {
  if (command.type === 'OPEN_REVIEW') {
    if (state.local.session?.currentState.status !== 'FINISHED' || state.reviewCursor !== null)
      return state;
    return {
      ...state,
      local: { ...state.local, error: null },
      selectedSquare: null,
      reviewCursor: 0,
    };
  }
  if (command.type === 'CLOSE_REVIEW') {
    return state.reviewCursor === null
      ? state
      : {
          ...state,
          local: { ...state.local, error: null },
          selectedSquare: null,
          reviewCursor: null,
        };
  }
  if (command.type === 'REVIEW_TO') {
    if (
      state.reviewCursor === null ||
      state.local.session?.currentState.status !== 'FINISHED' ||
      !isReviewCursor(command.cursor, state.local.session.actions.length)
    )
      return state;
    return command.cursor === state.reviewCursor
      ? state
      : { ...state, reviewCursor: command.cursor };
  }
  // A historical ACTIVE observation never makes its completed session editable.
  if (state.reviewCursor !== null) return state;
  if (command.type === 'START' || command.type === 'RESTART' || command.type === 'UNDO') {
    const local = sessionReducer(state.local, command);
    return {
      ...state,
      local,
      selectedSquare: local.session === state.local.session ? state.selectedSquare : null,
    };
  }

  const session = state.local.session;
  if (session === null) return state;
  const observation = getObservation(session.currentState);
  const square = observation.board[command.position];
  const ownPiece =
    square?.kind === 'REVEALED' &&
    square.piece.color === observation.playerColors[observation.currentPlayer];

  // Ownership controls selection only. All destination legality stays in the core.
  if (observation.status === 'ACTIVE' && ownPiece) {
    return {
      ...state,
      local: state.local.error === null ? state.local : { ...state.local, error: null },
      selectedSquare: state.selectedSquare === command.position ? null : command.position,
    };
  }

  if (
    observation.status === 'ACTIVE' &&
    state.selectedSquare === null &&
    (square?.kind === 'REVEALED' || square?.kind === 'EMPTY')
  ) {
    return { ...state, local: { ...state.local, error: { code: 'INVALID_SOURCE' } } };
  }

  // Hidden pieces always flip, even with an existing selection. Revealed/empty
  // destinations use MOVE; the core still owns validation for either action.
  const action: GameAction =
    square?.kind === 'HIDDEN' || state.selectedSquare === null
      ? { type: 'FLIP', position: command.position }
      : { type: 'MOVE', from: state.selectedSquare, to: command.position };
  const local = sessionReducer(state.local, {
    type: 'SUBMIT',
    playerId: observation.currentPlayer,
    action,
  });
  return {
    ...state,
    local,
    selectedSquare: local.session === session ? state.selectedSquare : null,
  };
}
