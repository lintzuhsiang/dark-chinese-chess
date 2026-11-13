import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getObservation } from '@dark-chess/game-core';
import { importTournament, parseIncident, replayView, selectReplay } from '../src/replay/model';
import { ReplayPosition } from '../src/replay/ReplayPosition';
import { replayCore, replayFixture } from './replay-fixtures';
import { finishedChaseGame } from './review-fixtures';

const fixture = replayFixture();
const load = (value: unknown = fixture.tournament) => importTournament(JSON.stringify(value));
const replay = selectReplay(load(), 0, replayCore);

describe('tournament replay inspector', () => {
  it('replays a Core-generated win without changing the transcript', () => {
    const copy = structuredClone(fixture.tournament);
    const game = finishedChaseGame(),
      session = game.final.session!;
    const match = copy.matches[0]!;
    match.report = {
      ...match.report,
      initialDeck: session.initialDeck,
      actions: session.actions,
      publicHistory: game.events,
      finalState: session.currentState,
      outcome: { type: 'COMPLETED', result: session.currentState.result },
    };
    match.gameLength = session.actions.length;
    match.gameResult = session.currentState.result;
    const file = load(copy),
      before = JSON.stringify(file.raw);
    const selected = selectReplay(file, 0, replayCore);
    expect(selected.error).toBeNull();
    expect(replayView(file, selected, match.gameLength).observation?.result).toEqual({
      type: 'WIN',
      winner: 'P1',
      reason: 'NO_PIECES',
    });
    expect(JSON.stringify(file.raw)).toBe(before);
  });
  it('imports selector summaries without replaying unselected transcripts', () => {
    const copy = structuredClone(fixture.tournament);
    copy.matches[1]!.report.initialDeck = [];
    const file = load(copy);
    expect(file.matches).toHaveLength(2);
    expect(file.matches[0]).toMatchObject({
      seed: 70000,
      leg: 0,
      length: 94,
      agents: { P1: 'test-A', P2: 'test-B' },
      outcome: 'DRAW · NO_PROGRESS',
    });
    expect(selectReplay(file, 0, replayCore).error).toBeNull();
    expect(selectReplay(file, 1, replayCore).error?.ply).toBe(0);
    expect(file.warnings[0]).toContain('Source changed');
  });

  it('replays every prefix through Core, including backward/forward seeks and terminal state', () => {
    expect(replay.error).toBeNull();
    for (const cursor of [0, 94, 1, 33, 34, 0, ...Array.from({ length: 95 }, (_, i) => i)]) {
      const view = replayView(load(), replay, cursor);
      const state = fixture.game.states[cursor]!.session!.currentState;
      expect(view.observation).toEqual(getObservation(state));
      expect(view.quiet).toBe(state.noProgressCount);
      expect(view.events).toEqual(fixture.game.events.slice(0, cursor));
      expect(view.durationMs).toBe(cursor === 0 ? null : cursor - 0.5);
    }
    expect(replayView(load(), replay, 94).observation?.result).toEqual({
      type: 'DRAW',
      reason: 'NO_PROGRESS',
    });
  });

  it('never renders future ranks or private identities and restores hidden squares on backward seeks', () => {
    for (const cursor of [0, 1, 2, 34, 94, 0]) {
      const view = replayView(load(), replay, cursor);
      const html = renderToStaticMarkup(createElement(ReplayPosition, { view, onSeek: () => {} }));
      expect(html).not.toMatch(/RED-|BLACK-|initialDeck|attackerPosition|data-id/);
      if (cursor === 0) {
        expect(html.match(/，暗棋"/g)).toHaveLength(32);
        expect(html).not.toContain('翻棋 ·');
        // Inventory lists standard counts, but never future event details.
        expect(html).toContain('Ply 1 · Not reached');
      }
      expect(html).toContain('EV scores: Not recorded.');
      expect(html).toContain('Candidate rankings: Not recorded.');
      expect(html).toContain('Search trace: Not recorded.');
    }
  });

  it('highlights FLIP and capture source/destination and derives inventory/balance from public history', () => {
    const flip = replayView(load(), replay, 1);
    const one = renderToStaticMarkup(
      createElement(ReplayPosition, { view: flip, onSeek: () => {} }),
    );
    expect(one).toContain('replay-flip');
    expect(flip.inventory.find((r) => r.color === 'RED' && r.rank === 'GENERAL')?.hidden).toBe(0);
    const capture = replayView(load(), replay, 33);
    const html = renderToStaticMarkup(
      createElement(ReplayPosition, { view: capture, onSeek: () => {} }),
    );
    expect(html).toContain('replay-from');
    expect(html).toContain('replay-capture');
    expect(capture.inventory.reduce((n, row) => n + row.remaining, 0)).toBe(31);
    expect(capture.balances).toHaveLength(2);
    expect(replayView(load(), replay, 0).balances[0]).toMatchObject({ red: 64, black: 64 });
    expect(capture.balances[0]!.red - capture.balances[0]!.black).not.toBe(0);
  });

  it('marks observed reversals, repeated blocks, quiet intervals and last progress events', () => {
    const view = replayView(load(), replay, 94);
    for (const kind of ['Reversal', 'Repeating moves', 'No progress', 'Last capture', 'Last FLIP'])
      expect(view.intervals.some((i) => i.kind === kind)).toBe(true);
    expect(view.intervals.find((i) => i.kind === 'No progress')).toMatchObject({
      start: 35,
      end: 94,
    });
    expect(replayView(load(), replay, 0).intervals).toEqual([]);
  });

  it.each([
    [
      'invalid turn',
      (t: ReturnType<typeof replayFixture>['tournament']) => {
        t.matches[0]!.report.actions = [
          { playerId: 'P2', action: { type: 'FLIP', position: 0 } },
          ...t.matches[0]!.report.actions.slice(1),
        ];
      },
      1,
      'NOT_YOUR_TURN',
    ],
    [
      'invalid action',
      (t: ReturnType<typeof replayFixture>['tournament']) => {
        t.matches[0]!.report.actions = [
          ...t.matches[0]!.report.actions.slice(0, 2),
          { playerId: 'P1', action: { type: 'FLIP', position: 0 } },
        ];
      },
      3,
      'INVALID_FLIP',
    ],
    [
      'history mismatch',
      (t: ReturnType<typeof replayFixture>['tournament']) => {
        t.matches[0]!.report.publicHistory = [];
      },
      1,
      'public history',
    ],
    [
      'revision mismatch',
      (t: ReturnType<typeof replayFixture>['tournament']) => {
        t.matches[0]!.report.metadata.coreRevision = 'different';
      },
      0,
      'revision',
    ],
    [
      'source mismatch',
      (t: ReturnType<typeof replayFixture>['tournament']) => {
        t.manifest.source.files[0]!.sha256 = 'different';
      },
      0,
      'source hashes',
    ],
    [
      'final mismatch',
      (t: ReturnType<typeof replayFixture>['tournament']) => {
        t.matches[0]!.report.finalState = {
          ...t.matches[0]!.report.finalState,
          noProgressCount: 0,
        };
      },
      94,
      'final state',
    ],
  ])('stops at exact ply for %s', (_, mutate, ply, message) => {
    const copy = structuredClone(fixture.tournament);
    mutate(copy);
    const file = load(copy),
      selected = selectReplay(file, 0, replayCore);
    expect(selected.error?.ply).toBe(ply);
    expect(selected.error?.message).toContain(message);
    const view = replayView(file, selected, selected.match.length);
    expect(view.cursor).toBe(selected.events.length);
    if (ply === 0) expect(view.observation).toBeNull();
    else if (ply < 94) expect(view.cursor).toBe(ply - 1);
  });

  it('supports truncated/failed prefixes without inventing terminal results, and missing transcripts', () => {
    const copy: Record<string, unknown> = JSON.parse(JSON.stringify(fixture.tournament));
    const matches = copy.matches as Record<string, unknown>[];
    const match = matches[0]!,
      report = match.report as Record<string, unknown>;
    report.actions = fixture.tournament.matches[0]!.report.actions.slice(0, 2);
    report.publicHistory = fixture.game.events.slice(0, 2);
    report.finalState = fixture.game.states[2]!.session!.currentState;
    report.outcome = { type: 'TRUNCATED', reason: 'PLY_LIMIT' };
    match.gameResult = null;
    match.gameLength = 2;
    let file = load(copy);
    expect(selectReplay(file, 0, replayCore).error).toBeNull();
    report.outcome = { type: 'FAILED', error: { code: 'AGENT_ERROR' } };
    file = load(copy);
    expect(selectReplay(file, 0, replayCore).error).toBeNull();
    match.report = null;
    file = load(copy);
    expect(file.matches[0]?.available).toBe(false);
    expect(selectReplay(file, 0, replayCore).error?.message).toContain('No replay transcript');
  });

  it('rejects malformed JSON, wrong schemas, ambiguous selection, and invalid cursor/incident coordinates', () => {
    expect(() => importTournament('{')).toThrow('Invalid JSON');
    expect(() => load({ schemaVersion: 2 })).toThrow('ai-eval-v2');
    const copy = structuredClone(fixture.tournament);
    copy.matches[1]!.leg = 0;
    expect(() => load(copy)).toThrow('Ambiguous');
    for (const cursor of [-1, 0.5, NaN, 95])
      expect(() => replayView(load(), replay, cursor)).toThrow('Ply');
    expect(parseIncident('?seed=70000&leg=1&ply=33')).toEqual({ seed: 70000, leg: 1, ply: 33 });
    expect(parseIncident('')).toBeNull();
    for (const query of [
      '?seed=1',
      '?seed=1&leg=2&ply=0',
      '?seed=1&leg=0&ply=-1',
      '?seed=1&leg=0&ply=',
    ])
      expect(() => parseIncident(query)).toThrow();
  });
});
