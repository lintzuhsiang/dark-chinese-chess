import { describe, expect, it } from 'vitest';
import {
  applyAction,
  getLegalActions,
  getObservation,
  projectPermittedPublicAction,
  type GameAction,
  type PublicPiece,
} from '../src/index';
import { deepFreeze } from './fixtures';
import {
  accept,
  arrangedInitial,
  tacticalSnapshot,
  type ProjectionFixture,
} from './public-projection-fixtures';

const move = (from: number, to: number): GameAction => ({ type: 'MOVE', from, to });
const flip = (position: number): GameAction => ({ type: 'FLIP', position });

function compare(fixture: ProjectionFixture, action: GameAction, outcome?: PublicPiece) {
  const input = deepFreeze({
    observation: getObservation(fixture.state),
    publicHistory: [...fixture.history],
  });
  const before = JSON.stringify(input);
  const reveal =
    action.type === 'FLIP' ? (outcome ?? fixture.state.board[action.position]!.piece) : undefined;
  const actual = applyAction(
    deepFreeze(fixture.state),
    fixture.state.currentPlayer,
    deepFreeze(action),
  );
  const projected = projectPermittedPublicAction(input, action, reveal);
  expect(projected.ok).toBe(actual.ok);
  if (projected.ok && actual.ok) {
    expect(projected.observation).toEqual(getObservation(actual.state));
    expect(projected.event).toEqual(actual.event);
    expect(JSON.stringify(projected)).not.toMatch(/"(?:id|reference|chase|noProgressCount|seed)":/);
    expect(JSON.stringify(input)).toBe(before);
  } else if (!projected.ok && !actual.ok) {
    expect(projected.error).toEqual(actual.error);
  }
  return projected;
}

describe('public projection differential tests', () => {
  it('matches every initial color/rank reveal at corner, interior, and opposite corner', () => {
    const representatives = new Map<string, PublicPiece>();
    for (const square of arrangedInitial([]).state.board) {
      if (square !== null)
        representatives.set(`${square.piece.color}/${square.piece.rank}`, square.piece);
    }
    for (const position of [0, 5, 31]) {
      for (const piece of representatives.values()) {
        const fixture = arrangedInitial([[position, piece.color, piece.rank]]);
        const result = compare(fixture, flip(position), piece);
        expect(result.ok && result.observation.playerColors.P1).toBe(piece.color);
        expect(result.ok && result.observation.currentPlayer).toBe('P2');
      }
    }
  });

  it('matches every supplied action at sampled real accepted game prefixes and replays to completion', () => {
    let captures = 0;
    let completed = 0;
    let checked = 0;
    for (let seed = 1; seed <= 4; seed += 1) {
      const fixture = arrangedInitial([]);
      let random = seed;
      const actionsTaken: GameAction[] = [];
      for (let ply = 0; ply < 500 && fixture.state.status === 'ACTIVE'; ply += 1) {
        const legal = getLegalActions(fixture.state, fixture.state.currentPlayer);
        if (ply % 8 === 0) {
          for (const action of legal) {
            compare(fixture, action);
            checked += 1;
          }
        }
        const captureActions = legal.filter(
          (action) => action.type === 'MOVE' && fixture.state.board[action.to] !== null,
        );
        const flips = legal.filter((action) => action.type === 'FLIP');
        const candidates =
          captureActions.length > 0 ? captureActions : flips.length > 0 ? flips : legal;
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        const action = candidates[random % candidates.length]!;
        compare(fixture, action);
        accept(fixture, action);
        actionsTaken.push(action);
        const last = fixture.history.at(-1)!;
        if (last.type === 'MOVE' && last.captured !== null) captures += 1;
      }
      expect(fixture.state.status).toBe('FINISHED');
      completed += 1;
      const replay = arrangedInitial([]);
      for (const action of actionsTaken) accept(replay, action);
      expect(replay.state).toEqual(fixture.state);
      expect(replay.history).toEqual(fixture.history);
    }
    expect(checked).toBeGreaterThan(100);
    expect(captures).toBeGreaterThan(0);
    expect(completed).toBe(4);
  });

  it('enumerates later FLIP branches using hidden permutations without exposing identities', () => {
    const fixture = arrangedInitial([
      [0, 'RED', 'CHARIOT'],
      [1, 'BLACK', 'SOLDIER'],
    ]);
    for (const action of [flip(0), flip(1), move(0, 1)]) accept(fixture, action);
    const originalInput = {
      observation: getObservation(fixture.state),
      publicHistory: fixture.history,
    };
    const representatives = new Map<string, number>();
    fixture.state.board.forEach((square, position) => {
      if (square && !square.revealed)
        representatives.set(`${square.piece.color}/${square.piece.rank}`, position);
    });
    for (const position of representatives.values()) {
      const board = [...fixture.state.board];
      [board[5], board[position]] = [board[position]!, board[5]!];
      const variant = { ...fixture, state: { ...fixture.state, board } };
      const reveal = board[5]!.piece;
      const result = compare(variant, flip(5), reveal);
      expect(result).toEqual(projectPermittedPublicAction(originalInput, flip(5), reveal));
      const renamed = {
        ...variant,
        state: {
          ...variant.state,
          board: board.map((square, index) =>
            square === null
              ? null
              : { ...square, piece: { ...square.piece, id: `renamed-${index}` } },
          ),
        },
      };
      expect(compare(renamed, flip(5), reveal)).toEqual(result);
    }
  });

  it('reconstructs real chase continuity, rejects the third return, and resets on a FLIP', () => {
    const fixture = arrangedInitial([
      [0, 'RED', 'CHARIOT'],
      [1, 'BLACK', 'SOLDIER'],
      [4, 'BLACK', 'SOLDIER'],
      [5, 'BLACK', 'HORSE'],
    ]);
    const opening = [
      flip(0),
      flip(1),
      move(0, 1),
      flip(4),
      move(1, 0),
      flip(31),
      move(0, 4),
      flip(5),
      move(4, 0),
      flip(30),
      move(0, 1),
    ];
    const cycle = [move(5, 4), move(1, 0), move(4, 5), move(0, 1)];
    for (const action of [...opening, ...cycle, ...cycle, ...cycle.slice(0, 3)]) {
      compare(fixture, action);
      accept(fixture, action);
    }
    expect(compare(fixture, move(0, 1))).toEqual({ ok: false, error: { code: 'PERPETUAL_CHASE' } });
    compare(fixture, flip(20));
    accept(fixture, flip(20));
    expect(fixture.state.chase).toBeNull();
    compare(fixture, move(5, 4));
  });
});

