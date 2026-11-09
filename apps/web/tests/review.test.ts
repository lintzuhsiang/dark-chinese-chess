import { describe, expect, it } from 'vitest';
import { getObservation } from '@dark-chess/game-core';
import { boardUiReducer, initialBoardUi } from '../src/game/interaction';
import type { BoardUiCommand } from '../src/game/interaction';
import { reconstructGame } from '../src/game/reconstruct';
import { projectSession } from '../src/game/review';
import { sessionReducer } from '../src/game/session';
import { flip, freeze, pairDeck, recordedGame } from './history-fixtures';
import { finishedBranchGame, finishedChaseGame, finishedHiddenGame } from './review-fixtures';

const branch = finishedBranchGame();
const chase = finishedChaseGame();
const hidden = finishedHiddenGame();

describe('Progressive Review projection', () => {
  it.each([['undo and different continuation', branch], ['chase returns and reset', chase], ['draw with hidden pieces', hidden]] as const)(
    'matches original full states and only public events at every cursor: %s', (_name, game) => {
      const session = freeze(game.final.session!);
      expect(session.currentState.status).toBe('FINISHED');
      expect(session).toEqual(game.states.at(-1)!.session);
      const snapshot = JSON.stringify(session);
      for (let cursor = 0; cursor <= session.actions.length; cursor += 1) {
        const expected = game.states[cursor]!.session!.currentState;
        const reconstructed = reconstructGame(session.initialDeck, session.actions.slice(0, cursor));
        expect(reconstructed.state).toEqual(expected); // Includes IDs, counters, and private chase state.
        const view = projectSession(session, cursor);
        expect(view.observation).toEqual(getObservation(expected));
        expect(view.history).toEqual(game.events.slice(0, cursor));
        expect(view.history).toHaveLength(cursor);
        expect(view.captured).toEqual(game.events.slice(0, cursor)
          .flatMap(event => event.type === 'MOVE' && event.captured ? [event.captured] : []));
        if (cursor < session.actions.length) expect(view.observation.result).toBeNull();
        expect(JSON.stringify(view)).not.toMatch(/RED-|BLACK-|positionCounts|attackerId|initialDeck/);
      }
      expect(JSON.stringify(session)).toBe(snapshot);
      expect(projectSession(session, null).observation).toEqual(getObservation(session.currentState));
    },
  );

  it('exercises actual chase tracking before a completed game rather than only null trackers', () => {
    expect(chase.states.some(local => local.session!.currentState.chase !== null)).toBe(true);
    expect(chase.states[18]!.session!.currentState.chase?.phase).toBe('RENEW');
    expect(chase.states[19]!.session!.currentState.chase).toBeNull();
  });

  it('keeps unflipped identities hidden even at the final Review cursor', () => {
    const session = hidden.final.session!;
    const final = projectSession(session, session.actions.length);
    expect(final.observation.status).toBe('FINISHED');
    expect(final.observation.board.filter(square => square.kind === 'HIDDEN')).toHaveLength(28);
    expect(JSON.stringify(final)).not.toMatch(/GENERAL|ADVISOR|RED-|BLACK-/);
  });

  it('shows the original hidden board at zero and excludes abandoned reveals/captures from prefixes', () => {
    const session = freeze(branch.final.session!);
    const zero = projectSession(session, 0);
    expect(zero.observation).toMatchObject({ currentPlayer: 'P1', playerColors: { P1: null, P2: null }, status: 'ACTIVE', result: null });
    expect(zero.observation.board).toEqual(Array.from({ length: 32 }, () => ({ kind: 'HIDDEN' })));
    expect(zero.history).toEqual([]);
    expect(zero.captured).toEqual([]);
    const two = projectSession(session, 2);
    expect(two.history).not.toContainEqual(branch.abandoned);
    expect(two.observation.board[1]).toEqual({ kind: 'HIDDEN' });
    expect(two.observation.board[31]).toEqual({ kind: 'REVEALED', piece: { color: 'BLACK', rank: 'SOLDIER' } });
    for (let cursor = 0; cursor <= session.actions.length; cursor += 1) {
      expect(projectSession(session, cursor).history).not.toContainEqual(branch.abandoned);
    }
    expect(projectSession(session, 33).captured).toEqual([{ color: 'BLACK', rank: 'GENERAL' }]);
    expect(projectSession(session, 34).captured).toEqual([
      { color: 'BLACK', rank: 'GENERAL' }, { color: 'RED', rank: 'SOLDIER' },
    ]);
  });
});

