// Future adapters can provide recorded, per-ply diagnostics here. Ordinary replay
// never calls a policy or estimates a score from its chosen action.
export interface RecordedDiagnostics {
  readonly evScores?: string;
  readonly candidateRankings?: string;
  readonly searchTrace?: string;
}
export function DecisionDiagnostics({
  durationMs,
  recorded,
}: {
  readonly durationMs: number | null;
  readonly recorded?: RecordedDiagnostics;
}) {
  return (
    <section aria-label="Decision diagnostics">
      <h2>Decision diagnostics</h2>
      <p>
        Accepted decision time:{' '}
        {durationMs === null ? 'Not recorded.' : `${durationMs.toFixed(2)} ms`}
      </p>
      <p>EV scores: {recorded?.evScores ?? 'Not recorded.'}</p>
      <p>Candidate rankings: {recorded?.candidateRankings ?? 'Not recorded.'}</p>
      <p>Search trace: {recorded?.searchTrace ?? 'Not recorded.'}</p>
    </section>
  );
}