describe('public projection tactical snapshots (synthetic capture ledgers)', () => {
  it('handles last-FLIP immobilization with the correct next turn and event actor', () => {
    const fixture = tacticalSnapshot([
      [0, 'BLACK', 'SOLDIER'],
      [1, 'RED', 'ADVISOR'],
      [4, 'RED', 'HORSE'],
      [31, 'RED', 'HORSE', false],
    ]);
    const result = compare(fixture, flip(31));
    expect(result.ok && result.observation.result).toEqual({
      type: 'WIN',
      winner: 'P1',
      reason: 'NO_LEGAL_ACTION',
    });
    expect(result.ok && result.event.playerId).toBe('P1');
  });

  it('uses captures for elimination and respects General/Soldier rank exceptions', () => {
    const fixture = tacticalSnapshot([
      [9, 'RED', 'SOLDIER'],
      [10, 'BLACK', 'GENERAL'],
    ]);
    const result = compare(fixture, move(9, 10));
    expect(result.ok && result.observation.result).toEqual({
      type: 'WIN',
      winner: 'P1',
      reason: 'NO_PIECES',
    });
    const reverse = tacticalSnapshot([
      [9, 'RED', 'GENERAL'],
      [10, 'BLACK', 'SOLDIER'],
    ]);
    expect(compare(reverse, move(9, 10))).toEqual({ ok: false, error: { code: 'ILLEGAL_MOVE' } });
  });

  it('shares Cannon screen rules with both hidden and revealed blockers', () => {
    for (const revealed of [false, true]) {
      const fixture = tacticalSnapshot([
        [0, 'RED', 'CANNON'],
        [4, 'RED', 'SOLDIER', revealed],
        [8, 'BLACK', 'GENERAL'],
      ]);
      expect(compare(fixture, move(0, 8)).ok).toBe(true);
      expect(compare(fixture, move(0, 4))).toEqual({ ok: false, error: { code: 'ILLEGAL_MOVE' } });
    }
  });

  it('predicts the quiet draw and FLIP/capture resets after 59 real quiet suffix actions', () => {
    const fixture = tacticalSnapshot([
      [0, 'RED', 'GENERAL'],
      [31, 'BLACK', 'HORSE'],
      [4, 'BLACK', 'SOLDIER'],
      [16, 'RED', 'SOLDIER', false],
    ]);
    const cycle = [move(0, 1), move(31, 30), move(1, 0), move(30, 31)];
    for (let ply = 0; ply < 59; ply += 1) accept(fixture, cycle[ply % 4]!);
    const result = compare(fixture, cycle[59 % 4]!);
    expect(result.ok && result.observation.result).toEqual({ type: 'DRAW', reason: 'NO_PROGRESS' });
    const captureReset = compare(fixture, move(4, 0));
    expect(captureReset.ok && captureReset.observation.status).toBe('ACTIVE');
    const captured = applyAction(fixture.state, fixture.state.currentPlayer, move(4, 0));
    expect(captured.ok && captured.state.noProgressCount).toBe(0);
    const reset = compare(fixture, flip(16));
    expect(reset.ok && reset.observation.status).toBe('ACTIVE');
    accept(fixture, flip(16));
    expect(fixture.state.noProgressCount).toBe(0);
  });

  it('prioritizes immobilization over a draw after a genuine 59-ply quiet suffix', () => {
    const fixture = tacticalSnapshot(
      [
        [0, 'BLACK', 'SOLDIER'],
        [1, 'RED', 'ADVISOR'],
        [6, 'RED', 'HORSE'],
      ],
      'P2',
    );
    const cycle = [move(0, 4), move(6, 5), move(4, 0), move(5, 6)];
    for (let ply = 0; ply < 59; ply += 1) accept(fixture, cycle[ply % 4]!);
    expect(fixture.state.noProgressCount).toBe(59);
    const result = compare(fixture, move(5, 4));
    expect(result.ok && result.observation.result).toEqual({
      type: 'WIN',
      winner: 'P1',
      reason: 'NO_LEGAL_ACTION',
    });
  });

  it.each([0, 48])(
    'detects chase-only Cannon immobilization after %s preliminary quiet plies',
    (preliminary) => {
      const fixture = tacticalSnapshot([
        [1, 'RED', 'CANNON'],
        [12, 'BLACK', 'HORSE'],
        [2, 'BLACK', 'GENERAL'],
        [4, 'BLACK', 'SOLDIER'],
        [5, 'BLACK', 'SOLDIER'],
      ]);
      const prelude = [move(1, 0), move(5, 6), move(0, 1), move(6, 5)];
      for (let ply = 0; ply < preliminary; ply += 1) accept(fixture, prelude[ply % 4]!);
      expect(fixture.state.chase).toBeNull();
      accept(fixture, move(1, 0));
      const cycle = [move(12, 13), move(0, 1), move(13, 12), move(1, 0)];
      for (const action of [...cycle, ...cycle, ...cycle.slice(0, 2)]) accept(fixture, action);
      const result = compare(fixture, move(13, 12));
      expect(result.ok && result.observation.result).toEqual({
        type: 'WIN',
        winner: 'P2',
        reason: 'NO_LEGAL_ACTION',
      });
      accept(fixture, move(13, 12));
      expect(fixture.state.noProgressCount).toBe(preliminary + 12);
    },
  );
});

