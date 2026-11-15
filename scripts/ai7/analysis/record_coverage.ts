/** Offline archive replay. Labels never enter training or model inputs. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createEnvironment, actionId } from '../environment';
import { classify } from '../symmetry';
import { assertCoreBaseline } from '../../ai-eval/baseline';

assertCoreBaseline();
const campaign = resolve(
  process.argv[3] ?? 'benchmark-results/ai7-selfplay/p1p2-comparison/20261114-v1',
);
const config = JSON.parse(readFileSync(resolve(campaign, 'config.json'), 'utf8')) as {
  architectures: string[];
  seeds: number[];
};
const output = resolve(process.argv[2]!);
if (!output.startsWith(resolve('benchmark-results/ai7-selfplay') + '/'))
  throw new Error('Invalid output');
if (existsSync(resolve(output, 'replay-coverage.json'))) throw new Error('Output exists');
mkdirSync(output, { recursive: true });
const games = [];
const opportunities = [];
for (const treatment of config.architectures) {
  for (const seed of config.seeds) {
    const run = `${treatment}-seed-${seed}`;
    const folder = resolve(campaign, 'runs', run);
    const summaries = readFileSync(resolve(folder, 'training-games.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            archive?: string;
            seed: number;
            seat: number;
            update: number;
            rollout: number;
            return: number;
            opponent: string;
            prefix_plies?: number;
          },
      );
    const saved = summaries.filter((row) => row.archive);
    const cap = Number(process.argv[4] ?? saved.length);
    const selected =
      saved.length > cap
        ? Array.from({ length: cap }, (_, i) => saved[Math.floor((i * saved.length) / cap)]!)
        : saved;
    for (const summary of selected) {
      const archive = JSON.parse(
        readFileSync(resolve(folder, 'training-replays', summary.archive!), 'utf8'),
      ) as ReturnType<ReturnType<typeof createEnvironment>['archive']>;
      const env = createEnvironment(summary.seed, archive.initialDeck);
      let learnerDecisions = 0,
        revealedDecisions = 0,
        smallEndgameDecisions = 0;
      let winOpportunities = 0,
        winChosen = 0,
        defenseOpportunities = 0,
        defenseChosen = 0;
      const rows = [];
      for (const entry of archive.actions) {
        const observation = env.observe();
        const chosen = actionId(entry.action);
        if (observation.player === summary.seat && observation.ply >= (summary.prefix_plies ?? 0)) {
          learnerDecisions++;
          if (!observation.board.includes(1)) {
            revealedDecisions++;
            const pieces = observation.board.filter((v) => v > 1).length;
            if (pieces <= 6) smallEndgameDecisions++;
            const labels = classify(env.archive().finalState);
            const category = labels.wins.length
              ? 'win'
              : labels.safe.length && labels.unsafe.length
                ? 'defense'
                : null;
            if (category) {
              const targets = category === 'win' ? labels.wins : labels.safe;
              const selected = targets.includes(chosen);
              if (category === 'win') {
                winOpportunities++;
                if (selected) winChosen++;
              } else {
                defenseOpportunities++;
                if (selected) defenseChosen++;
              }
              rows.push({
                run,
                game: summary.archive,
                update: summary.update,
                rollout: summary.rollout,
                outcome: summary.return,
                opponent: summary.opponent,
                category,
                ply: observation.ply,
                pieces,
                chosen,
                selected,
                targets,
                observation,
              });
            }
          }
        }
        const actor = env.archive().finalState.currentPlayer;
        if (actor !== entry.playerId) throw new Error('Wrong archive actor');
        env.step(chosen);
      }
      const replay = env.archive();
      if (
        !isDeepStrictEqual(replay.finalState, archive.finalState) ||
        !isDeepStrictEqual(replay.publicHistory, archive.publicHistory)
      )
        throw new Error(`Replay mismatch: ${run}`);
      opportunities.push(...rows);
      games.push({
        run,
        archive: summary.archive,
        seed: summary.seed,
        seat: summary.seat,
        update: summary.update,
        outcome: summary.return,
        opponent: summary.opponent,
        learnerDecisions,
        revealedDecisions,
        smallEndgameDecisions,
        winOpportunities,
        winChosen,
        defenseOpportunities,
        defenseChosen,
        replayVerified: true,
      });
    }
    process.stderr.write(run + '\n');
  }
}
writeFileSync(resolve(output, 'replay-coverage.json'), JSON.stringify({ games, opportunities }));
process.stdout.write(
  JSON.stringify({ games: games.length, opportunities: opportunities.length }) + '\n',
);
