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
import { evaluatePosition, explainExpectedValueDecision, type AgentInput } from '../src/index';

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

describe('AI-5.1 chase diagnostics: existing rules, not a rule amendment', () => {
  it('accepts a real same-pair pursuit through five distinct threat positions and replays exactly', () => {
    const fixture = chaseOpening();
    const initialTracker = fixture.state.chase!;
    expect(fixture.state.plyCount).toBe(23);
    expect(initialTracker.phase).toBe('ESCAPE');
    const diagnostics = [];

    for (const [escape, renewal] of [
      [move(5, 6), move(1, 5)],
      [move(6, 2), move(5, 6)],
      [move(2, 1), move(6, 2)],
      [move(1, 0), move(2, 1)],
    ] as const) {
      expect(getLegalActions(fixture.state, 'P2')).toContainEqual(escape);
      accept(fixture, escape);
      expect(fixture.state.chase?.phase).toBe('RENEW');
      const request = input(fixture);
      expect(request.legalActions).toContainEqual(renewal);
      const decision = explainExpectedValueDecision(request, { seed: 0 });
      const projected = projectPermittedPublicAction(request, renewal);
      expect(projected.ok).toBe(true);
      const before = JSON.stringify(fixture.state);
      const accepted = applyAction(fixture.state, 'P1', renewal);
      expect(accepted.ok).toBe(true);
      expect(JSON.stringify(fixture.state)).toBe(before);
      if (!accepted.ok || !projected.ok) throw new Error('Expected an accepted renewal.');
      expect(projected.observation).toEqual(getObservation(accepted.state));
      expect(projected.event).toEqual(accepted.event);

      const chosen = applyAction(fixture.state, 'P1', decision.selectedAction);
      if (!chosen.ok) throw new Error('Expected a permitted EV action.');
      const chosenHistory = [...fixture.history, chosen.event];
      const replyInput: AgentInput = {
        observation: getObservation(chosen.state),
        legalActions: getLegalActions(chosen.state, 'P2'),
        publicHistory: chosenHistory,
        perspective: 'P2',
      };
      const replyDecision = explainExpectedValueDecision(replyInput, { seed: 0 });
      const replies = getLegalActions(chosen.state, 'P2').flatMap((action) => {
        // Public immediate MOVE responses only; FLIP requires outcome enumeration.
        if (action.type !== 'MOVE') return [];
        const response = applyAction(chosen.state, 'P2', action);
        if (!response.ok) throw new Error('Expected a permitted reply.');
        return [
          {
            action,
            event: response.event,
            evaluationFromP1: evaluatePosition({
              observation: getObservation(response.state),
              publicHistory: [...chosenHistory, response.event],
              perspective: 'P1',
            }),
          },
        ];
      });
      const minimumReplyScore = Math.min(...replies.map((reply) => reply.evaluationFromP1.total));
      diagnostics.push({
        input: request,
        decision,
        scriptedRenewal: renewal,
        replyDecision,
        strongestImmediateMoveReplies: replies.filter(
          (reply) => reply.evaluationFromP1.total === minimumReplyScore,
        ),
      });

      accept(fixture, renewal);
      expect(fixture.state.chase).toMatchObject({
        attackerPlayer: initialTracker.attackerPlayer,
        attackerId: initialTracker.attackerId,
        targetId: initialTracker.targetId,
        phase: 'ESCAPE',
      });
      expect(Object.values(fixture.state.chase!.positionCounts).every((count) => count === 1)).toBe(
        true,
      );
      expect(
        Object.values(fixture.state.chase!.positionCounts).reduce((sum, count) => sum + count, 0),
      ).toBe(diagnostics.length + 1);
    }
    expect(Object.keys(fixture.state.chase!.positionCounts)).toHaveLength(5);
    expect(fixture.state.status).toBe('ACTIVE');
    expect(diagnostics[0]!.decision.selectedAction).toEqual(move(1, 5));
    expect(diagnostics[0]!.strongestImmediateMoveReplies.map((reply) => reply.action)).toEqual([
      move(6, 2),
    ]);
    const firstReply = diagnostics[0]!.replyDecision;
    expect(firstReply.selectedAction).toEqual(move(6, 2));
    expect(Math.max(...firstReply.actionEvaluations.map((action) => action.expectedScore))).toBe(
      -0.0811491935483871,
    );
    expect(
      Math.max(
        ...firstReply.actionEvaluations
          .filter((action) => action.action.type === 'FLIP')
          .map((action) => action.expectedScore),
      ),
    ).toBe(-0.08366935483870969);

    const replay = arrangedInitial([
      [0, 'RED', 'CHARIOT'],
      [1, 'BLACK', 'SOLDIER'],
      [2, 'BLACK', 'SOLDIER'],
      [4, 'BLACK', 'SOLDIER'],
      [5, 'BLACK', 'HORSE'],
      [6, 'BLACK', 'SOLDIER'],
    ]);
    for (const event of fixture.history) {
      accept(replay, event.type === 'FLIP' ? flip(event.position) : move(event.from, event.to));
    }
    expect(replay.state).toEqual(fixture.state);
    expect(replay.history).toEqual(fixture.history);
  });

  it('currently accepts appearances two and three, and rejects appearance four without changing the turn', () => {
    const fixture = chaseOpening();
    const key = Object.keys(fixture.state.chase!.positionCounts)[0]!;
    const cycle = [move(5, 4), move(1, 0), move(4, 5), move(0, 1)];
    for (const appearance of [2, 3]) {
      for (const action of cycle) accept(fixture, action);
      expect(fixture.state.chase?.positionCounts[key]).toBe(appearance);
    }
    for (const action of cycle.slice(0, -1)) accept(fixture, action);
    const before = JSON.stringify(fixture);
    const action = cycle[3]!;
    expect(getLegalActions(fixture.state, 'P1')).not.toContainEqual(action);
    expect(applyAction(fixture.state, 'P1', action)).toEqual({
      ok: false,
      error: { code: 'PERPETUAL_CHASE' },
    });
    expect(projectPermittedPublicAction(input(fixture), action)).toEqual({
      ok: false,
      error: { code: 'PERPETUAL_CHASE' },
    });
    expect(JSON.stringify(fixture)).toBe(before);
  });
});
