import { describe, expect, it } from 'vitest';
import { getObservation, getLegalActions } from '../../../packages/game-core/src/index';
import { hiddenTacticalFixture } from '../../../packages/ai-agents/tests/tactical-fixtures';
import { explainTacticalDecision } from '../../../packages/ai-agents/src/tactical-agent';
import { explainProgressDecision } from '../../../packages/ai-agents/src/progress-agent';
import {
  explainStrategicDecision,
  STRATEGIC_PRESETS,
} from '../../../packages/ai-agents/src/strategic-agent';
import { runTournament } from '../tournament';
import { tacticalDescriptor } from '../tactical-descriptor';
import { progressDescriptor, strategicDescriptor } from '../feature-descriptor';
import {
  candidateTable,
  diagnoseDecision,
  resolveDiagnosticAgent,
  inspectMatch,
} from '../search-diagnostics';

describe('offline search diagnostics', () => {
  const f = hiddenTacticalFixture();
  const input = {
    observation: getObservation(f.state),
    publicHistory: f.history,
    legalActions: getLegalActions(f.state, f.state.currentPlayer),
    perspective: f.state.currentPlayer,
  };
  it.each([
    [tacticalDescriptor('a'), () => explainTacticalDecision(input, { seed: 123 })],
    [progressDescriptor('b'), () => explainProgressDecision(input, { seed: 123 })],
    [
      strategicDescriptor('c', 'blockers'),
      () => explainStrategicDecision(input, { seed: 123 }, STRATEGIC_PRESETS.blockers),
    ],
  ] as const)(
    'collects samples without changing %s search scores, budget, order or choice',
    (agent, original) => {
      const before = JSON.stringify(input);
      const traced = diagnoseDecision(input, 123, agent);
      expect(traced.decision).toEqual(original());
      expect(traced.leafSamples.length).toBeLessThanOrEqual(16);
      expect(JSON.stringify(input)).toBe(before);
      const rows = candidateTable(traced.decision);
      expect(rows).toHaveLength(input.legalActions.length);
      expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));
      expect(
        rows
          .filter((r) => !r.retained)
          .every((r) => r.searchScore === null && r.exclusion !== null),
      ).toBe(true);
      expect(JSON.stringify(traced)).not.toContain('"id":');
    },
  );
  it('refuses unsupported settings instead of approximating defaults', () => {
    expect(() => resolveDiagnosticAgent({ ...tacticalDescriptor('a'), configuration: {} })).toThrow(
      'Unsupported',
    );
  });
  it('rejects incompatible Core identities and invalid accepted transcripts', async () => {
    const report = await runTournament({
      agents: { A: tacticalDescriptor('a'), B: progressDescriptor('b') },
      deckSeeds: [11],
      agentSeed: 71,
      maxPlies: 0,
    });
    const match = report.matches[0]!;
    expect(() =>
      inspectMatch(
        { ...report, manifest: { ...report.manifest, coreRevision: 'incompatible' } },
        match,
        [1],
      ),
    ).toThrow('incompatible');
    const bad = {
      ...match,
      report: {
        ...match.report!,
        actions: [{ playerId: 'P1' as const, action: { type: 'FLIP' as const, position: 99 } }],
      },
    };
    expect(() => inspectMatch(report, bad, [1])).toThrow('action 1');
  });
});
