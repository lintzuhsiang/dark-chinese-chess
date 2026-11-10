import { createHmac } from 'node:crypto';
import type { PlayerId } from '../../packages/game-core/src/index';

export const DECISION_SEED_ALGORITHM = 'hmac-sha256-u32le-v1';

export function deriveDecisionSeed(
  agentSeed: number,
  playerId: PlayerId,
  plyCount: number,
): number {
  if (!Number.isInteger(agentSeed) || agentSeed < 0 || agentSeed > 0xffffffff) {
    throw new RangeError('Agent root seed must be an unsigned 32-bit integer.');
  }
  if ((playerId !== 'P1' && playerId !== 'P2') || !Number.isSafeInteger(plyCount) || plyCount < 0) {
    throw new RangeError('Decision seed requires a valid player and nonnegative safe ply count.');
  }
  const message = JSON.stringify(['dark-chess-agent-decision-v1', playerId, plyCount]);
  return createHmac('sha256', String(agentSeed)).update(message).digest().readUInt32LE(0);
}
