import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createInitialState,
  getLegalActions,
  getObservation,
} from '@dark-chess/game-core';
import type {
  GameAction,
  GameState,
  Piece,
  PieceColor,
  PieceRank,
  Square,
} from '@dark-chess/game-core';
import { getActionError } from '../../../packages/game-core/src/validation';
import { boardUiReducer, initialBoardUi } from '../src/game/interaction';
import type { BoardUiState } from '../src/game/interaction';
import { createShuffledDeck } from '../src/game/deck';
import { sessionReducer } from '../src/game/session';

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function arrangedDeck(attacker: 'CHARIOT' | 'HORSE' = 'CHARIOT'): Piece[] {
  const remaining = createShuffledDeck(() => 1 - Number.EPSILON);
  function take(color: PieceColor, rank: PieceRank): Piece {
    const position = remaining.findIndex((piece) => piece.color === color && piece.rank === rank);
    if (position < 0) throw new Error('Missing fixture piece.');
    return remaining.splice(position, 1)[0]!;
  }
  const fixed = new Map<number, Piece>([
    [0, take('RED', attacker)],
    [1, take('BLACK', 'SOLDIER')],
    [4, take('RED', 'SOLDIER')],
    [5, take('BLACK', 'HORSE')],
  ]);
  return Array.from({ length: 32 }, (_, position) => fixed.get(position) ?? remaining.shift()!);
}

const click = (state: BoardUiState, position: number) =>
  boardUiReducer(freeze(state), { type: 'CLICK', position });
function move(state: BoardUiState, from: number, to: number): BoardUiState {
  const next = click(click(state, from), to);
  if (next.local.error !== null)
    throw new Error(`Expected legal UI move: ${next.local.error.code}`);
  return next;
}

function opening(attacker: 'CHARIOT' | 'HORSE' = 'CHARIOT'): BoardUiState {
  let state = boardUiReducer(initialBoardUi, { type: 'START', deck: arrangedDeck(attacker) });
  for (const position of [0, 1, 4, 5]) state = click(state, position);
  state = move(state, 0, 1); // P1 captures Black Soldier, opening square 0.
  state = move(state, 5, 4); // P2 captures Red Soldier, opening square 5.
  return move(state, 1, 0); // Newly threatens Horse at 4; anchor for non-reciprocal Chariot.
}

const cycle = [
  [4, 5],
  [0, 1],
  [5, 4],
  [1, 0],
] as const;

