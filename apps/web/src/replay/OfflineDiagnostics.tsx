import { useState } from 'react';
import type { ReplayView } from './model';
import { record } from './model';

export function parseOfflineDiagnostics(text: string): Record<string, unknown> {
  const data = record(JSON.parse(text));
  if (
    !data ||
    data.schema !== 'ai-search-diagnostics-v1' ||
    data.mode !== 'diagnostic-only' ||
    typeof data.reportSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(data.reportSha256) ||
    !Array.isArray(data.traces) ||
    data.traces.length > 24
  )
    throw new Error('Unsupported or unbounded diagnostics file.');
  for (const trace of data.traces) {
    const row = record(trace);
    if (
      !row ||
      !Number.isSafeInteger(row.actionPly) ||
      !Array.isArray(row.roots) ||
      row.roots.length > 256
    )
      throw new Error('Invalid diagnostic decision.');
  }
  return data;
}
export function OfflineDiagnostics({
  view,
  reportHash,
}: {
  readonly view: ReplayView;
  readonly reportHash: string;
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const traces = (data?.traces ?? []) as Record<string, unknown>[];
  // Display diagnostics only after the corresponding historical action is reached.
  const trace =
    data?.reportSha256 === reportHash
      ? traces.find(
          (t) =>
            t.seed === view.match.seed && t.leg === view.match.leg && t.actionPly === view.cursor,
        )
      : null;
  return (
    <section aria-label="Offline search diagnostics">
      <h2>Offline search diagnostics</h2>
      <p>
        Diagnostic-only rerun, separate from historical recorded metrics. No AI runs in this
        browser. Hypothetical chance outcomes are public-inventory possibilities.
      </p>
      <label>
        Load offline trace JSON (up to 8 MiB)
        <input
          aria-label="Offline trace JSON"
          type="file"
          accept=".json,application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setData(null);
            setError('');
            try {
              if (file.size > 8 * 1024 * 1024) throw new Error('Trace exceeds 8 MiB.');
              setData(parseOfflineDiagnostics(await file.text()));
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Invalid trace.');
            }
            event.target.value = '';
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {data && data.reportSha256 !== reportHash && (
        <p role="alert">Trace report fingerprint does not match the imported tournament.</p>
      )}
      {trace ? (
        <>
          <p>
            Historical action {view.cursor}; diagnostic rerun. Source stable:{' '}
            {String(data?.sourceStableDuringRun)}. Historical action agreement:{' '}
            {String(trace.agreesWithRecorded)}.
          </p>
          <p>Evaluation source: {String(trace.evaluationSource)}</p>
          <details>
            <summary>Full root rankings, admitted/excluded candidates and completed scores</summary>
            <pre style={{ overflowX: 'auto', maxHeight: 500 }}>
              {JSON.stringify(trace.roots, null, 2)}
            </pre>
          </details>
          <details>
            <summary>
              Search budget, first interior replies, chance branches and sampled leaf breakdowns
            </summary>
            <pre style={{ overflowX: 'auto', maxHeight: 500 }}>
              {JSON.stringify(
                {
                  diagnostics: trace.diagnostics,
                  firstInterior: trace.firstInterior,
                  chanceBranches: trace.chanceBranches,
                  rootBranches: trace.rootBranches,
                  leafSamples: trace.leafSamples,
                  missing: trace.missing,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <details>
            <summary>Source provenance and divergence audit</summary>
            <pre style={{ overflowX: 'auto', maxHeight: 500 }}>
              {JSON.stringify(
                {
                  recordedGit: data?.recordedGit,
                  sourceAudit: data?.sourceAudit,
                  earliestDivergence: data?.earliestDivergence,
                  auditMethod: data?.auditMethod,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </>
      ) : (
        <p>Offline diagnostics for this reached action: Not recorded.</p>
      )}
    </section>
  );
}
