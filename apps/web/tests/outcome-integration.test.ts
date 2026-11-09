import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState, getLegalActions, getObservation } from '@dark-chess/game-core';
import type { GameAction, GameState, Piece, PieceColor, PieceRank, Square } from '@dark-chess/game-core';
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
    const position = remaining.findIndex(piece => piece.color === color && piece.rank === rank);
    if (position < 0) throw new Error('Missing fixture piece.');
    return remaining.splice(position, 1)[0]!;
  }
  const fixed = new Map<number, Piece>([
    [0, take('RED', attacker)], [1, take('BLACK', 'SOLDIER')],
    [4, take('RED', 'SOLDIER')], [5, take('BLACK', 'HORSE')],
  ]);
  return Array.from({ length: 32 }, (_, position) => fixed.get(position) ?? remaining.shift()!);
}

const click = (state: BoardUiState, position: number) => boardUiReducer(freeze(state), { type: 'CLICK', position });
function move(state: BoardUiState, from: number, to: number): BoardUiState {
  const next = click(click(state, from), to);
  if (next.local.error !== null) throw new Error(`Expected legal UI move: ${next.local.error.code}`);
  return next;
}

function opening(attacker: 'CHARIOT' | 'HORSE' = 'CHARIOT'): BoardUiState {
  let state = boardUiReducer(initialBoardUi, { type: 'START', deck: arrangedDeck(attacker) });
  for (const position of [0, 1, 4, 5]) state = click(state, position);
  state = move(state, 0, 1); // P1 captures Black Soldier, opening square 0.
  state = move(state, 5, 4); // P2 captures Red Soldier, opening square 5.
  return move(state, 1, 0); // Newly threatens Horse at 4; anchor for non-reciprocal Chariot.
}

const cycle = [[4, 5], [0, 1], [5, 4], [1, 0]] as const;