describe('outcome/chase/session integration', () => {
  it('rejects the third same-coordinate threat without committing selection, counters or timeline; FLIP preserves records', () => {
    let ui = opening();
    for (const [f, t] of [...cycle, ...cycle.slice(0, 3)]) ui = move(ui, f, t);
    const selected = click(ui, 1),
      before = selected.local.session!,
      snapshot = JSON.stringify(before);
    const rejected = click(selected, 0);
    expect(rejected.local.error?.code).toBe('PERPETUAL_CHASE');
    expect(rejected.selectedSquare).toBe(1);
    expect(rejected.local.session).toBe(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    const at59 = freeze({ ...before.currentState, noProgressCount: 59 });
    expect(applyAction(at59, 'P1', { type: 'MOVE', from: 1, to: 0 })).toEqual({
      ok: false,
      error: { code: 'PERPETUAL_CHASE' },
    });
    const flipped = click(rejected, 2);
    expect(flipped.local.error).toBeNull();
    expect(flipped.selectedSquare).toBeNull();
    expect(flipped.local.session!.currentState.chase!.records).toHaveLength(4);
    expect(flipped.local.session!.currentState.noProgressCount).toBe(0);
    expect(boardUiReducer(flipped, { type: 'UNDO' }).local.session).toEqual(before);
  });
  it('does not erase the prohibition after two flips or repeat failed clicks', () => {
    let ui = opening();
    for (const [f, t] of [...cycle, ...cycle.slice(0, 3)]) ui = move(ui, f, t);
    ui = click(click(ui, 1), 0);
    const before = ui.local.session;
    ui = click(ui, 0);
    expect(ui.local.error?.code).toBe('PERPETUAL_CHASE');
    expect(ui.local.session).toBe(before);
    ui = click(ui, 31);
    ui = click(ui, 30);
    expect(ui.local.error).toBeNull();
    ui = click(click(ui, 1), 0);
    expect(ui.local.error?.code).toBe('PERPETUAL_CHASE');
  });
  it('allows the same pair on another route while keeping alternatives available', () => {
    let ui = opening();
    for (const [f, t] of [...cycle, ...cycle.slice(0, 3)]) ui = move(ui, f, t);
    ui = click(click(ui, 1), 5);
    expect(ui.local.error).toBeNull();
    const before = ui.local.session!;
    expect(getLegalActions(before.currentState, before.currentState.currentPlayer)).toContainEqual({
      type: 'FLIP',
      position: 31,
    });
    const replay = sessionReducer(
      { session: null, error: null },
      { type: 'START', deck: before.initialDeck },
    );
    let reconstructed = replay;
    for (const e of before.actions)
      reconstructed = sessionReducer(reconstructed, { type: 'SUBMIT', ...e });
    expect(reconstructed.session).toEqual(before);
  });
  it('reconstructs each accepted prefix with exact private ledgers and public projection', () => {
    let ui = opening();
    for (const [f, t] of [...cycle, ...cycle.slice(0, 3)]) ui = move(ui, f, t);
    const session = ui.local.session!;
    let replay = sessionReducer(
      { session: null, error: null },
      { type: 'START', deck: session.initialDeck },
    );
    for (const e of session.actions) replay = sessionReducer(replay, { type: 'SUBMIT', ...e });
    expect(replay.session).toEqual(session);
    expect(getObservation(session.currentState)).not.toHaveProperty('chase');
  });

  it('allows mutual-threat repetition, draws only on quiet ply 60, and locks the terminal session', () => {
    let ui = opening('HORSE');
    expect(ui.local.session?.currentState.chase).toBeNull();
    for (let quiet = 2; quiet <= 60; quiet += 1) {
      const [from, to] = cycle[(quiet - 2) % cycle.length]!;
      ui = move(ui, from, to);
      expect(ui.local.session?.currentState.chase).toBeNull();
      expect(ui.local.session?.currentState.noProgressCount).toBe(quiet);
      if (quiet < 60) expect(ui.local.session?.currentState.status).toBe('ACTIVE');
    }
    const session = ui.local.session!;
    expect(session.currentState.result).toEqual({ type: 'DRAW', reason: 'NO_PROGRESS' });
    expect(session.currentState.currentPlayer).toBe('P1');
    expect(session.actions).toHaveLength(66);
    expect(ui.selectedSquare).toBeNull();
    expect(getLegalActions(session.currentState, 'P1')).toEqual([]);
    const rejected = click(ui, 1);
    expect(rejected.local.error?.code).toBe('GAME_FINISHED');
    expect(rejected.local.session).toBe(session);
    expect(rejected.selectedSquare).toBeNull();
  });

  it.each([false, true])(
    'finishes chase-only immobilization before the next turn (quiet boundary: %s)',
    (atDrawBoundary) => {
      const initialized = createInitialState(arrangedDeck());
      if (!initialized.ok) throw new Error('Expected valid deck.');
      const board: Square[] = Array.from({ length: 32 }, () => null);
      for (const [position, rank, color] of [
        [1, 'CANNON', 'RED'],
        [12, 'HORSE', 'BLACK'],
        [2, 'GENERAL', 'BLACK'],
        [4, 'SOLDIER', 'BLACK'],
        [5, 'SOLDIER', 'BLACK'],
      ] as const)
        board[position] = { revealed: true, piece: { id: `edge-${position}`, rank, color } };
      let state: GameState = freeze({
        ...initialized.state,
        board,
        playerColors: { P1: 'RED', P2: 'BLACK' },
      });
      function accept(action: GameAction) {
        const result = applyAction(freeze(state), state.currentPlayer, action);
        if (!result.ok) throw new Error(`Expected fixture action: ${result.error.code}`);
        state = result.state;
      }
      accept({ type: 'MOVE', from: 1, to: 0 });
      const cannonCycle = [
        [12, 13],
        [0, 1],
        [13, 12],
        [1, 0],
      ] as const;
      for (const [from, to] of [...cannonCycle, ...cannonCycle.slice(0, 2)])
        accept({ type: 'MOVE', from, to });
      if (atDrawBoundary) state = freeze({ ...state, noProgressCount: 59 });
      const before = state;
      const beforeSnapshot = JSON.stringify(before);
      expect(getLegalActions(before, before.currentPlayer)).toContainEqual({
        type: 'MOVE',
        from: 13,
        to: 12,
      });
      accept({ type: 'MOVE', from: 13, to: 12 });
      expect(state.status).toBe('FINISHED');
      expect(state.currentPlayer).toBe('P1');
      expect(state.result).toEqual({ type: 'DRAW', reason: 'CHASE_STALEMATE' });
      expect(JSON.stringify(before)).toBe(beforeSnapshot);
      const repeated = applyAction(before, before.currentPlayer, {
        type: 'MOVE',
        from: 13,
        to: 12,
      });
      expect(repeated.ok && repeated.state).toEqual(state);
      if (atDrawBoundary) expect(state.noProgressCount).toBe(60);
      const closing: GameAction = { type: 'MOVE', from: 1, to: 0 };
      expect(
        getActionError({ ...state, status: 'ACTIVE', result: null }, 'P1', closing),
      ).toBeNull();
      expect(getLegalActions(state, 'P1')).toEqual([]);
      const snapshot = JSON.stringify(state);
      expect(applyAction(state, 'P1', closing)).toEqual({
        ok: false,
        error: { code: 'GAME_FINISHED' },
      });
      expect(JSON.stringify(state)).toBe(snapshot);
    },
  );
});
