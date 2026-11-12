import { describe, expect, it } from 'vitest';
import { reconstructGame } from '../../../apps/web/src/game/reconstruct';
import {
  applyAction,
  createPublicProjectionContext,
  getObservation,
  projectPermittedPublicAction,
  projectPublicAction,
  type ActionEvent,
} from '../src/index';
import { accept } from './public-projection-fixtures';
import { chaseOpening, decodeActions, supportOpening, v3Move } from './chase-v3-fixtures';

function beforeThird() {
  const f = supportOpening();
  for (const a of decodeActions(`${chaseOpening} 5>4 1>0 4>5 0>1 5>4 1>0 4>5`)) accept(f, a);
  return f;
}

describe('v4 strict replay and public context parity', () => {
  it('rejects the third appearance through private, complete-prefix and incremental paths without consuming siblings', () => {
    const f = beforeThird();
    const input = { observation: getObservation(f.state), publicHistory: f.history };
    const context = createPublicProjectionContext(input);
    const snapshot = JSON.stringify(input);
    const action = v3Move(0, 1);
    const rejected = { ok: false, error: { code: 'PERPETUAL_CHASE' } };
    expect(applyAction(f.state, 'P1', action)).toEqual(rejected);
    expect(projectPermittedPublicAction(input, action)).toEqual(rejected);
    expect(projectPublicAction(context, action)).toEqual(rejected);
    expect(projectPublicAction(context, action)).toEqual(rejected);
    const flip = { type: 'FLIP' as const, position: 29 };
    const reveal = f.state.board[29]!.piece;
    const a = projectPublicAction(context, flip, reveal);
    const b = projectPublicAction(context, flip, reveal);
    expect(a.ok && a.observation).toEqual(b.ok && b.observation);
    expect(a.ok).toBe(true);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('fails at the exact illegal ply, preserving the supplied replay and never accepting its suffix', () => {
    const f = beforeThird();
    const deck = supportOpening().state.board.map((s) => s!.piece);
    const ply = f.state.plyCount + 1;
    const badEvent: ActionEvent = {
      type: 'MOVE',
      from: 0,
      to: 1,
      ply,
      playerId: 'P1',
      piece: { color: 'RED', rank: 'CHARIOT' },
      captured: null,
    };
    const tail: ActionEvent = {
      type: 'FLIP',
      position: 29,
      ply: ply + 1,
      playerId: 'P2',
      piece: f.state.board[29]!.piece,
    };
    const history = [...f.history, badEvent, tail];
    const actions = history.map((event) => ({
      playerId: event.playerId,
      action:
        event.type === 'MOVE'
          ? v3Move(event.from, event.to)
          : { type: 'FLIP' as const, position: event.position },
    }));
    const snapshot = JSON.stringify({ deck, history, actions });
    expect(() => reconstructGame(deck, actions)).toThrow(`action ${ply}: PERPETUAL_CHASE`);
    const board = [...getObservation(f.state).board];
    board[1] = board[0]!;
    board[0] = { kind: 'EMPTY' };
    board[29] = { kind: 'REVEALED', piece: tail.piece };
    const input = {
      observation: { ...getObservation(f.state), board, currentPlayer: 'P1' as const },
      publicHistory: history,
    };
    expect(() => createPublicProjectionContext(input)).toThrow(`ply ${ply}: PERPETUAL_CHASE (v4)`);
    expect(() => projectPermittedPublicAction(input, v3Move(1, 0))).toThrow(
      `ply ${ply}: PERPETUAL_CHASE (v4)`,
    );
    expect(JSON.stringify({ deck, history, actions })).toBe(snapshot);
  });
});
