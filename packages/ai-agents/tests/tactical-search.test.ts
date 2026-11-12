import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from '../../game-core/src/index';
import { deepFreeze } from '../../game-core/tests/fixtures';
import {
  accept,
  arrangedInitial,
  tacticalSnapshot,
  type ProjectionFixture,
} from '../../game-core/tests/public-projection-fixtures';
import {
  createTacticalAgent,
  evaluatePosition,
  explainExpectedValueDecision,
  explainTacticalDecision,
  getHiddenPieceDistribution,
  randomAgent,
  searchPublicPosition,
  type AgentInput,
} from '../src/index';
import { rebasedLegacy, sacrifice } from './ai51-fixtures';
import {
  recaptureFixture,
  profitableFixture,
  escapeFixture,
  forcedLossFixture,
  hiddenTacticalFixture,
} from './tactical-fixtures';

const move = (from: number, to: number): core.GameAction => ({ type: 'MOVE', from, to });
const flip = (position: number): core.GameAction => ({ type: 'FLIP', position });
const actionKey = (action: core.GameAction) => JSON.stringify(action);
function input(fixture: ProjectionFixture): AgentInput {
  return {
    observation: core.getObservation(fixture.state),
    publicHistory: fixture.history,
    perspective: fixture.state.currentPlayer,
    legalActions: core.getLegalActions(fixture.state, fixture.state.currentPlayer),
  };
}
afterEach(() => vi.restoreAllMocks());

// Independent, exhaustive public-tree oracle: no ordering, budget, cache or pruning.
function oracle(
  position: Omit<AgentInput, 'legalActions'>,
  depth: number,
  context = core.createPublicProjectionContext(position),
): number {
  if (depth === 0 || position.observation.status === 'FINISHED')
    return evaluatePosition(position).total;
  const color = position.observation.playerColors[position.observation.currentPlayer];
  const actions: core.GameAction[] =
    color === null ? [] : [...core.getPublicOrdinaryMoves(position.observation.board, color)];
  position.observation.board.forEach((square, index) => {
    if (square.kind === 'HIDDEN') actions.push(flip(index));
  });
  const values = actions.flatMap((action) => {
    const outcomes =
      action.type === 'FLIP'
        ? getHiddenPieceDistribution(position).outcomes
        : [{ piece: undefined, probability: 1 }];
    let score = 0;
    for (const outcome of outcomes) {
      const next = core.projectPublicAction(context, action, outcome.piece);
      if (!next.ok) {
        if (next.error.code === 'PERPETUAL_CHASE') return [];
        throw new Error(next.error.code);
      }
      score +=
        outcome.probability *
        oracle(
          {
            observation: next.observation,
            publicHistory: [...position.publicHistory, next.event],
            perspective: position.perspective,
          },
          depth - 1,
          next.nextContext,
        );
    }
    return [score];
  });
  return position.observation.currentPlayer === position.perspective
    ? Math.max(...values)
    : Math.min(...values);
}

