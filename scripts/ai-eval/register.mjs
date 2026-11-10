import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { URL } from 'node:url';

// Resolve only this source workspace's TypeScript imports; Node strips the types.
const root = new URL('../../', import.meta.url);
const aliases = new Map([
  ['@dark-chess/game-core', new URL('packages/game-core/src/index.ts', root).href],
  ['@dark-chess/ai-agents', new URL('packages/ai-agents/src/index.ts', root).href],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const alias = aliases.get(specifier);
    if (alias) return nextResolve(alias, context);
    if (specifier.startsWith('.') && extname(specifier) === '') {
      try {
        return nextResolve(specifier + '.ts', context);
      } catch (error) {
        if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
      }
    }
    return nextResolve(specifier, context);
  },
});
