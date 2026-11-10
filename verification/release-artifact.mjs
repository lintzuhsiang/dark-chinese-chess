import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '../apps/web/dist');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
assert.match(html, /lang="zh-Hant"/, 'Release must retain Traditional Chinese metadata.');
assert.doesNotMatch(html, /\/src\/|localhost|127\.0\.0\.1/, 'Release must reference built assets.');
const references = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(
  (match) => match[1],
);
assert(
  references.some((path) => path.endsWith('.js')),
  'Missing built JavaScript entry.',
);
assert(
  references.some((path) => path.endsWith('.css')),
  'Missing built stylesheet.',
);
const files = await readdir(root, { recursive: true, withFileTypes: true });
const manifest = [];
for (const file of files) {
  assert(!file.isSymbolicLink(), 'Release assets must not be symlinks.');
  if (!file.isFile()) continue;
  const path = resolve(file.parentPath, file.name);
  const name = relative(root, path).replaceAll('\\', '/');
  assert(
    !/\.(?:map|ts|tsx)$|(?:^|\/)(?:node_modules|tests?|verification|\.git)(?:\/|$)/.test(name),
    `Unexpected release file: ${name}`,
  );
  const content = await readFile(path);
  if (/\.(?:js|html)$/.test(name)) {
    assert.doesNotMatch(
      content.toString(),
      /runPhoneVerification|phoneVerificationReport|phoneVerificationStage|fixtureDeck|shuffleSamples|verificationSample/,
      `Test tooling leaked into ${name}`,
    );
  }
  manifest.push({
    path: name,
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  });
}
for (const reference of references) {
  assert(
    manifest.some((file) => `/${file.path}` === reference),
    `Missing referenced asset: ${reference}`,
  );
}
console.log(
  JSON.stringify(
    {
      output: 'apps/web/dist',
      files: manifest.sort((a, b) => a.path.localeCompare(b.path)),
      publicationAuthorized: false,
    },
    null,
    2,
  ),
);
