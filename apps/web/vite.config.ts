import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { CORE_REVISION } from '../../scripts/ai-eval/baseline';

// Capture the actual served Core sources, including uncommitted changes.
// Never bundle the Node-based evaluation runner into the inspector.
export default defineConfig(({ command }) => {
  const root = new URL('../../', import.meta.url);
  const paths = [
    ...readdirSync(new URL('packages/game-core/src/', root))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `packages/game-core/src/${name}`),
    'docs/game-rules.md',
  ];
  return {
    plugins:
      command === 'serve'
        ? [
            {
              name: 'replay-core-identity',
              configureServer(server) {
                server.watcher.add(paths.map((path) => fileURLToPath(new URL(path, root))));
              },
              async handleHotUpdate({ file, server }) {
                if (
                  file.startsWith(fileURLToPath(new URL('packages/game-core/', root))) ||
                  file === fileURLToPath(new URL('docs/game-rules.md', root))
                ) {
                  await server.restart();
                  return [];
                }
              },
            },
          ]
        : [],
    define:
      command === 'serve'
        ? {
            __REPLAY_CORE__: JSON.stringify({
              revision: CORE_REVISION,
              files: Object.fromEntries(
                paths.map((path) => [
                  path,
                  createHash('sha256')
                    .update(readFileSync(fileURLToPath(new URL(path, root))))
                    .digest('hex'),
                ]),
              ),
            }),
          }
        : {},
  };
});
