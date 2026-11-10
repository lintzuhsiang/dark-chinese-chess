import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CORE_REVISION = 'b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75';

// This source runner requires the checkout, not an installed or bundled Core.
export function assertCoreBaseline(): void {
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  try {
    execFileSync(
      'git',
      ['diff', '--quiet', CORE_REVISION, '--', 'packages/game-core', 'docs/game-rules.md'],
      { cwd, stdio: 'pipe' },
    );
    const changes = execFileSync(
      'git',
      [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        'packages/game-core',
        'docs/game-rules.md',
      ],
      { cwd, stdio: 'pipe', encoding: 'utf8' },
    );
    if (changes.trim() !== '') throw new Error('Core/rules have uncommitted or untracked changes.');
  } catch (cause) {
    throw new Error('Game Core/rules do not match the pinned AI-1 baseline.', { cause });
  }
}
