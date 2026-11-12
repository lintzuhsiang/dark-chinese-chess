import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from '../../game-core/src/index';
import { accept, arrangedInitial } from '../../game-core/tests/public-projection-fixtures';
import {
  explainExpectedValueDecision,
  explainTacticalDecision,
  getHiddenPieceDistribution,
  type AgentInput,
} from '../src/index';

function request(): AgentInput {
  const f = arrangedInitial([]);
  accept(f, { type: 'FLIP', position: 0 });
  accept(f, { type: 'FLIP', position: 31 });
  return {
    observation: core.getObservation(f.state),
    publicHistory: f.history,
    legalActions: core.getLegalActions(f.state, f.state.currentPlayer),
    perspective: f.state.currentPlayer,
  };
}
afterEach(() => vi.restoreAllMocks());

describe('decision-local reconstruction cost', () => {
  it('EV reconstructs once regardless of candidate and FLIP outcome count', () => {
    const input = request();
    const rebuild = vi.spyOn(core, 'createPublicProjectionContext');
    const project = vi.spyOn(core, 'projectPublicAction');
    const replayWrapper = vi.spyOn(core, 'projectPermittedPublicAction');
    const costs = [];
    for (const legalActions of [input.legalActions.slice(0, 1), input.legalActions]) {
      rebuild.mockClear();
      project.mockClear();
      const result = explainExpectedValueDecision({ ...input, legalActions }, { seed: 0 });
      const count = result.actionEvaluations.reduce(
        (n, row) => n + ('outcomes' in row ? row.outcomes.length : 1),
        0,
      );
      expect(project).toHaveBeenCalledTimes(count);
      expect(rebuild).toHaveBeenCalledTimes(1);
      const root = rebuild.mock.results[0]!.value;
      expect(project.mock.calls.every(([context]) => context === root)).toBe(true);
      costs.push(count);
    }
    expect(costs[1]).toBeGreaterThan(costs[0]!);
    expect(replayWrapper).not.toHaveBeenCalled();
  });

  it('Tactical shares EV/root reconstruction and advances children from existing parent contexts', () => {
    const input = request();
    const rebuild = vi.spyOn(core, 'createPublicProjectionContext');
    const project = vi.spyOn(core, 'projectPublicAction');
    const replayWrapper = vi.spyOn(core, 'projectPermittedPublicAction');
    const baselineCost = input.legalActions.reduce(
      (n, a) => n + (a.type === 'FLIP' ? getHiddenPieceDistribution(input).outcomes.length : 1),
      0,
    );
    const costs = [];
    for (const search of [{ projectionBudget: baselineCost }, {}]) {
      rebuild.mockClear();
      project.mockClear();
      const decision = explainTacticalDecision(input, { seed: 0 }, { search });
      expect(rebuild).toHaveBeenCalledTimes(1);
      expect(project).toHaveBeenCalledTimes(decision.diagnostics.projections);
      const root = rebuild.mock.results[0]!.value;
      const known = new Set([root]);
      let descendants = 0;
      project.mock.calls.forEach(([parent], i) => {
        expect(known.has(parent)).toBe(true);
        if (parent !== root) descendants++;
        const result = project.mock.results[i]!.value;
        if (result.ok) known.add(result.nextContext);
      });
      if (search.projectionBudget === undefined) {
        expect(descendants).toBeGreaterThan(0);
        expect(decision.diagnostics.limits).toEqual({
          maxDepth: 6,
          projectionBudget: 8192,
          rootWidth: 8,
          interiorWidth: 4,
          alphaBeta: true,
        });
      }
      costs.push(decision.diagnostics.projections);
    }
    expect(costs[1]).toBeGreaterThan(costs[0]!);
    expect(replayWrapper).not.toHaveBeenCalled();
  });
});
