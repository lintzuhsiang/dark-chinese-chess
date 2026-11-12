import { describe, expect, it } from 'vitest';
import {
  applyAction,
  getLegalActions,
  getObservation,
  projectPermittedPublicAction,
  type GameAction,
} from '../../game-core/src/index';
import {
  accept,
  arrangedInitial,
  type ProjectionFixture,
} from '../../game-core/tests/public-projection-fixtures';
import { explainExpectedValueDecision, type AgentInput } from '../src/index';

const flip = (position: number): GameAction => ({ type: 'FLIP', position });
const move = (from: number, to: number): GameAction => ({ type: 'MOVE', from, to });

// Every action is accepted from a real, distribution-valid initial deck. No synthetic ledger.
function chaseOpening(): ProjectionFixture {
  const fixture = arrangedInitial([
    [0, 'RED', 'CHARIOT'],
    [1, 'BLACK', 'SOLDIER'],
    [2, 'BLACK', 'SOLDIER'],
    [4, 'BLACK', 'SOLDIER'],
    [5, 'BLACK', 'HORSE'],
    [6, 'BLACK', 'SOLDIER'],
  ]);
  for (const action of [
    flip(0),
    flip(1),
    move(0, 1),
    flip(4),
    move(1, 0),
    flip(2),
    move(0, 4),
    flip(6),
    move(4, 0),
    flip(31),
    move(0, 1),
    flip(30),
    move(1, 2),
    flip(29),
    move(2, 6),
    flip(28),
    move(6, 2),
    flip(27),
    move(2, 1),
    flip(26),
    move(1, 0),
    flip(5),
    move(0, 1),
  ]) {
    accept(fixture, action);
  }
  return fixture;
}

function input(fixture: ProjectionFixture): AgentInput {
  return {
    observation: getObservation(fixture.state),
    legalActions: getLegalActions(fixture.state, fixture.state.currentPlayer),
    publicHistory: [...fixture.history],
    perspective: fixture.state.currentPlayer,
  };
}

describe('historical AI-5.1 pursuit fixture under v4', () => {
  it('keeps a third changing-coordinate threat available to EV', () => {
    const fixture = chaseOpening();
    accept(fixture, move(5, 6));
    accept(fixture, move(1, 5));
    accept(fixture, move(6, 2));
    const action = move(5, 6),
      before = JSON.stringify(fixture),
      request = input(fixture);
    expect(request.legalActions).toContainEqual(action);
    const accepted = applyAction(fixture.state, 'P1', action);
    const projected = projectPermittedPublicAction(request, action);
    expect(accepted.ok).toBe(true);
    expect(projected.ok && projected.observation).toEqual(
      accepted.ok && getObservation(accepted.state),
    );
    const decision = explainExpectedValueDecision(request, { seed: 0 });
    expect(request.legalActions).toContainEqual(decision.selectedAction);
    expect(JSON.stringify(fixture)).toBe(before);
  });
  it('allows a second same-coordinate appearance with public/private parity', () => {
    const fixture = chaseOpening();
    accept(fixture, move(5, 4));
    accept(fixture, move(1, 0));
    accept(fixture, move(4, 5));
    expect(
      fixture.state.chase!.records.filter(
        (r) =>
          r.attacker === fixture.state.board[0]!.piece.id &&
          r.target === fixture.state.board[5]!.piece.id,
      ),
    ).toHaveLength(2);
    const snapshot = JSON.stringify(fixture);
    expect(projectPermittedPublicAction(input(fixture), move(0, 1)).ok).toBe(true);
    expect(JSON.stringify(fixture)).toBe(snapshot);
  });
});
