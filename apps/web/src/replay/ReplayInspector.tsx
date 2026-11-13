import { useEffect, useRef, useState } from 'react';
import type { Incident, MatchSummary, ReplayView } from './model';
import { MAX_FILE_BYTES, parseIncident } from './model';
import type { ReplayRequest, ReplayResponse } from './protocol';
import { ReplayPosition } from './ReplayPosition';
import './replay.css';
import { OfflineDiagnostics } from './OfflineDiagnostics';

export function ReplayInspector() {
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [matches, setMatches] = useState<readonly MatchSummary[]>([]);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [view, setView] = useState<ReplayView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(500);
  const [reportHash, setReportHash] = useState('');
  const [filename, setFilename] = useState('');
  const [importMs, setImportMs] = useState<number | null>(null);
  const [incident, setIncident] = useState<Incident>({ seed: 0, leg: 0, ply: 0 });
  const [jump, setJump] = useState('0');

  function send(request: ReplayRequest) {
    if (!worker.current) {
      setError('Replay worker is unavailable. Reload the page.');
      return;
    }
    setBusy(true);
    setError('');
    worker.current.postMessage(request);
  }
  function select(index: number, ply = 0) {
    setPlaying(false);
    setView(null);
    send({ id: ++sequence.current, type: 'SELECT', index, ply, core: __REPLAY_CORE__ });
  }
  function seek(ply: number) {
    if (!view || busy) return;
    if (!Number.isSafeInteger(ply) || ply < 0 || ply > view.total) {
      setError(`Ply must be an integer from 0 to ${view.total}.`);
      return;
    }
    setPlaying(false);
    send({ id: ++sequence.current, type: 'SEEK', ply });
  }
  useEffect(() => {
    const instance = new Worker(new URL('./replay.worker.ts', import.meta.url), { type: 'module' });
    worker.current = instance;
    instance.onmessage = ({ data }: MessageEvent<ReplayResponse>) => {
      if (data.id !== sequence.current) return;
      setBusy(false);
      if (data.type === 'ERROR') {
        setError(data.message);
        setPlaying(false);
      } else if (data.type === 'IMPORTED') {
        setReportHash(data.reportSha256);
        setMatches(data.matches);
        setWarnings(data.warnings);
        setImportMs(data.durationMs);
        try {
          const target = parseIncident(window.location.search);
          const match = target
            ? data.matches.find((m) => m.seed === target.seed && m.leg === target.leg)
            : data.matches[0];
          if (!match) throw new Error('Incident seed + leg was not found in this file.');
          select(match.index, target?.ply ?? 0);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Invalid incident.');
        }
      } else {
        setView(data.view);
        const { match, cursor } = data.view;
        setIncident({ seed: match.seed, leg: match.leg, ply: cursor });
        setJump(String(cursor));
        window.history.replaceState(
          null,
          '',
          `/replay?seed=${match.seed}&leg=${match.leg}&ply=${cursor}`,
        );
        if (data.view.error || cursor === data.view.total) setPlaying(false);
      }
    };
    instance.onerror = () => {
      setBusy(false);
      setPlaying(false);
      setError('Replay worker failed. Reload the page and import the file again.');
    };
    return () => {
      instance.terminate();
      worker.current = null;
    };
    // The worker lifetime is the inspector lifetime; requests use sequence IDs.
  }, []);

  useEffect(() => {
    if (!playing || busy || !view || view.error || view.cursor >= view.total) return;
    const timer = window.setTimeout(() => {
      send({ id: ++sequence.current, type: 'SEEK', ply: view.cursor + 1 });
    }, speed);
    return () => window.clearTimeout(timer);
  }, [playing, busy, view, speed]);

  useEffect(() => {
    const navigate = () => {
      if (!matches.length) return;
      try {
        const target = parseIncident(window.location.search);
        if (!target) return;
        const match = matches.find((m) => m.seed === target.seed && m.leg === target.leg);
        if (!match) throw new Error('Incident seed + leg was not found in this file.');
        select(match.index, target.ply);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Invalid incident.');
      }
    };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, [matches]);

  const manualSeek = (ply: number) => seek(ply);
  return (
    <main className="replay-inspector">
      <header>
        <p>Developer tools · AI-6R · local files only</p>
        <h1>Tournament Replay Inspector</h1>
        <a href="/">Return to game</a>
      </header>
      <section aria-label="Import tournament">
        <label>
          Import ai-eval-v2 tournament JSON (up to 128 MiB)
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            aria-label="Tournament JSON"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setPlaying(false);
              setView(null);
              setMatches([]);
              setReportHash('');
              setWarnings([]);
              setImportMs(null);
              setFilename(file.name);
              if (file.size > MAX_FILE_BYTES) {
                setError('File exceeds the 128 MiB import limit.');
                return;
              }
              send({ id: ++sequence.current, type: 'IMPORT', file });
              event.target.value = '';
            }}
          />
        </label>
        <p>
          {filename}
          {importMs !== null
            ? ` · ${matches.length} matches · worker import ${importMs.toFixed(0)} ms`
            : ''}
        </p>
        <p role="status">{busy ? 'Loading / validating replay…' : 'Ready'}</p>
        {warnings.map((warning) => (
          <p className="replay-warning" key={warning}>
            {warning}
          </p>
        ))}
        {error && (
          <p className="replay-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {matches.length > 0 && (
        <>
          <label>
            Match
            <select
              aria-label="Match"
              disabled={busy}
              value={view?.match.index ?? ''}
              onChange={(e) => select(Number(e.target.value))}
            >
              <option value="" disabled>
                Select match
              </option>
              {matches.map((match) => (
                <option key={match.index} value={match.index}>
                  Seed {match.seed} · leg {match.leg} · P1 {match.agents.P1} / P2 {match.agents.P2}{' '}
                  · {match.length} plies · {match.outcome}
                  {match.available ? '' : ' · transcript unavailable'}
                </option>
              ))}
            </select>
          </label>
          <form
            className="replay-row"
            onSubmit={(e) => {
              e.preventDefault();
              const match = matches.find((m) => m.seed === incident.seed && m.leg === incident.leg);
              if (!match) {
                setError('Seed + leg was not found in this file.');
                return;
              }
              select(match.index, incident.ply);
            }}
          >
            <label>
              Deck seed
              <input
                aria-label="Deck seed"
                type="number"
                min="0"
                required
                value={incident.seed}
                onChange={(e) => setIncident({ ...incident, seed: e.target.valueAsNumber })}
              />
            </label>
            <label>
              Leg
              <select
                aria-label="Leg"
                value={incident.leg}
                onChange={(e) => setIncident({ ...incident, leg: Number(e.target.value) })}
              >
                <option value="0">0</option>
                <option value="1">1</option>
              </select>
            </label>
            <label>
              Ply
              <input
                aria-label="Incident ply"
                type="number"
                min="0"
                required
                value={incident.ply}
                onChange={(e) => setIncident({ ...incident, ply: e.target.valueAsNumber })}
              />
            </label>
            <button disabled={busy}>Go to incident</button>
          </form>
        </>
      )}
      {view && (
        <>
          <p>
            Recorded match: {view.match.outcome} · P1 {view.match.agents.P1} / P2{' '}
            {view.match.agents.P2}
          </p>
          <fieldset disabled={busy || !view.observation} className="replay-controls">
            <legend>Playback</legend>
            <div className="replay-row">
              <button disabled={view.cursor === 0} onClick={() => manualSeek(0)}>
                Start
              </button>
              <button disabled={view.cursor === 0} onClick={() => manualSeek(view.cursor - 1)}>
                Previous
              </button>
              <button
                disabled={!!view.error || view.cursor === view.total}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                disabled={view.cursor >= view.validPlies}
                onClick={() => manualSeek(view.cursor + 1)}
              >
                Next
              </button>
              <button
                disabled={view.cursor === view.validPlies}
                onClick={() => manualSeek(view.validPlies)}
              >
                End
              </button>
              <label>
                Speed
                <select
                  aria-label="Playback speed"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  <option value="2000">0.5×</option>
                  <option value="1000">1×</option>
                  <option value="500">2×</option>
                  <option value="200">5×</option>
                  <option value="100">10×</option>
                </select>
              </label>
            </div>
            <label>
              Ply {view.cursor} / {view.total}
              <input
                aria-label="Ply slider"
                type="range"
                min="0"
                max={view.validPlies}
                value={view.cursor}
                onChange={(e) => manualSeek(Number(e.target.value))}
              />
            </label>
            <form
              className="replay-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!/^\d+$/.test(jump)) setError('Enter an integer ply.');
                else manualSeek(Number(jump));
              }}
            >
              <label>
                Jump to ply
                <input
                  aria-label="Jump to ply"
                  type="number"
                  min="0"
                  max={view.validPlies}
                  required
                  value={jump}
                  onChange={(e) => setJump(e.target.value)}
                />
              </label>
              <button>Jump</button>
            </form>
          </fieldset>
          <ReplayPosition view={view} onSeek={manualSeek} />
          <OfflineDiagnostics view={view} reportHash={reportHash} />
        </>
      )}
    </main>
  );
}
