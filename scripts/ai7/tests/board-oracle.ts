// Engineering-only public successor vectors for the Torch board-projection test.
import {
  createPublicProjectionContext,
  getLegalActions,
  getObservation,
  projectPublicAction,
} from '../../../packages/game-core/src/index';
import { tacticalSnapshot } from '../../../packages/game-core/tests/public-projection-fixtures';
import { actionId, createPublicMemory } from '../environment';
import { rotateAction, rotateEvent } from '../symmetry';

const positions = [
  tacticalSnapshot([
    [0, 'RED', 'CANNON'],
    [4, 'RED', 'SOLDIER'],
    [12, 'BLACK', 'GENERAL'],
  ]),
  tacticalSnapshot([
    [14, 'RED', 'CHARIOT'],
    [15, 'BLACK', 'SOLDIER'],
    [28, 'BLACK', 'HORSE'],
  ]),
];

const cases = positions.flatMap(({ state, history }) =>
  [false, true].map((rotated) => {
    const original = getObservation(state);
    const observation = rotated ? { ...original, board: [...original.board].reverse() } : original;
    const publicHistory = rotated ? history.map(rotateEvent) : history;
    const actions = getLegalActions(state, state.currentPlayer).map((action) =>
      rotated ? rotateAction(action) : action,
    );
    const memory = createPublicMemory();
    publicHistory.forEach(memory.accept);
    const context = createPublicProjectionContext({ observation, publicHistory });
    const moves = actions.flatMap((action) => {
      if (action.type === 'FLIP') return [];
      const next = projectPublicAction(context, action);
      if (!next.ok) throw new Error(next.error.code);
      return [{ id: actionId(action), board: memory.encode(next.observation, []).board }];
    });
    return { observation: memory.encode(observation, actions), moves };
  }),
);
console.log(JSON.stringify(cases));
