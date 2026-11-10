import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { randomAgent } from '../../packages/ai-agents/src/index';
import { formatTournamentSummary, runTournament } from './tournament';
import type { EvaluatedAgent } from './tournament-types';

function uint32(value: string, label: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number > 0xffffffff) {
    throw new RangeError(label + ' must be a decimal unsigned 32-bit integer.');
  }
  return number;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      pairs: { type: 'string' },
      'deck-start': { type: 'string', default: '0' },
      'deck-seeds': { type: 'string' },
      'agent-seed': { type: 'string', default: '20261110' },
      'max-plies': { type: 'string', default: '4096' },
      confidence: { type: 'string', default: '0.95' },
      output: { type: 'string', default: 'benchmark-results/random-baseline.json' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Usage: node --import ./scripts/ai-eval/register.mjs ./scripts/ai-eval/cli.ts');
    console.log('  --pairs 20 --deck-start 0 --agent-seed 20261110 --max-plies 4096');
    console.log('  --confidence 0.95 --output benchmark-results/random-baseline.json');
    console.log('  --deck-seeds 10,20,30 may replace --pairs/--deck-start.');
    return;
  }
  let deckSeeds: number[];
  if (values['deck-seeds'] !== undefined) {
    if (values.pairs !== undefined) throw new Error('Use either --pairs or --deck-seeds.');
    deckSeeds = values['deck-seeds'].split(',').map((seed) => uint32(seed, 'Deck seed'));
  } else {
    const count = uint32(values.pairs ?? '20', 'Pair count');
    const start = uint32(values['deck-start'], 'Deck start');
    if (count === 0 || start + count - 1 > 0xffffffff)
      throw new RangeError('Invalid deck seed range.');
    deckSeeds = Array.from({ length: count }, (_, index) => start + index);
  }
  const descriptor = (id: string): EvaluatedAgent => ({
    id,
    implementation: 'random-agent-v1',
    configuration: {},
    sourcePaths: [
      'packages/ai-agents/src/random-agent.ts',
      'packages/ai-agents/src/seeded-random.ts',
    ],
    policy: randomAgent,
  });
  const report = await runTournament({
    agents: { A: descriptor('random-A'), B: descriptor('random-B') },
    deckSeeds,
    agentSeed: uint32(values['agent-seed'], 'Agent seed'),
    maxPlies: uint32(values['max-plies'], 'Move limit'),
    confidenceLevel: Number(values.confidence),
  });
  const output = resolve(values.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(formatTournamentSummary(report));
  console.log('JSON report: ' + output);
  if (
    report.summary.completedGames !== report.summary.attemptedGames ||
    !report.manifest.sourceStableDuringRun
  )
    process.exitCode = 2;
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