describe('Review controller guards and navigation', () => {
  const completed = freeze({ ...initialBoardUi, local: branch.final });

  it('requires completion and clears stale temporary state on entry/exit without changing the session', () => {
    for (const local of [initialBoardUi.local, recordedGame(pairDeck(), [flip(0)]).final]) {
      const active = freeze({ ...initialBoardUi, local });
      expect(boardUiReducer(active, { type: 'OPEN_REVIEW' })).toBe(active);
      expect(boardUiReducer(active, { type: 'REVIEW_TO', cursor: 0 })).toBe(active);
    }
    const stale = freeze({ ...completed, selectedSquare: 0, local: { ...completed.local, error: { code: 'GAME_FINISHED' as const } } });
    const entered = freeze(boardUiReducer(stale, { type: 'OPEN_REVIEW' }));
    expect(entered.reviewCursor).toBe(0);
    expect(entered.selectedSquare).toBeNull();
    expect(entered.local.error).toBeNull();
    expect(entered.local.session).toBe(stale.local.session);
    const exited = boardUiReducer(entered, { type: 'CLOSE_REVIEW' });
    expect(exited).toEqual(completed);
    expect(exited.local.session).toBe(completed.local.session);
    expect(boardUiReducer(exited, { type: 'CLOSE_REVIEW' })).toBe(exited);
  });

  it('navigates both boundaries, next/previous, and returns to the unchanged completed projection', () => {
    const snapshot = JSON.stringify(completed);
    let ui = freeze(boardUiReducer(completed, { type: 'OPEN_REVIEW' }));
    for (const cursor of [1, 2, 1, branch.events.length, branch.events.length - 1, 0]) {
      ui = freeze(boardUiReducer(ui, { type: 'REVIEW_TO', cursor }));
      expect(ui.reviewCursor).toBe(cursor);
      expect(ui.local.session).toBe(completed.local.session);
      expect(projectSession(ui.local.session!, ui.reviewCursor).history).toHaveLength(cursor);
    }
    const exited = boardUiReducer(ui, { type: 'CLOSE_REVIEW' });
    expect(projectSession(exited.local.session!, exited.reviewCursor)).toEqual(projectSession(completed.local.session!, null));
    expect(JSON.stringify(completed)).toBe(snapshot);
    const restarted = boardUiReducer(exited, { type: 'RESTART', deck: pairDeck(), confirmed: false });
    expect(restarted.reviewCursor).toBeNull();
    expect(restarted.local.session!.actions).toEqual([]);
  });

  it.each([-1, 95, 0.5, NaN, Infinity, -Infinity])('ignores invalid cursor %s without mutation or errors', cursor => {
    const ui = freeze(boardUiReducer(completed, { type: 'OPEN_REVIEW' }));
    expect(boardUiReducer(ui, { type: 'REVIEW_TO', cursor })).toBe(ui);
  });

  it('blocks gameplay commands while an ACTIVE historical prefix is displayed', () => {
    const ui = freeze(boardUiReducer(completed, { type: 'OPEN_REVIEW' }));
    expect(projectSession(ui.local.session!, ui.reviewCursor).observation.status).toBe('ACTIVE');
    const commands: readonly BoardUiCommand[] = [
      { type: 'CLICK', position: 0 }, { type: 'CLICK', position: 31 }, { type: 'UNDO' },
      { type: 'START', deck: pairDeck() }, { type: 'RESTART', deck: pairDeck(), confirmed: true },
    ];
    for (const command of commands) expect(boardUiReducer(ui, command)).toBe(ui);
    const direct = sessionReducer(ui.local, { type: 'SUBMIT', playerId: 'P1', action: flip(0) });
    expect(direct.error?.code).toBe('GAME_FINISHED');
    expect(direct.session).toBe(ui.local.session);
    const next = boardUiReducer(ui, { type: 'REVIEW_TO', cursor: 1 });
    expect(boardUiReducer(next, { type: 'OPEN_REVIEW' })).toBe(next);
  });
});
