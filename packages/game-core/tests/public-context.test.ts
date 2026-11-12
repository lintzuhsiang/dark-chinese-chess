import { describe, expect, it } from 'vitest';
import {
  createPublicProjectionContext,
  projectPublicAction,
  projectPermittedPublicAction,
  getObservation,
  type PublicProjectionContext,
  type PublicProjectionInput,
  type PublicPiece,
} from '../src/index';
import { accept, arrangedInitial, tacticalSnapshot } from './public-projection-fixtures';
import { supportOpening, supportPrefix, v3Move } from './chase-v3-fixtures';
const view = (f: ReturnType<typeof arrangedInitial>): PublicProjectionInput => ({
  observation: getObservation(f.state),
  publicHistory: [...f.history],
});
const publicResult = (r: ReturnType<typeof projectPublicAction>) =>
  r.ok ? { ok: true, observation: r.observation, event: r.event } : r;

describe('opaque public-derived incremental projection context', () => {
  it('matches full replay and private Core at every unchanged historical prefix transition', () => {
    const f = supportOpening();
    let context = createPublicProjectionContext(view(f));
    for (const action of [...supportPrefix, v3Move(0, 1)]) {
      const reveal = action.type === 'FLIP' ? f.state.board[action.position]!.piece : undefined;
      const r = projectPublicAction(context, action, reveal);
      expect(publicResult(r)).toEqual(projectPermittedPublicAction(view(f), action, reveal));
      if (!r.ok) throw Error(r.error.code);
      accept(f, action);
      expect(r.observation).toEqual(getObservation(f.state));
      expect(r.event).toEqual(f.history.at(-1));
      context = r.nextContext;
    }
  });
  it('keeps positive inventory and all chance siblings independent', () => {
    const root = createPublicProjectionContext(view(arrangedInitial([])));
    const red: PublicPiece = { color: 'RED', rank: 'GENERAL' };
    const a = projectPublicAction(root, { type: 'FLIP', position: 0 }, red);
    expect(a.ok).toBe(true);
    if (!a.ok) throw Error();
    expect(projectPublicAction(a.nextContext, { type: 'FLIP', position: 1 }, red)).toEqual({
      ok: false,
      error: { code: 'INVALID_FLIP' },
    });
    expect(projectPublicAction(root, { type: 'FLIP', position: 1 }, red).ok).toBe(true);
    const black = projectPublicAction(
      root,
      { type: 'FLIP', position: 0 },
      { color: 'BLACK', rank: 'GENERAL' },
    );
    expect(black.ok && black.observation.playerColors.P1).toBe('BLACK');
    expect(a.observation.playerColors.P1).toBe('RED');
  });
  it('owns copies and exposes no references, ledgers, private state or seeds', () => {
    const input = view(arrangedInitial([]));
    const root = createPublicProjectionContext(input);
    (input.observation.board as unknown[])[0] = { kind: 'EMPTY' };
    const reveal = { color: 'RED' as const, rank: 'SOLDIER' as const };
    const a = projectPublicAction(root, { type: 'FLIP', position: 0 }, reveal);
    if (!a.ok) throw Error();
    Object.assign(reveal, { rank: 'GENERAL' });
    Object.assign(a.event.piece, { rank: 'GENERAL' });
    (a.observation.board as unknown[])[0] = { kind: 'EMPTY' };
    const next = projectPublicAction(
      a.nextContext,
      { type: 'FLIP', position: 1 },
      { color: 'BLACK', rank: 'HORSE' },
    );
    if (!next.ok) throw Error();
    expect(next.observation.board[0]).toEqual({
      kind: 'REVEALED',
      piece: { color: 'RED', rank: 'SOLDIER' },
    });
    expect(Object.isFrozen(root)).toBe(true);
    expect(Object.keys(root)).toEqual([]);
    expect(JSON.stringify(next)).not.toMatch(
      /"(?:id|reference|chase|activePairs|exhaustedPairs|seed|boardState)":/,
    );
  });
  it('rejects forged or cloned handles and tampered active roots', () => {
    const input = view(arrangedInitial([]));
    const root = createPublicProjectionContext(input);
    for (const forged of [{}, JSON.parse(JSON.stringify(root))])
      expect(() =>
        projectPublicAction(
          forged as PublicProjectionContext,
          { type: 'FLIP', position: 0 },
          { color: 'RED', rank: 'SOLDIER' },
        ),
      ).toThrow('Unknown');
    expect(() =>
      createPublicProjectionContext({
        ...input,
        observation: { ...input.observation, result: { type: 'DRAW', reason: 'CHASE_STALEMATE' } },
      }),
    ).toThrow('active');
    expect(() =>
      createPublicProjectionContext({
        ...input,
        observation: { ...input.observation, currentPlayer: 'P2' },
      }),
    ).toThrow();
  });
  it('keeps invalid actions and repeated sibling projections from consuming the parent context', () => {
    const f = supportOpening();
    for (const a of supportPrefix) accept(f, a);
    const context = createPublicProjectionContext(view(f));
    expect(projectPublicAction(context, v3Move(0, 3)).ok).toBe(false);
    const a = projectPublicAction(context, v3Move(0, 1)),
      b = projectPublicAction(context, v3Move(0, 1));
    expect(publicResult(a)).toEqual(publicResult(b));
    expect(publicResult(a)).toEqual(projectPermittedPublicAction(view(f), v3Move(0, 1)));
  });
  it('advances terminal elimination and rejects further actions on its child', () => {
    const f = tacticalSnapshot([
      [9, 'RED', 'SOLDIER'],
      [10, 'BLACK', 'GENERAL'],
    ]);
    const r = projectPublicAction(createPublicProjectionContext(view(f)), v3Move(9, 10));
    if (!r.ok) throw Error();
    expect(r.observation.result).toEqual({ type: 'WIN', winner: 'P1', reason: 'NO_PIECES' });
    expect(projectPublicAction(r.nextContext, v3Move(10, 9))).toEqual({
      ok: false,
      error: { code: 'GAME_FINISHED' },
    });
  });
  it('preserves CHASE_STALEMATE in the incremental result and full replay wrapper', () => {
    const f = tacticalSnapshot([
      [1, 'RED', 'CANNON'],
      [12, 'BLACK', 'HORSE'],
      [2, 'BLACK', 'GENERAL'],
      [4, 'BLACK', 'SOLDIER'],
      [5, 'BLACK', 'SOLDIER'],
    ]);
    for (const a of [
      v3Move(1, 0),
      v3Move(12, 13),
      v3Move(0, 1),
      v3Move(13, 12),
      v3Move(1, 0),
      v3Move(12, 13),
      v3Move(0, 1),
    ])
      accept(f, a);
    const r = projectPublicAction(createPublicProjectionContext(view(f)), v3Move(13, 12));
    expect(publicResult(r)).toEqual(projectPermittedPublicAction(view(f), v3Move(13, 12)));
    expect(r.ok && r.observation.result).toEqual({ type: 'DRAW', reason: 'CHASE_STALEMATE' });
  });
});
