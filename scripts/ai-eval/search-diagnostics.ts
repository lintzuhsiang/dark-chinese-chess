import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  applyAction,
  createInitialState,
  type GameAction,
} from '../../packages/game-core/src/index';
import {
  searchPublicPosition,
  type TacticalDecision,
} from '../../packages/ai-agents/src/tactical-search';
import {
  evaluateProgressPosition,
  countPublicPositionReturns,
} from '../../packages/ai-agents/src/progress-agent';
import {
  evaluateStrategicPosition,
  STRATEGIC_PRESETS,
} from '../../packages/ai-agents/src/strategic-agent';
import type { AgentInput } from '../../packages/ai-agents/src/types';
import { createAgentInput } from './agent-input';
import { tacticalDescriptor } from './tactical-descriptor';
import { progressDescriptor, strategicDescriptor } from './feature-descriptor';
import { deriveDecisionSeed, DECISION_SEED_ALGORITHM } from './seeds';
import { assertCoreBaseline, CORE_REVISION } from './baseline';
import { verifyReplay } from './match';
import type { EvaluatedAgent, TournamentReport, TournamentMatch } from './tournament-types';

const key = (action: GameAction) => JSON.stringify(action);
export const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export function resolveDiagnosticAgent(agent: Omit<EvaluatedAgent, 'policy'>) {
  const known = [
    tacticalDescriptor(agent.id),
    progressDescriptor(agent.id),
    ...(['proximity', 'blockers', 'cannon'] as const).map((f) => strategicDescriptor(agent.id, f)),
  ];
  const matched = known.find(
    (a) =>
      a.implementation === agent.implementation &&
      isDeepStrictEqual(a.configuration, agent.configuration),
  );
  if (!matched)
    throw new Error(
      'Unsupported agent implementation/configuration; refusing a default approximation.',
    );
  return matched;
}
export function diagnoseDecision(
  input: AgentInput,
  seed: number,
  agent: Omit<EvaluatedAgent, 'policy'>,
) {
  resolveDiagnosticAgent(agent);
  const feature = (['proximity', 'blockers', 'cannon'] as const).find(
    (f) => agent.implementation === `strategic-6c-${f}-v1`,
  );
  const leafSamples: unknown[] = [];
  const decision = searchPublicPosition(input, { seed }, {}, {}, (position, base) => {
    // Same evaluator and already-computed base; collecting samples performs no projections.
    const breakdown = feature
      ? evaluateStrategicPosition(position, STRATEGIC_PRESETS[feature], base)
      : agent.implementation === 'progress-6b-v1'
        ? evaluateProgressPosition(position, base)
        : { base, total: base!.total };
    if (leafSamples.length < 16)
      leafSamples.push({
        relativePly: position.publicHistory.length - input.publicHistory.length,
        publicSuffix: position.publicHistory.slice(input.publicHistory.length),
        breakdown,
      });
    return breakdown.total;
  });
  return { decision, leafSamples };
}
const priority = (tags: readonly string[]) => {
  const i = ['WIN', 'RECAPTURE', 'DEFENSE', 'CAPTURE', 'THREAT'].findIndex((t) => tags.includes(t));
  return i < 0 ? 5 : i;
};
export function candidateTable(decision: TacticalDecision) {
  const roots = decision.rootActions;
  const byEv = roots
    .map((r, ordinal) => ({ ...r, ordinal }))
    .sort((a, b) => b.baselineScore - a.baselineScore || a.ordinal - b.ordinal);
  const ordered = [...byEv].sort(
    (a, b) =>
      priority(a.tactics) - priority(b.tactics) ||
      b.baselineScore - a.baselineScore ||
      a.ordinal - b.ordinal,
  );
  const bestFlip = byEv.find((r) => r.action.type === 'FLIP');
  return ordered.map((r, index) => ({
    ...r,
    rank: index + 1,
    orderingTier: ['WIN', 'RECAPTURE', 'DEFENSE', 'CAPTURE', 'THREAT', 'EV'][priority(r.tactics)],
    orderingScore: r.baselineScore,
    originalEV: r.baselineScore,
    reserves: [
      r.tactics.includes('TERMINAL') ? 'terminal' : null,
      key(r.action) === key(byEv[0]!.action) ? 'best EV' : null,
      decision.diagnostics.limits.rootWidth > 1 &&
      bestFlip &&
      key(r.action) === key(bestFlip.action)
        ? 'best FLIP EV'
        : null,
    ].filter(Boolean),
    exclusion: r.retained
      ? null
      : 'Root width limit after reserves and tactical/EV ranking; not searched.',
    completedSearchScores: decision.iterations.map((i) => ({
      depth: i.depth,
      score: i.scores.find((s) => key(s.action) === key(r.action))?.score ?? null,
    })),
    baselineEvaluation: decision.baseline.actionEvaluations.find(
      (e) => key(e.action) === key(r.action),
    ),
  }));
}
function sourceAudit(report: TournamentReport) {
  return Object.fromEntries(
    (['A', 'B'] as const).map((seat) => {
      const agent = report.manifest.agents[seat];
      const files = agent.sourcePaths.map((path) => {
        const recorded = report.manifest.source.files.find((f) => f.path === path)?.sha256 ?? null;
        const current = existsSync(path) ? hash(readFileSync(path)) : null;
        let archivedHead: string | null = null;
        try {
          archivedHead = hash(
            execFileSync('git', ['show', `${report.manifest.git.head}:${path}`], {
              maxBuffer: 4 * 1024 * 1024,
              stdio: ['ignore', 'pipe', 'ignore'],
            }),
          );
        } catch {
          /* Missing archived object is explicit below. */
        }
        const untracked = report.manifest.source.untrackedFiles.find((f) => f.path === path);
        return {
          path,
          recorded,
          current,
          currentMatches: recorded !== null && current === recorded,
          archivedHeadMatches: recorded !== null && archivedHead === recorded,
          archivedUntrackedMatches:
            !!untracked && hash(Buffer.from(untracked.contentBase64, 'base64')) === recorded,
        };
      });
      return [
        seat,
        {
          recordedAgentDigest: agent.sourceDigest,
          files,
          currentDeclaredSourcesMatch: files.every((f) => f.currentMatches),
          archivedDeclaredSourcesReconstructable: files.every(
            (f) => f.archivedHeadMatches || f.archivedUntrackedMatches,
          ),
          trackedPatchPresent: report.manifest.source.trackedPatch.length > 0,
          exactExecutedSourceEstablished:
            report.manifest.sourceStableDuringRun && files.every((f) => f.currentMatches),
          limitation:
            'Declared source hash comparison; unstable reports cannot identify a single executed version. No historical exactness is claimed by this rerun.',
        },
      ];
    }),
  );
}
export function inspectMatch(
  report: TournamentReport,
  match: TournamentMatch,
  selectedPlies: readonly number[],
) {
  assertCoreBaseline();
  const transcript = match.report;
  if (
    !transcript ||
    report.manifest.coreRevision !== CORE_REVISION ||
    transcript.metadata.decisionSeedAlgorithm !== DECISION_SEED_ALGORITHM
  )
    throw new Error('Missing transcript or incompatible Core/decision seed algorithm.');
  const verified = verifyReplay(transcript);
  if (!verified.ok) throw new Error(verified.error);
  const initial = createInitialState(transcript.initialDeck);
  if (!initial.ok) throw new Error('Invalid deck.');
  let state = initial.state;
  let earliestDivergence: { actionPly: number; recorded: GameAction; rerun: GameAction } | null =
    null;
  const traces = [];
  const last = Math.min(Math.max(...selectedPlies), transcript.actions.length);
  for (let i = 0; i < last; i++) {
    const entry = transcript.actions[i]!;
    const actor = report.configuration.agents[match.seats[entry.playerId]];
    const input = createAgentInput(state, transcript.publicHistory.slice(0, i), entry.playerId);
    const seed = deriveDecisionSeed(transcript.metadata.agentSeed, entry.playerId, i);
    const selected = selectedPlies.includes(i + 1);
    if (!earliestDivergence || selected) {
      const { decision, leafSamples } = diagnoseDecision(input, seed, actor);
      if (!earliestDivergence && key(entry.action) !== key(decision.selectedAction))
        earliestDivergence = {
          actionPly: i + 1,
          recorded: entry.action,
          rerun: decision.selectedAction,
        };
      if (selected) {
        const root = decision.nodes.find((n) => n.ply === 0)!;
        const chosen = root.actions.find((a) => key(a.action) === key(decision.selectedAction));
        const firstChild = chosen?.branches[0];
        const reply = decision.nodes.find((n) => n.nodeId === firstChild?.nodeId);
        const moved = applyAction(state, entry.playerId, entry.action);
        if (!moved.ok) throw new Error(`Invalid action at ply ${i + 1}`);
        const after =
          moved.state.status === 'ACTIVE'
            ? createAgentInput(
                moved.state,
                transcript.publicHistory.slice(0, i + 1),
                moved.state.currentPlayer,
              )
            : null;
        traces.push({
          seed: match.deckSeed,
          leg: match.leg,
          positionPly: i,
          actionPly: i + 1,
          player: entry.playerId,
          agent: actor,
          decisionSeed: seed,
          input,
          recordedAction: entry.action,
          diagnosticAction: decision.selectedAction,
          agreesWithRecorded: key(entry.action) === key(decision.selectedAction),
          position: {
            material: decision.baseline.currentEvaluation.material,
            hidden: input.observation.board.filter((s) => s.kind === 'HIDDEN').length,
            quiet: state.noProgressCount,
            legalActions: input.legalActions.length,
            previousReturns: countPublicPositionReturns(input),
            returnsAfterRecordedMove: after ? countPublicPositionReturns(after) : null,
          },
          roots: candidateTable(decision),
          diagnostics: decision.diagnostics,
          iterations: decision.iterations,
          evaluationSource:
            decision.diagnostics.fallback === 'EV'
              ? 'Unchanged baseline EV; no depth >=2 iteration completed.'
              : `Completed selective depth ${decision.diagnostics.completedDepth}; any incomplete next iteration discarded.`,
          fallbackAction: decision.diagnostics.fallback ? decision.baseline.selectedAction : null,
          principalVariation: 'Not recorded.',
          firstInterior: reply
            ? {
                ...reply,
                interpretation:
                  'First generated chance outcome if FLIP, otherwise deterministic child, of diagnostic selected root. Not a proven principal variation.',
                orderedReplies: [...reply.actions].sort(
                  (a, b) =>
                    priority(a.tactics) - priority(b.tactics) || a.onePlyScore - b.onePlyScore,
                ),
                excluded: reply.actions
                  .filter((a) => !a.retained)
                  .map((a) => ({
                    action: a.action,
                    reason:
                      'Interior width limit after terminal/best-EV reserves and tactical/EV ranking.',
                  })),
              }
            : null,
          chanceBranches: chosen?.branches ?? [],
          rootBranches: root.actions,
          leafSamples,
          missing: {
            perNodeBackedUpValues: 'Not recorded.',
            partialIterationScores: 'Not recorded.',
            fullPrincipalVariation: 'Not recorded.',
          },
          scoreSemantics:
            'All scores use acting root player perspective. Active weighted features normalized to [-1,1]; terminal win +2, loss -2, draw 0. Root ordering/baseline EV uses base evaluation even for 6B/C. Interior ordering uses base one-ply expectation. Leaf samples include generated nodes, not necessarily visited depth-cutoff leaves.',
          counterfactual:
            'Not run. Excluded candidates have baseline EV only; null search score is not a loss.',
        });
      }
    }
    const next = applyAction(state, entry.playerId, entry.action);
    if (!next.ok) throw new Error(`Core rejected ply ${i + 1}: ${next.error.code}`);
    state = next.state;
  }
  return {
    seed: match.deckSeed,
    leg: match.leg,
    auditedThroughActionPly: last,
    earliestDivergence,
    auditMethod:
      'Teacher-forced recorded public prefixes from opening until first differing action; selected later decisions also rerun. This is not a self-play rerun after divergence.',
    traces,
  };
}