describe('AI-6A public selective expectiminimax', () => {
  it('counts every actual Core call, including EV ranking, and uses exact fallback on incomplete chance iteration', () => {
    const request = deepFreeze(input(arrangedInitial([])));
    const baseline = explainExpectedValueDecision(request, { seed: 73 });
    const projection = vi.spyOn(core, 'projectPublicAction');
    const result = explainTacticalDecision(request, { seed: 73 });
    expect(result.diagnostics.projections).toBe(8192);
    expect(projection).toHaveBeenCalledTimes(result.diagnostics.projections);
    expect(result.diagnostics.baselineProjections).toBe(448);
    expect(result.diagnostics.completedDepth).toBe(1);
    expect(result.diagnostics.budgetExhausted).toBe(true);
    expect(result.diagnostics.fallback).toBe('EV');
    expect(result.iterations).toEqual([]);
    expect(result.baseline).toEqual(baseline);
    expect(result.selectedAction).toEqual(baseline.selectedAction);
    expect(result.rootActions).toHaveLength(32);
    expect(result.rootActions.every((action) => action.chanceOutcomes === 14)).toBe(true);
    expect(result.diagnostics.rootRetained).toBe(8);
    expect(result.diagnostics.rootFlipsAvailable).toBe(32);
    expect(result.diagnostics.rootFlipsRetained).toBe(8);
  });

  it('never exceeds a fallback-only budget and rejects insufficient budgets before any projection', () => {
    const request = input(arrangedInitial([]));
    const projection = vi.spyOn(core, 'projectPublicAction');
    expect(() =>
      explainTacticalDecision(request, { seed: 0 }, { search: { projectionBudget: 447 } }),
    ).toThrow('complete EV fallback');
    expect(projection).not.toHaveBeenCalled();
    const value = explainTacticalDecision(
      request,
      { seed: 0 },
      { search: { projectionBudget: 448 } },
    );
    expect(projection).toHaveBeenCalledTimes(448);
    expect(value.diagnostics.fallback).toBe('EV');
  });

  it('preserves the deepest completed iteration when a later iteration exhausts its budget', () => {
    const request = input(recaptureFixture());
    const complete = explainTacticalDecision(request, { seed: 3 }, { search: { maxDepth: 2 } });
    const interrupted = explainTacticalDecision(
      request,
      { seed: 3 },
      { search: { projectionBudget: complete.diagnostics.projections + 1 } },
    );
    expect(interrupted.diagnostics.completedDepth).toBe(2);
    expect(interrupted.diagnostics.budgetExhausted).toBe(true);
    expect(interrupted.selectedAction).toEqual(complete.selectedAction);
    expect(interrupted.iterations).toEqual(complete.iterations);
    expect(
      interrupted.rootActions
        .filter((action) => action.retained)
        .every((action) => action.completedDepth === 2),
    ).toBe(true);
  });

  it.each(['P1', 'P2'] as const)(
    'recognizes immediate winning captures and mandatory terminal exceptions as %s',
    (seat) => {
      const fixture = tacticalSnapshot(
        [
          [9, 'RED', 'ADVISOR'],
          [10, 'BLACK', 'SOLDIER'],
        ],
        seat,
        seat === 'P1' ? { P1: 'RED', P2: 'BLACK' } : { P1: 'BLACK', P2: 'RED' },
      );
      fixture.state = {
        ...fixture.state,
        playerColors: seat === 'P1' ? { P1: 'RED', P2: 'BLACK' } : { P1: 'BLACK', P2: 'RED' },
      };
      const result = explainTacticalDecision(
        input(fixture),
        { seed: 5 },
        { search: { rootWidth: 1, interiorWidth: 1 } },
      );
      expect(result.selectedAction).toEqual(move(9, 10));
      expect(
        result.rootActions.find(
          (candidate) => actionKey(candidate.action) === actionKey(move(9, 10)),
        ),
      ).toMatchObject({
        tactics: expect.arrayContaining(['WIN', 'TERMINAL', 'CAPTURE']),
        retained: true,
        searchScore: 2,
      });
    },
  );

  it('sees forced capture losses for every root alternative instead of trusting static values', () => {
    const result = explainTacticalDecision(input(forcedLossFixture()), { seed: 3 });
    expect(result.diagnostics.completedDepth).toBe(6);
    expect(result.rootActions.every((action) => action.searchScore === -2)).toBe(true);
    expect(result.diagnostics.terminalVisits).toBeGreaterThan(0);
  });

  it('finds a three-ply forced win with no immediate winning root capture', () => {
    const fixture = tacticalSnapshot([
      [0, 'BLACK', 'SOLDIER'],
      [5, 'RED', 'ADVISOR'],
      [8, 'RED', 'ELEPHANT'],
    ]);
    const value = explainTacticalDecision(input(fixture), { seed: 1 });
    expect(value.rootActions.every((candidate) => !candidate.tactics.includes('WIN'))).toBe(true);
    expect(
      value.iterations
        .find((iteration) => iteration.depth === 3)!
        .scores.some((candidate) => candidate.score === 2),
    ).toBe(true);
    expect(
      value.rootActions.find(
        (candidate) => actionKey(candidate.action) === actionKey(value.selectedAction),
      )?.searchScore,
    ).toBe(2);
  });

  it('avoids the historical sacrifice geometry rebuilt through a valid v3 setup', () => {
    const request = input(rebasedLegacy(sacrifice));
    const value = explainTacticalDecision(request, { seed: sacrifice.seed });
    expect(value.baseline.selectedAction).toEqual(move(10, 14));
    expect(value.selectedAction).toEqual(move(10, 9));
    expect(value.diagnostics.completedDepth).toBe(6);
    expect(value.diagnostics.maximumVisitedPly).toBeLessThanOrEqual(6);
    expect(
      value.rootActions.find((candidate) => actionKey(candidate.action) === actionKey(move(10, 14)))
        ?.searchScore,
    ).toBe(-2);
  });

  it('orders recaptures, recognizes unfavorable exchanges, and prefers profitable exchanges', () => {
    const bad = explainTacticalDecision(input(recaptureFixture()), { seed: 1 });
    expect(bad.selectedAction).not.toEqual(move(9, 10));
    const capture = bad.rootActions.find(
      (candidate) => actionKey(candidate.action) === actionKey(move(9, 10)),
    )!;
    expect(capture.searchScore!).toBeLessThan(capture.baselineScore);
    expect(
      bad.nodes.some((node) =>
        node.actions.some(
          (action) =>
            action.action.type === 'MOVE' &&
            action.action.from === 11 &&
            action.action.to === 10 &&
            action.tactics.includes('RECAPTURE') &&
            action.retained,
        ),
      ),
    ).toBe(true);
    const good = explainTacticalDecision(input(profitableFixture()), { seed: 1 });
    expect(good.selectedAction).toEqual(move(9, 10));
  });

  it('retains critical defensive escapes even with narrow action selection', () => {
    const value = explainTacticalDecision(
      input(escapeFixture()),
      { seed: 1 },
      { search: { rootWidth: 2 } },
    );
    expect(value.selectedAction.type === 'MOVE' && value.selectedAction.from).toBe(9);
    expect(
      value.rootActions.some(
        (candidate) => candidate.retained && candidate.tactics.includes('DEFENSE'),
      ),
    ).toBe(true);
    expect(value.nodes.some((node) => node.actions.some((candidate) => !candidate.retained))).toBe(
      true,
    );
  });

  it('does not treat a threat as a guaranteed capture when the opponent can evade', () => {
    const fixture = tacticalSnapshot([
      [9, 'RED', 'CHARIOT'],
      [11, 'BLACK', 'HORSE'],
      [24, 'RED', 'SOLDIER'],
      [31, 'BLACK', 'SOLDIER'],
    ]);
    const value = explainTacticalDecision(
      input(fixture),
      { seed: 1 },
      { search: { maxDepth: 2, rootWidth: 1024, interiorWidth: 1024 } },
    );
    const threat = value.rootActions.find(
      (candidate) => actionKey(candidate.action) === actionKey(move(9, 10)),
    )!;
    expect(threat.tactics).toContain('THREAT');
    expect(threat.searchScore!).toBeLessThan(threat.baselineScore);
    expect(
      value.nodes.some(
        (node) =>
          node.player === 'P2' && node.actions.filter((candidate) => candidate.retained).length > 1,
      ),
    ).toBe(true);
  });

  it.each([recaptureFixture, hiddenTacticalFixture])(
    'matches exhaustive public expectiminimax and unpruned values on small trees',
    (fixture) => {
      const request = input(fixture());
      const search = { maxDepth: 3, rootWidth: 1024, interiorWidth: 1024 };
      const pruned = explainTacticalDecision(request, { seed: 7 }, { search });
      const unpruned = explainTacticalDecision(
        request,
        { seed: 7 },
        { search: { ...search, alphaBeta: false } },
      );
      expect(pruned.diagnostics.completedDepth).toBe(3);
      expect(pruned.diagnostics.alphaBetaCutoffs).toBeGreaterThan(0);
      expect(pruned.iterations).toEqual(unpruned.iterations);
      expect(pruned.selectedAction).toEqual(unpruned.selectedAction);
      expect(
        Math.max(...pruned.iterations.at(-1)!.scores.map((action) => action.score)),
      ).toBeCloseTo(oracle(request, 3), 12);
      for (const node of pruned.nodes)
        for (const action of node.actions) {
          if (action.action.type !== 'FLIP' || action.branches.length === 0) continue;
          expect(action.branches.reduce((sum, branch) => sum + branch.probability, 0)).toBeCloseTo(
            1,
            14,
          );
          expect(
            action.branches.every((branch) => branch.probability > 0 && branch.reveal !== null),
          ).toBe(true);
        }
    },
  );

  it('preserves all positive hidden outcomes, updates inventory after a reveal, and reserves a root FLIP', () => {
    const request = input(hiddenTacticalFixture());
    const value = explainTacticalDecision(
      request,
      { seed: 0 },
      { search: { maxDepth: 2, rootWidth: 2 } },
    );
    expect(value.diagnostics.rootFlipsRetained).toBeGreaterThan(0);
    const root = value.nodes.find((node) => node.ply === 0)!;
    const retainedFlip = root.actions.find(
      (action) => action.retained && action.action.type === 'FLIP',
    )!;
    expect(retainedFlip.branches).toHaveLength(2);
    expect(retainedFlip.branches.map((branch) => branch.probability)).toEqual([0.5, 0.5]);
    for (const branch of retainedFlip.branches) {
      const child = value.nodes.find((node) => node.nodeId === branch.nodeId)!;
      for (const action of child.actions.filter((action) => action.action.type === 'FLIP')) {
        expect(action.branches).toHaveLength(1);
        expect(action.branches[0]!.probability).toBe(1);
        expect(action.branches[0]!.reveal).not.toEqual(branch.reveal);
      }
    }
  });

  it('matches authoritative interior legal sets after a complete real revealed opening', () => {
    const fixture = arrangedInitial([]);
    for (let position = 0; position < 32; position += 1) accept(fixture, flip(position));
    const request = input(fixture);
    const value = explainTacticalDecision(
      request,
      { seed: 1 },
      { search: { maxDepth: 2, rootWidth: 1024, interiorWidth: 1024 } },
    );
    expect(value.diagnostics.completedDepth).toBe(2);
    for (const rootAction of value.nodes[0]!.actions) {
      const actual = core.applyAction(
        fixture.state,
        fixture.state.currentPlayer,
        rootAction.action,
      );
      if (!actual.ok) throw new Error(actual.error.code);
      if (actual.state.status === 'FINISHED') continue;
      const child = value.nodes.find((node) => node.nodeId === rootAction.branches[0]!.nodeId)!;
      expect(child.actions.map((action) => actionKey(action.action)).sort()).toEqual(
        core.getLegalActions(actual.state, actual.state.currentPlayer).map(actionKey).sort(),
      );
    }
  });

  it('filters chase-prohibited opponent responses using complete public history', () => {
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
    for (const action of [...opening, ...cycle, ...cycle.slice(0, 2)]) accept(fixture, action);
    const request = { ...input(fixture), legalActions: [move(4, 5)] };
    const value = explainTacticalDecision(request, { seed: 1 }, { search: { maxDepth: 2 } });
    const after = core.applyAction(
      fixture.state,
      fixture.state.currentPlayer,
      request.legalActions[0]!,
    );
    if (!after.ok) throw new Error(after.error.code);
    expect(core.getLegalActions(after.state, after.state.currentPlayer)).not.toContainEqual(
      move(0, 1),
    );
    const reply = value.nodes.find((node) => node.ply === 1)!;
    expect(reply.actions.map((candidate) => candidate.action)).not.toContainEqual(move(0, 1));
    expect(reply.actions.map((candidate) => actionKey(candidate.action)).sort()).toEqual(
      core.getLegalActions(after.state, after.state.currentPlayer).map(actionKey).sort(),
    );
  });

  it('uses terminal draw/immobilization priority with a genuine quiet suffix, without progress bonuses', () => {
    const fixture = tacticalSnapshot(
      [
        [0, 'BLACK', 'SOLDIER'],
        [1, 'RED', 'ADVISOR'],
        [6, 'RED', 'CANNON'],
      ],
      'P2',
    );
    const cycle = [move(0, 4), move(6, 5), move(4, 0), move(5, 6)];
    for (let ply = 0; ply < 59; ply += 1) accept(fixture, cycle[ply % 4]!);
    const value = explainTacticalDecision(
      input(fixture),
      { seed: 1 },
      { search: { rootWidth: 1 } },
    );
    expect(value.diagnostics.rootRetained).toBeGreaterThan(1);
    expect(value.selectedAction).toEqual(move(5, 4));
    expect(value.rootActions.some((action) => action.searchScore === 0)).toBe(true);
    expect(
      value.rootActions.find((action) => actionKey(action.action) === actionKey(move(5, 4)))
        ?.searchScore,
    ).toBe(2);
  });

  it('is deterministic on frozen public inputs and invariant to hidden permutations and private IDs', async () => {
    const fixture = hiddenTacticalFixture();
    const hidden = fixture.state.board.filter((square) => square && !square.revealed).reverse();
    let index = 0;
    const alternate = {
      ...fixture,
      state: {
        ...fixture.state,
        board: fixture.state.board.map((square, position) => {
          const value = square && !square.revealed ? hidden[index++]! : square;
          return value === null
            ? null
            : { ...value, piece: { ...value.piece, id: `opaque-${position}` } };
        }),
      },
    };
    const first = deepFreeze(input(fixture));
    const second = deepFreeze(input(alternate));
    expect(first).toEqual(second);
    const config = { search: { maxDepth: 3 } };
    expect(explainTacticalDecision(first, { seed: 7 }, config)).toEqual(
      explainTacticalDecision(second, { seed: 7 }, config),
    );
    expect(JSON.stringify(explainTacticalDecision(first, { seed: 7 }, config))).not.toMatch(
      /"id"|opaque-|initialDeck|agentSeed/,
    );
    const mutable = { search: { maxDepth: 2 }, evaluation: { weights: { material: 1 } } };
    const policy = createTacticalAgent(mutable);
    const expected = await policy.chooseAction(first, { seed: 7 });
    mutable.search.maxDepth = 1;
    mutable.evaluation.weights.material = 0;
    expect(await policy.chooseAction(first, { seed: 7 })).toEqual(expected);
  });

  it('preserves rotated full-width scores and both player perspectives', () => {
    const fixture = profitableFixture();
    const rotated = {
      state: { ...fixture.state, board: [...fixture.state.board].reverse() },
      history: fixture.history.map((event) =>
        event.type === 'FLIP'
          ? { ...event, position: 31 - event.position }
          : { ...event, from: 31 - event.from, to: 31 - event.to },
      ),
    };
    const configuration = { search: { maxDepth: 2, rootWidth: 1024, interiorWidth: 1024 } };
    const first = explainTacticalDecision(input(fixture), { seed: 9 }, configuration);
    const second = explainTacticalDecision(input(rotated), { seed: 9 }, configuration);
    for (const action of first.rootActions) {
      if (action.action.type !== 'MOVE') throw new Error('Expected revealed position.');
      const mirrored = move(31 - action.action.from, 31 - action.action.to);
      expect(
        second.rootActions.find((value) => actionKey(value.action) === actionKey(mirrored))!
          .searchScore,
      ).toBeCloseTo(action.searchScore!, 12);
    }
    accept(fixture, first.selectedAction);
    const opponent = input(fixture);
    expect(opponent.perspective).toBe('P2');
    const value = explainTacticalDecision(opponent, { seed: 9 }, configuration);
    expect(
      Math.max(...value.iterations[0]!.scores.map((candidate) => candidate.score)),
    ).toBeCloseTo(oracle(opponent, 2), 12);
  });

  it('prefers a winning capture over voluntary chase stalemate at quiet60', () => {
    const fixture = tacticalSnapshot([
      [1, 'RED', 'CANNON'],
      [12, 'BLACK', 'HORSE'],
      [2, 'BLACK', 'GENERAL'],
      [4, 'BLACK', 'SOLDIER'],
      [5, 'BLACK', 'SOLDIER'],
    ]);
    for (const action of [move(1, 0), move(5, 6), move(0, 1), move(2, 3), move(1, 5), move(3, 2)])
      accept(fixture, action);
    const waiting = [move(5, 9), move(2, 3), move(9, 5), move(3, 2)];
    for (let i = 0; i < 44; i++) accept(fixture, waiting[i % 4]!);
    for (const action of [
      move(5, 1),
      move(6, 5),
      move(1, 0),
      move(12, 13),
      move(0, 1),
      move(13, 12),
      move(1, 0),
      move(12, 13),
      move(0, 1),
    ])
      accept(fixture, action);
    expect(fixture.state.noProgressCount).toBe(59);
    const value = explainTacticalDecision(input(fixture), { seed: 1 });
    expect(value.selectedAction).toEqual(move(2, 1));
    expect(
      value.rootActions.find((c) => actionKey(c.action) === actionKey(move(13, 12)))?.searchScore,
    ).toBe(0);
    expect(
      value.nodes[0]!.actions.find((c) => actionKey(c.action) === actionKey(move(13, 12)))!
        .branches[0]!.result,
    ).toEqual({ type: 'DRAW', reason: 'CHASE_STALEMATE' });
  });

  it('rejects invalid inputs/configuration and enforces terminal dominance for replaceable leaves', () => {
    const request = input(escapeFixture());
    for (const search of [
      { maxDepth: 7 },
      { maxDepth: 0 },
      { projectionBudget: 8193 },
      { rootWidth: 0 },
      { interiorWidth: NaN },
    ])
      expect(() => explainTacticalDecision(request, { seed: 0 }, { search })).toThrow(RangeError);
    expect(() => explainTacticalDecision({ ...request, perspective: 'P2' }, { seed: 0 })).toThrow(
      'assigned turn',
    );
    expect(() => explainTacticalDecision({ ...request, legalActions: [] }, { seed: 0 })).toThrow(
      'permitted action',
    );
    expect(() => explainTacticalDecision(request, { seed: -1 })).toThrow(RangeError);
    expect(() => searchPublicPosition(request, { seed: 0 }, {}, {}, () => 2)).toThrow('[-1,1]');
  });

  it.each(['P1', 'P2'] as const)(
    'plays a legal complete game as %s and replays exactly',
    async (seat) => {
      const fixture = arrangedInitial([]);
      const policy = createTacticalAgent();
      const actions: core.GameAction[] = [];
      for (let ply = 0; ply < 600 && fixture.state.status === 'ACTIVE'; ply += 1) {
        const agent = fixture.state.currentPlayer === seat ? policy : randomAgent;
        const request = input(fixture);
        const action = await agent.chooseAction(request, { seed: (ply * 17 + 923) >>> 0 });
        expect(request.legalActions).toContainEqual(action);
        accept(fixture, action);
        actions.push(action);
      }
      expect(fixture.state.status).toBe('FINISHED');
      const replayed = arrangedInitial([]);
      for (const action of actions) accept(replayed, action);
      expect(replayed.state).toEqual(fixture.state);
      expect(replayed.history).toEqual(fixture.history);
    },
    180000,
  );
});
