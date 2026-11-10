import type { GameAgent } from './types';
import { createSeededRandom } from './seeded-random';

export const randomAgent: GameAgent = {
  async chooseAction(input, { seed }) {
    const random = createSeededRandom(seed);
    if (input.legalActions.length === 0) {
      throw new RangeError('Random Agent requires at least one permitted action.');
    }
    // One PRNG sample per request: bounded work, with floor(u * actionCount).
    const action = input.legalActions[Math.floor(random() * input.legalActions.length)]!;
    return action.type === 'FLIP'
      ? { type: 'FLIP', position: action.position }
      : { type: 'MOVE', from: action.from, to: action.to };
  },
};