function main() {
  const [source, output, seedText, legText, pliesText] = process.argv.slice(2);
  if (!source || !output || !seedText || !legText || !pliesText)
    throw new Error(
      'Usage: search-diagnostics.ts REPORT OUTPUT SEED LEG ACTION_PLIES(comma-separated,1-based)',
    );
  if (resolve(source) === resolve(output) || existsSync(output))
    throw new Error('Refusing to overwrite a source or existing artifact.');
  const plies = pliesText.split(',').map(Number);
  if (!plies.length || plies.length > 24 || plies.some((p) => !Number.isSafeInteger(p) || p < 1))
    throw new Error('Select 1–24 positive action plies.');
  const raw = readFileSync(source);
  const report = JSON.parse(raw.toString()) as TournamentReport;
  if (report.schemaVersion !== 1 || report.manifest.runner.implementation !== 'ai-eval-v2')
    throw new Error('Unsupported tournament.');
  const match = report.matches.find(
    (m) => m.deckSeed === Number(seedText) && m.leg === Number(legText),
  );
  if (!match || plies.some((p) => p > match.gameLength)) throw new Error('Incident/ply not found.');
  const artifact = {
    schema: 'ai-search-diagnostics-v1',
    mode: 'diagnostic-only',
    source: resolve(source),
    reportSha256: hash(raw),
    coreRevision: CORE_REVISION,
    sourceStableDuringRun: report.manifest.sourceStableDuringRun,
    recordedGit: report.manifest.git,
    recordedSourceDigest: report.manifest.source.digest,
    sourceAudit: sourceAudit(report),
    ...inspectMatch(report, match, plies),
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify({
      output,
      traces: artifact.traces.length,
      earliestDivergence: artifact.earliestDivergence,
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
