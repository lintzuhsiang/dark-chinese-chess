/** Independent random-play prefixes. No tactical labels or evaluation-bank reuse. */
import { writeFileSync, existsSync } from 'node:fs';
import { createEnvironment, actionId } from './environment';
import { assertCoreBaseline } from '../ai-eval/baseline';
assertCoreBaseline();
const output = process.argv[2]!;
if (existsSync(output)) throw new Error('Pool exists');
const pool = [];
for (let seed = 14000000; pool.length < 1024 && seed < 14020000; seed++) {
  const env = createEnvironment(seed);
  let rng = (seed ^ 0x7123) >>> 0;
  while (!env.summary().result) {
    const o = env.observe();
    if (!o.board.includes(1) && o.board.filter((v) => v > 1).length <= 6) {
      pool.push({ seed, prefix: env.archive().actions.map((e) => actionId(e.action)) });
      break;
    }
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    env.step(o.legal[rng % o.legal.length]!);
  }
}
if (pool.length !== 1024) throw new Error('Insufficient pool');
writeFileSync(output, JSON.stringify(pool));
console.log(JSON.stringify({ positions: pool.length, firstSeed: 14000000 }));
