// Measurement-only source loader; never changes Git/worktrees/Core pin.
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { basename } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
const revision = 'b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const engine = process.env.CHASE_PROFILE_ENGINE ?? 'old';
if (engine !== 'old' && engine !== 'full') throw Error('Use old or full measurement engine.');
const root = new URL('../benchmark-results/chase-v3-frozen-workspace/', import.meta.url);
const core = new URL('packages/game-core/src/', root),
  agents = new URL('packages/ai-agents/src/', root);
for (const dir of [core, agents]) mkdirSync(dir, { recursive: true });
writeFileSync(new URL('package.json', root), JSON.stringify({ type: 'module' }));
const coreFiles = readdirSync(new URL('../packages/game-core/src/', import.meta.url)).filter((f) =>
  f.endsWith('.ts'),
);
for (const f of coreFiles)
  writeFileSync(
    new URL(f, core),
    engine === 'old'
      ? execFileSync('git', ['show', `${revision}:packages/game-core/src/${f}`], { cwd })
      : readFileSync(new URL('../packages/game-core/src/' + f, import.meta.url)),
  );
// AI-6A's archived dirty manifest contains the original untracked search source.
const historical = JSON.parse(
  readFileSync(new URL('../benchmark-results/ai6a-heldout.json', import.meta.url), 'utf8'),
).manifest;
for (const file of historical.source.files.filter((f) =>
  f.path.startsWith('packages/ai-agents/src/'),
)) {
  let data = readFileSync(new URL('../' + file.path, import.meta.url));
  const hash = (b) => createHash('sha256').update(b).digest('hex');
  if (hash(data) !== file.sha256) {
    const archive = historical.source.untrackedFiles.find((f) => f.path === file.path);
    data = archive
      ? Buffer.from(archive.contentBase64, 'base64')
      : execFileSync('git', ['show', `${historical.git.head}:${file.path}`], { cwd });
  }
  if (hash(data) !== file.sha256) throw Error('Historical Agent source mismatch: ' + file.path);
  writeFileSync(new URL(basename(file.path), agents), data);
}
process.env.CHASE_PROFILE_CORE_DIR = fileURLToPath(core);
process.env.CHASE_PROFILE_AGENT_DIR = fileURLToPath(agents);
const currentCore = new URL('../packages/game-core/src/', import.meta.url),
  currentAgents = new URL('../packages/ai-agents/src/', import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const r = nextResolve(specifier, context);
    for (const [current, frozen] of [
      [currentCore, core],
      [currentAgents, agents],
    ])
      if (r.url.startsWith(current.href))
        return { ...r, url: new URL(r.url.slice(current.href.length), frozen).href };
    return r;
  },
});
