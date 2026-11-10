import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
function probe(label, tool, args, input, expected) {
  const result = spawnSync(process.execPath, [new URL(tool, root).pathname, ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
  });
  assert.equal(result.status, expected, `${label}: ${result.stdout}\n${result.stderr}`);
  console.log(`${label}: expected exit ${expected}`);
  return result;
}
probe(
  'ESLint valid TypeScript',
  'node_modules/eslint/bin/eslint.js',
  ['--stdin', '--stdin-filename', 'verification/probe.ts'],
  'export const value: number = 1;\n',
  0,
);
probe(
  'ESLint rejects unreachable code',
  'node_modules/eslint/bin/eslint.js',
  ['--stdin', '--stdin-filename', 'verification/probe.ts'],
  'export function value() { return 1; return 2; }\n',
  1,
);
probe(
  'ESLint rejects explicit any',
  'node_modules/eslint/bin/eslint.js',
  ['--stdin', '--stdin-filename', 'verification/probe.ts'],
  'export const value: any = 1;\n',
  1,
);
probe(
  'Prettier valid input',
  'node_modules/prettier/bin/prettier.cjs',
  ['--check', '--stdin-filepath', 'verification/probe.ts'],
  'const value = { answer: 42 };\n',
  0,
);
probe(
  'Prettier rejects unformatted input',
  'node_modules/prettier/bin/prettier.cjs',
  ['--check', '--stdin-filepath', 'verification/probe.ts'],
  'const value={answer:42};\n',
  1,
);
const temporary = mkdtempSync(join(tmpdir(), 'dark-chess-gate-'));
try {
  const types = join(temporary, 'probe.ts');
  writeFileSync(types, 'export const value: string = 42;\n');
  const config = join(temporary, 'tsconfig.json');
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
        target: 'ES2022',
      },
      files: [types],
    }),
  );
  const rejectedType = probe(
    'Typecheck rejects wrong type',
    'node_modules/typescript/bin/tsc',
    ['--project', config],
    '',
    1,
  );
  assert.match(
    rejectedType.stdout + rejectedType.stderr,
    /TS2322/,
    'Expected the deliberate type mismatch diagnostic.',
  );
  writeFileSync(types, "export const value: string = '42';\n");
  probe(
    'Typecheck accepts fixed type',
    'node_modules/typescript/bin/tsc',
    ['--project', config],
    '',
    0,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const testPath = new URL('../apps/web/tests/release-gate-probe.test.ts', import.meta.url);
writeFileSync(
  testPath,
  "import { it, expect } from 'vitest'; it('isolated gate probe', () => expect(1).toBe(2));\n",
  { flag: 'wx' },
);
try {
  probe(
    'Vitest rejects a failing assertion',
    'node_modules/vitest/vitest.mjs',
    ['run', testPath.pathname],
    '',
    1,
  );
  writeFileSync(
    testPath,
    "import { it, expect } from 'vitest'; it('isolated gate probe', () => expect(1).toBe(1));\n",
  );
  probe(
    'Vitest accepts the corrected probe',
    'node_modules/vitest/vitest.mjs',
    ['run', testPath.pathname],
    '',
    0,
  );
} finally {
  rmSync(testPath);
}