describe('public projection input/output boundary', () => {
  it('rejects impossible reveal outcomes, invalid actions, finished games, and malformed prefixes', () => {
    const fixture = arrangedInitial([]);
    const input = { observation: getObservation(fixture.state), publicHistory: fixture.history };
    expect(projectPermittedPublicAction(input, flip(0))).toEqual({
      ok: false,
      error: { code: 'INVALID_FLIP' },
    });
    compare(fixture, move(0, 1));
    accept(fixture, flip(0));
    const next = { observation: getObservation(fixture.state), publicHistory: fixture.history };
    expect(projectPermittedPublicAction(next, flip(1), { color: 'RED', rank: 'GENERAL' })).toEqual({
      ok: false,
      error: { code: 'INVALID_FLIP' },
    });
    expect(() =>
      projectPermittedPublicAction({ ...next, publicHistory: [] }, flip(1), {
        color: 'BLACK',
        rank: 'GENERAL',
      }),
    ).toThrow('turn');
    expect(() =>
      projectPermittedPublicAction(
        { ...next, publicHistory: [{ ...fixture.history[0]!, ply: 2 }] },
        flip(1),
        { color: 'BLACK', rank: 'GENERAL' },
      ),
    ).toThrow('sequential');
    expect(
      projectPermittedPublicAction(
        {
          ...next,
          observation: {
            ...next.observation,
            status: 'FINISHED',
            result: { type: 'DRAW', reason: 'NO_PROGRESS' },
          },
        },
        flip(1),
        { color: 'BLACK', rank: 'GENERAL' },
      ),
    ).toEqual({ ok: false, error: { code: 'GAME_FINISHED' } });
  });

  it('returns detached, allowlisted results from frozen public values', () => {
    const fixture = arrangedInitial([]);
    const input = deepFreeze({
      observation: getObservation(fixture.state),
      publicHistory: fixture.history,
    });
    const reveal = deepFreeze({ color: 'RED', rank: 'GENERAL', id: 'not-public' } as const);
    const first = projectPermittedPublicAction(input, flip(0), reveal);
    const second = projectPermittedPublicAction(input, flip(0), reveal);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain('not-public');
    if (!first.ok || !second.ok) throw new Error('Expected legal projection.');
    expect(first.observation.board).not.toBe(second.observation.board);
    Object.assign(first.event.piece, { rank: 'SOLDIER' });
    expect(second.event.piece.rank).toBe('GENERAL');
    expect(first.observation.board[0]).toEqual({
      kind: 'REVEALED',
      piece: { color: 'RED', rank: 'GENERAL' },
    });
  });
});
