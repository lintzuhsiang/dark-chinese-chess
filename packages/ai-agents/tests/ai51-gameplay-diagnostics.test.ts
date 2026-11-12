import { describe, expect, it } from 'vitest';
import { getLegalActions, getObservation } from '../../game-core/src/index';
import {
  evaluatePosition,
  explainExpectedValueDecision,
  explainSafetyTieDecision,
} from '../src/index';
import { accept } from '../../game-core/tests/public-projection-fixtures';
import { rebasedLegacy, replay, sacrifice, stall } from './ai51-fixtures';
const input = (f: ReturnType<typeof rebasedLegacy>) => ({
  observation: getObservation(f.state),
  publicHistory: f.history,
  legalActions: getLegalActions(f.state, f.state.currentPlayer),
  perspective: f.state.currentPlayer,
});
describe('AI-5.1 historical geometry and v3 history compatibility', () => {
  it.each([sacrifice, stall])(
    'retains original evidence but rejects its old perpetual-pursuit transcript under v3',
    (example) => expect(() => replay(example)).toThrow('PERPETUAL_CHASE'),
  );
  it('retains the static-score fatal tie in the same geometry with a newly accepted v3 setup', () => {
    const f = rebasedLegacy(sacrifice),
      request = input(f);
    expect(f.state.noProgressCount).toBe(0);
    const ev = explainExpectedValueDecision(request, { seed: sacrifice.seed }),
      safe = explainSafetyTieDecision(request, { seed: sacrifice.seed });
    expect(ev.selectedAction).toEqual({ type: 'MOVE', from: 10, to: 14 });
    expect(safe.selectedAction).toEqual({ type: 'MOVE', from: 10, to: 9 });
    expect(safe.actionEvaluations).toEqual(ev.actionEvaluations);
    expect(safe.safetyTie.applied).toBe(true);
  });
  it('conserves material across every public FLIP outcome and actual FLIP in rebased stall geometry', () => {
    const f = rebasedLegacy(stall);
    const before = evaluatePosition(input(f));
    const ev = explainExpectedValueDecision(input(f), { seed: stall.seed });
    for (const action of ev.actionEvaluations)
      if ('outcomes' in action)
        for (const o of action.outcomes) expect(o.evaluation.material).toEqual(before.material);
    accept(f, { type: 'FLIP', position: 29 });
    expect(f.state.noProgressCount).toBe(0);
    expect(
      evaluatePosition({ ...input(f), perspective: ev.currentEvaluation.perspective }).material,
    ).toEqual(before.material);
  });
  it('evaluates either terminal draw reason as zero from both fixed perspectives', () => {
    const f = rebasedLegacy(sacrifice);
    for (const perspective of ['P1', 'P2'] as const)
      for (const reason of ['NO_PROGRESS', 'CHASE_STALEMATE'] as const) {
        const value = evaluatePosition({
          observation: {
            ...getObservation(f.state),
            status: 'FINISHED',
            result: { type: 'DRAW', reason },
          },
          publicHistory: f.history,
          perspective,
        });
        expect(value.terminal).toBe(true);
        expect(value.total).toBe(0);
      }
  });
});
