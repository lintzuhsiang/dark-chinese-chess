import { describe, expect, it } from 'vitest';
import { applyAction, getGameResult, getLegalActions, getObservation } from '../src/index';
import type {
  ActionEvent,
  ActionResult,
  GameAction,
  GameState,
  PieceColor,
  PieceRank,
  PlayerId,
  Square,
} from '../src/index';
import { evaluateOutcome } from '../src/outcomes';
import { deepFreeze, initialState } from './fixtures';

function piece(
  position: number,
  rank: PieceRank,
  color: PieceColor,
  revealed = true,
): readonly [number, Square] {
  return [
    position,
    { piece: { id: `outcome-${color}-${rank}-${position}`, color, rank }, revealed },
  ];
}

function positionState(
  entries: readonly (readonly [number, Square])[],
  noProgressCount = 0,
  currentPlayer: PlayerId = 'P1',
): GameState {
  const board: Square[] = Array.from({ length: 32 }, () => null);
  for (const [position, square] of entries) board[position] = square;
  return deepFreeze({
    ...initialState(),
    board,
    currentPlayer,
    playerColors: { P1: 'RED', P2: 'BLACK' },
    plyCount: 8,
    noProgressCount,
  });
}

function accept(
  state: GameState,
  action: GameAction,
): Extract<ActionResult, { readonly ok: true }> {
  const result = applyAction(deepFreeze(state), state.currentPlayer, deepFreeze(action));
  if (!result.ok) throw new Error(`Expected accepted action, received ${result.error.code}.`);
  return result;
}

