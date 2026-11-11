import { expect, it } from 'vitest';
import { deriveBrowserDecisionSeed } from '../../../apps/web/src/ai/decision-seed';
import { deriveDecisionSeed } from '../seeds';

it('browser WebCrypto matches the approved Node HMAC schedule for both seats and boundary roots/plies', async () => {
  for (const root of [0, 7, 0xffffffff]) {
    for (const player of ['P1', 'P2'] as const) {
      for (const ply of [0, 17, 4095]) {
        expect(await deriveBrowserDecisionSeed(root, player, ply)).toBe(
          deriveDecisionSeed(root, player, ply),
        );
      }
    }
  }
  await expect(deriveBrowserDecisionSeed(-1, 'P1', 0)).rejects.toThrow(RangeError);
});