describe('outcome/chase/session integration', () => {
  it('rejects the third return before committing counters, turn, selection, or timeline', () => {
    let ui = opening();
    const key = Object.keys(ui.local.session!.currentState.chase!.positionCounts)[0]!;
    expect(ui.local.session?.currentState.chase).toMatchObject({ positionCounts: { [key]: 1 }, phase: 'ESCAPE' });
    for (const returns of [1, 2]) {
      for (const [from, to] of cycle) ui = move(ui, from, to);
      expect(ui.local.session?.currentState.chase?.positionCounts[key]).toBe(returns + 1);
    }
    for (const [from, to] of cycle.slice(0, -1)) ui = move(ui, from, to);
    const selected = click(ui, 1);
    const before = selected.local.session!;
    const snapshot = JSON.stringify(before);
    expect(getLegalActions(before.currentState, 'P1')).not.toContainEqual({ type: 'MOVE', from: 1, to: 0 });
    const rejected = click(selected, 0);
    expect(rejected.local.error?.code).toBe('PERPETUAL_CHASE');
    expect(rejected.selectedSquare).toBe(1);
    expect(rejected.local.session).toBe(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    const at59 = freeze({ ...before.currentState, noProgressCount: 59 });
    expect(applyAction(at59, 'P1', { type: 'MOVE', from: 1, to: 0 }))
      .toEqual({ ok: false, error: { code: 'PERPETUAL_CHASE' } });
    expect(at59.noProgressCount).toBe(59);
    expect(at59.result).toBeNull();
    const flipped = click(rejected, 2); // Owner UX: hidden FLIP overrides selected-source MOVE.
    expect(flipped.local.error).toBeNull();
    expect(flipped.selectedSquare).toBeNull();
    expect(flipped.local.session?.currentState.chase).toBeNull();
    expect(flipped.local.session?.currentState.noProgressCount).toBe(0);
    expect(flipped.local.session?.actions).toHaveLength(before.actions.length + 1);
    expect(flipped.local.session?.actions.at(-1)?.action).toEqual({ type: 'FLIP', position: 2 });
  });

  it('reports a later prohibited chase again after accepted flips and a fresh chase cycle', () => {
    let ui = opening();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      for (let returns = 0; returns < 2; returns += 1) {
        for (const [from, to] of cycle) ui = move(ui, from, to);
      }
      for (const [from, to] of cycle.slice(0, -1)) ui = move(ui, from, to);
      ui = click(click(ui, 1), 0);
      expect(ui.local.error?.code).toBe('PERPETUAL_CHASE');
      const rejectedSession = ui.local.session;
      ui = click(ui, 0); // Repeating the rejected destination must report the same error.
      expect(ui.local.error?.code).toBe('PERPETUAL_CHASE');
      expect(ui.local.session).toBe(rejectedSession);
      if (attempt === 0) {
        ui = click(ui, 31);
        ui = click(ui, 30);
        expect(ui.local.error).toBeNull();
        expect(ui.local.session?.currentState.chase).toBeNull();
        ui = move(ui, 1, 0);
        expect(Object.values(ui.local.session!.currentState.chase!.positionCounts)).toEqual([1]);
      }
    }
  });

  it('reports and rejects a new chase pattern elsewhere after the first warning', () => {
    let ui = opening();
    for (let returns = 0; returns < 2; returns += 1) {
      for (const [from, to] of cycle) ui = move(ui, from, to);
    }
    for (const [from, to] of cycle.slice(0, -1)) ui = move(ui, from, to);
    ui = click(click(ui, 1), 0);
    expect(ui.local.error?.code).toBe('PERPETUAL_CHASE');
    ui = click(ui, 5); // Same attacker takes a permitted route while continuing its threat.
    expect(ui.local.error).toBeNull();
    expect(ui.selectedSquare).toBeNull();
    const laterCycle = [[4, 0], [5, 1], [0, 4], [1, 5]] as const;
    for (let returns = 0; returns < 2; returns += 1) {
      for (const [from, to] of laterCycle) ui = move(ui, from, to);
    }
    for (const [from, to] of laterCycle.slice(0, -1)) ui = move(ui, from, to);
    ui = click(ui, 1);
    const before = ui.local.session!;
    const snapshot = JSON.stringify(before);
    expect(getLegalActions(before.currentState, 'P1')).not.toContainEqual({ type: 'MOVE', from: 1, to: 5 });
    ui = click(ui, 5);
    expect(ui.local.error?.code).toBe('PERPETUAL_CHASE');
    expect(ui.selectedSquare).toBe(1);
    expect(ui.local.session).toBe(before);
    expect(JSON.stringify(before)).toBe(snapshot);

    let reconstructed = sessionReducer({ session: null, error: null }, { type: 'START', deck: before.initialDeck });
    for (const entry of before.actions) {
      reconstructed = sessionReducer(reconstructed, { type: 'SUBMIT', ...entry });
      expect(reconstructed.error).toBeNull();
    }
    expect(reconstructed.session).toEqual(before);
    expect(getObservation(before.currentState)).not.toHaveProperty('chase');
  });

  it('reconstructs every accepted prefix including its private tracker and public projection', () => {
    let ui = opening();
    for (let returns = 0; returns < 2; returns += 1) {
      for (const [from, to] of cycle) ui = move(ui, from, to);
    }
    const session = ui.local.session!;
    let reconstructed = sessionReducer({ session: null, error: null }, { type: 'START', deck: session.initialDeck });
    const initial = createInitialState(session.initialDeck);
    if (!initial.ok) throw new Error('Expected valid initial deck.');
    let state = initial.state;
    for (const entry of session.actions) {
      reconstructed = sessionReducer(reconstructed, { type: 'SUBMIT', ...entry });
      const result = applyAction(freeze(state), entry.playerId, freeze(entry.action));
      if (!result.ok) throw new Error('Canonical accepted entry must reproduce.');
      state = result.state;
      expect(reconstructed.session?.currentState).toEqual(state);
      expect(getObservation(state)).not.toHaveProperty('chase');
      expect(JSON.stringify(getObservation(state))).not.toMatch(/RED-CHARIOT-|BLACK-HORSE-|positionCounts/);
    }
    expect(state).toEqual(session.currentState);
    expect(reconstructed.session).toEqual(session);
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

  it('keeps the documented no-alternative chase position active rather than inventing a loss', () => {
    const initialized = createInitialState(arrangedDeck());
    if (!initialized.ok) throw new Error('Expected valid deck.');
    const board: Square[] = Array.from({ length: 32 }, () => null);
    for (const [position, rank, color] of [
      [1, 'CANNON', 'RED'], [12, 'HORSE', 'BLACK'],
      [2, 'GENERAL', 'BLACK'], [4, 'SOLDIER', 'BLACK'], [5, 'SOLDIER', 'BLACK'],
    ] as const) board[position] = { revealed: true, piece: { id: `edge-${position}`, rank, color } };
    let state: GameState = freeze({ ...initialized.state, board, playerColors: { P1: 'RED', P2: 'BLACK' } });
    function accept(action: GameAction) {
      const result = applyAction(freeze(state), state.currentPlayer, action);
      if (!result.ok) throw new Error(`Expected fixture action: ${result.error.code}`);
      state = result.state;
    }
    accept({ type: 'MOVE', from: 1, to: 0 });
    const cannonCycle = [[12, 13], [0, 1], [13, 12], [1, 0]] as const;
    for (let returns = 0; returns < 2; returns += 1) {
      for (const [from, to] of cannonCycle) accept({ type: 'MOVE', from, to });
    }
    for (const [from, to] of cannonCycle.slice(0, -1)) accept({ type: 'MOVE', from, to });
    expect(state.status).toBe('ACTIVE');
    expect(state.result).toBeNull();
    const closing: GameAction = { type: 'MOVE', from: 1, to: 0 };
    expect(getActionError(state, 'P1', closing)).toBeNull();
    expect(getLegalActions(state, 'P1')).toEqual([]);
    const snapshot = JSON.stringify(state);
    expect(applyAction(state, 'P1', closing)).toEqual({ ok: false, error: { code: 'PERPETUAL_CHASE' } });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
