import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TournamentReport } from '../tournament-types';

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('standalone Node benchmark command', () => {
  it('writes valid JSON for every truncated leg and returns a nonzero completeness status', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dark-chess-ai2-cli-'));
    try {
      const output = join(directory, 'report.json');
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          './scripts/ai-eval/register.mjs',
          './scripts/ai-eval/cli.ts',
          '--pairs',
          '1',
          '--max-plies',
          '0',
          '--output',
          output,
        ],
        { cwd: root, encoding: 'utf8', timeout: 30000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      const report = JSON.parse(readFileSync(output, 'utf8')) as TournamentReport;
      expect(report.summary.attemptedGames).toBe(2);
      expect(report.summary.completedGames).toBe(0);
      expect(report.summary.failures.TRUNCATED).toBe(2);
      expect(report.summary.scores.A).toEqual({ wins: 0, draws: 0, losses: 0, averageScore: null });
      expect(report.summary.paired.samples).toBe(0);
      expect(report.manifest.sourceStableDuringRun).toBe(true);
      expect(result.stdout).toContain('Games: 0/2 completed');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an invalid experiment without running a match', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', './scripts/ai-eval/register.mjs', './scripts/ai-eval/cli.ts', '--pairs', '0'],
      { cwd: root, encoding: 'utf8', timeout: 30000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid deck seed range');
  });
});
