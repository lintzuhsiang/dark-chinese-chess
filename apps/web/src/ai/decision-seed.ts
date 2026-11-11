import type { PlayerId } from '@dark-chess/game-core';

/** Browser equivalent of the existing Node hmac-sha256-u32le-v1 schedule. */
export async function deriveBrowserDecisionSeed(
  agentSeed: number,
  playerId: PlayerId,
  plyCount: number,
): Promise<number> {
  if (
    !Number.isInteger(agentSeed) ||
    agentSeed < 0 ||
    agentSeed > 0xffffffff ||
    (playerId !== 'P1' && playerId !== 'P2') ||
    !Number.isSafeInteger(plyCount) ||
    plyCount < 0
  )
    throw new RangeError('Invalid decision seed inputs.');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(agentSeed)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(JSON.stringify(['dark-chess-agent-decision-v1', playerId, plyCount])),
  );
  return new DataView(digest).getUint32(0, true);
}