describe('no-progress counters', () => {
  it.each([
    { beforeCount: 58, status: 'ACTIVE', result: null },
    { beforeCount: 59, status: 'FINISHED', result: { type: 'DRAW', reason: 'NO_PROGRESS' } },
  ] as const)(
    'quiet movement from $beforeCount reaches the correct boundary',
    ({ beforeCount, status, result }) => {
      const before = positionState(
        [piece(0, 'HORSE', 'RED'), piece(31, 'HORSE', 'BLACK')],
        beforeCount,
      );
      const snapshot = JSON.stringify(before);
      const accepted = accept(before, { type: 'MOVE', from: 0, to: 1 });
      expect(accepted.state.noProgressCount).toBe(beforeCount + 1);
      expect(accepted.state.status).toBe(status);
      expect(accepted.state.result).toEqual(result);
      expect(accepted.state.currentPlayer).toBe('P2');
      expect(accepted.state.plyCount).toBe(9);
      expect(accepted.event).toMatchObject({
        playerId: 'P1',
        ply: 9,
        type: 'MOVE',
        captured: null,
      });
      expect(JSON.stringify(before)).toBe(snapshot);
    },
  );

  it('resets 59 quiet plies on a flip and retains active play', () => {
    const before = positionState(
      [piece(0, 'HORSE', 'RED'), piece(31, 'HORSE', 'BLACK'), piece(9, 'SOLDIER', 'RED', false)],
      59,
    );
    const accepted = accept(before, { type: 'FLIP', position: 9 });
    expect(accepted.state.noProgressCount).toBe(0);
    expect(accepted.state.status).toBe('ACTIVE');
    expect(accepted.state.result).toBeNull();
    expect(accepted.state.currentPlayer).toBe('P2');
    expect(before.noProgressCount).toBe(59);
    expect(before.board[9]?.revealed).toBe(false);
  });

  it('resets 59 quiet plies on a capture and retains active play when enemies remain', () => {
    const before = positionState(
      [piece(9, 'CHARIOT', 'RED'), piece(10, 'HORSE', 'BLACK'), piece(31, 'SOLDIER', 'BLACK')],
      59,
    );
    const accepted = accept(before, { type: 'MOVE', from: 9, to: 10 });
    expect(accepted.state.noProgressCount).toBe(0);
    expect(accepted.state.status).toBe('ACTIVE');
    expect(accepted.state.result).toBeNull();
    expect(before.noProgressCount).toBe(59);
    expect(before.board[10]?.piece.color).toBe('BLACK');
  });

  it.each([
    { action: { type: 'MOVE', from: 9, to: 11 }, code: 'ILLEGAL_MOVE' },
    { action: { type: 'FLIP', position: 9 }, code: 'INVALID_FLIP' },
    { action: { type: 'MOVE', from: 31, to: 30 }, code: 'INVALID_SOURCE' },
  ] as const)('preserves all state on rejected $code attempts at 59', ({ action, code }) => {
    const before = positionState([piece(9, 'CHARIOT', 'RED'), piece(31, 'HORSE', 'BLACK')], 59);
    const snapshot = JSON.stringify(before);
    expect(applyAction(before, 'P1', deepFreeze(action))).toEqual({ ok: false, error: { code } });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('terminal outcomes', () => {
  it.each([
    { actor: 'P1', nextPlayer: 'P2', actorColor: 'RED', targetColor: 'BLACK' },
    { actor: 'P2', nextPlayer: 'P1', actorColor: 'BLACK', targetColor: 'RED' },
  ] as const)(
    'records $actor as winner while advancing the terminal turn to $nextPlayer',
    ({ actor, nextPlayer, actorColor, targetColor }) => {
      const before = positionState(
        [piece(9, 'CHARIOT', actorColor), piece(10, 'HORSE', targetColor)],
        59,
        actor,
      );
      const accepted = accept(before, { type: 'MOVE', from: 9, to: 10 });
      expect(accepted.state.status).toBe('FINISHED');
      expect(accepted.state.result).toEqual({ type: 'WIN', winner: actor, reason: 'NO_PIECES' });
      expect(accepted.state.currentPlayer).toBe(nextPlayer);
      expect(accepted.state.plyCount).toBe(9);
      expect(accepted.state.noProgressCount).toBe(0);
      expect(accepted.event).toMatchObject({
        ply: 9,
        playerId: actor,
        captured: { color: targetColor, rank: 'HORSE' },
      });
      expect(getGameResult(accepted.state)).toEqual(accepted.state.result);
      expect(getGameResult(accepted.state)).not.toBe(accepted.state.result);
      expect(getObservation(accepted.state)).toMatchObject({
        currentPlayer: nextPlayer,
        result: accepted.state.result,
      });
      for (const player of ['P1', 'P2'] as const) {
        expect(getLegalActions(accepted.state, player)).toEqual([]);
        expect(applyAction(accepted.state, player, { type: 'MOVE', from: 10, to: 9 })).toEqual({
          ok: false,
          error: { code: 'GAME_FINISHED' },
        });
      }
      expect(before.status).toBe('ACTIVE');
      expect(before.result).toBeNull();
    },
  );

  it('counts a hidden enemy as a surviving piece after its last revealed piece is captured', () => {
    const before = positionState([
      piece(9, 'CHARIOT', 'RED'),
      piece(10, 'HORSE', 'BLACK'),
      piece(31, 'SOLDIER', 'BLACK', false),
    ]);
    const accepted = accept(before, { type: 'MOVE', from: 9, to: 10 });
    expect(accepted.state.status).toBe('ACTIVE');
    expect(accepted.state.result).toBeNull();
    expect(getLegalActions(accepted.state, 'P2')).toEqual([{ type: 'FLIP', position: 31 }]);
    expect(getObservation(accepted.state).board[31]).toEqual({ kind: 'HIDDEN' });
    expect(JSON.stringify([getObservation(accepted.state), accepted.event])).not.toContain(
      'outcome-',
    );
  });

  it('eliminates a player with no own pieces even while an opposing hidden piece can be flipped', () => {
    const before = positionState([
      piece(9, 'CHARIOT', 'RED'),
      piece(10, 'HORSE', 'BLACK'),
      piece(31, 'SOLDIER', 'RED', false),
    ]);
    const accepted = accept(before, { type: 'MOVE', from: 9, to: 10 });
    expect(accepted.state.result).toEqual({ type: 'WIN', winner: 'P1', reason: 'NO_PIECES' });
    expect(accepted.state.board[31]?.revealed).toBe(false);
  });

  it('does not award a win for capturing General while another enemy remains', () => {
    const before = positionState([
      piece(9, 'SOLDIER', 'RED'),
      piece(10, 'GENERAL', 'BLACK'),
      piece(31, 'HORSE', 'BLACK'),
    ]);
    const accepted = accept(before, { type: 'MOVE', from: 9, to: 10 });
    expect(accepted.state.status).toBe('ACTIVE');
    expect(accepted.state.result).toBeNull();
    expect(getLegalActions(accepted.state, 'P2')).not.toHaveLength(0);
  });

  it('awards immobilization before a draw when a quiet move fills the last escape at ply 60', () => {
    const before = positionState(
      [piece(0, 'SOLDIER', 'BLACK'), piece(1, 'ADVISOR', 'RED'), piece(5, 'HORSE', 'RED')],
      59,
    );
    const accepted = accept(before, { type: 'MOVE', from: 5, to: 4 });
    expect(accepted.state.noProgressCount).toBe(60);
    expect(accepted.state.status).toBe('FINISHED');
    expect(accepted.state.result).toEqual({ type: 'WIN', winner: 'P1', reason: 'NO_LEGAL_ACTION' });
    expect(accepted.state.currentPlayer).toBe('P2');
    expect(accepted.state.board[0]?.piece.color).toBe('BLACK');
  });

  it('allows a flip of either color to prevent immobilization', () => {
    const before = positionState([
      piece(0, 'SOLDIER', 'BLACK'),
      piece(1, 'ADVISOR', 'RED'),
      piece(5, 'HORSE', 'RED'),
      piece(31, 'HORSE', 'RED', false),
    ]);
    const accepted = accept(before, { type: 'MOVE', from: 5, to: 4 });
    expect(accepted.state.status).toBe('ACTIVE');
    expect(accepted.state.result).toBeNull();
    expect(getLegalActions(accepted.state, 'P2')).toEqual([{ type: 'FLIP', position: 31 }]);
  });

  it('can finish on the last flip while preserving the terminal event actor and reset counter', () => {
    const before = positionState(
      [
        piece(0, 'SOLDIER', 'BLACK'),
        piece(1, 'ADVISOR', 'RED'),
        piece(4, 'HORSE', 'RED'),
        piece(31, 'HORSE', 'RED', false),
      ],
      59,
    );
    const accepted = accept(before, { type: 'FLIP', position: 31 });
    expect(accepted.state.currentPlayer).toBe('P2');
    expect(accepted.state.noProgressCount).toBe(0);
    expect(accepted.state.result).toEqual({ type: 'WIN', winner: 'P1', reason: 'NO_LEGAL_ACTION' });
    expect(accepted.event).toMatchObject({ playerId: 'P1', type: 'FLIP', position: 31, ply: 9 });
  });

  it('prioritizes elimination over all other candidate outcome conditions', () => {
    const candidate = positionState([piece(0, 'HORSE', 'RED')], 60, 'P2');
    expect(
      evaluateOutcome(candidate, () => {
        throw new Error('Elimination must short-circuit legality.');
      }),
    ).toEqual({ type: 'WIN', winner: 'P1', reason: 'NO_PIECES' });
  });
});

describe('deterministic outcomes without a general repetition rule', () => {
  const cycle: readonly GameAction[] = [
    { type: 'MOVE', from: 0, to: 1 },
    { type: 'MOVE', from: 31, to: 30 },
    { type: 'MOVE', from: 1, to: 0 },
    { type: 'MOVE', from: 30, to: 31 },
  ];

  it('allows repeated quiet positions until the no-progress boundary and reconstructs the same result', () => {
    const start = positionState([piece(0, 'HORSE', 'RED'), piece(31, 'HORSE', 'BLACK')]);
    let state = start;
    const acceptedStates: GameState[] = [];
    const events: ActionEvent[] = [];
    for (let ply = 0; ply < 60; ply += 1) {
      const accepted = accept(state, cycle[ply % cycle.length]!);
      state = accepted.state;
      acceptedStates.push(state);
      events.push(accepted.event);
      expect(state.noProgressCount).toBe(ply + 1);
      if (ply < 59) {
        expect(state.status).toBe('ACTIVE');
        expect(state.result).toBeNull();
      }
      if ((ply + 1) % cycle.length === 0) expect(state.board).toEqual(start.board);
    }
    expect(state.status).toBe('FINISHED');
    expect(state.result).toEqual({ type: 'DRAW', reason: 'NO_PROGRESS' });
    expect(state.currentPlayer).toBe('P1');
    expect(events[59]).toMatchObject({ playerId: 'P2', ply: start.plyCount + 60 });
    expect(getLegalActions(state, 'P1')).toEqual([]);

    let reconstructed = start;
    for (let ply = 0; ply < 60; ply += 1) {
      const accepted = accept(reconstructed, cycle[ply % cycle.length]!);
      expect(accepted.state).toEqual(acceptedStates[ply]);
      expect(accepted.event).toEqual(events[ply]);
      reconstructed = accepted.state;
    }
    expect(reconstructed).toEqual(state);
    expect(start.noProgressCount).toBe(0);
    expect(start.status).toBe('ACTIVE');
  });
});

describe('active-state legal-action invariant', () => {
  it('never leaves an accepted ACTIVE state without a permitted action in deterministic games', () => {
    let seed = 0x51a5;
    for (let game = 0; game < 8; game += 1) {
      let state = initialState();
      for (let ply = 0; ply < 160 && state.status === 'ACTIVE'; ply += 1) {
        const legal = getLegalActions(state, state.currentPlayer);
        expect(legal.length).toBeGreaterThan(0);
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const next = accept(state, legal[seed % legal.length]!);
        state = next.state;
        if (state.status === 'ACTIVE')
          expect(getLegalActions(state, state.currentPlayer).length).toBeGreaterThan(0);
        else expect(getLegalActions(state, state.currentPlayer)).toEqual([]);
      }
    }
  });
});
