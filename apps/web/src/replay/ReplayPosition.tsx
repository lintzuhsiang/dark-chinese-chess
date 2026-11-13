import { useEffect, useRef, useState } from 'react';
import type { ActionEvent } from '@dark-chess/game-core';
import { Board } from '../components/Board';
import { HistoryEventDetails } from '../components/History';
import { pieceLabel } from '../components/labels';
import type { ReplayView } from './model';
import { outcomeLabel } from './model';
import { DecisionDiagnostics } from './DecisionDiagnostics';

export function ReplayMoveList({
  events,
  cursor,
  total,
  onSeek,
}: {
  readonly events: readonly ActionEvent[];
  readonly cursor: number;
  readonly total: number;
  readonly onSeek: (ply: number) => void;
}) {
  const [page, setPage] = useState(Math.floor(cursor / 80));
  const selected = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    setPage(Math.floor(cursor / 80));
  }, [cursor]);
  useEffect(() => {
    const container = list.current;
    const row = selected.current;
    if (!container || !row) return;
    const bounds = container.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (item.top < bounds.top) container.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) container.scrollTop += item.bottom - bounds.bottom;
  }, [cursor, page]);
  const start = page * 80,
    end = Math.min(total, start + 79);
  return (
    <section className="replay-moves" aria-label="Move list">
      <h2>Accepted moves</h2>
      <div className="replay-row">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          Earlier rows
        </button>
        <span>
          {start}–{end} / {total}
        </span>
        <button disabled={end === total} onClick={() => setPage(page + 1)}>
          Later rows
        </button>
      </div>
      <ol ref={list} className="history-list" start={start}>
        {Array.from({ length: end - start + 1 }, (_, i) => start + i).map((ply) => {
          const event = events[ply - 1];
          return (
            <li key={ply}>
              <button
                className="review-step"
                ref={ply === cursor ? selected : undefined}
                aria-current={ply === cursor ? 'step' : undefined}
                onClick={() => onSeek(ply)}
                aria-label={`Go to ply ${ply}`}
              >
                {ply === 0 ? (
                  'Opening · all pieces hidden'
                ) : event ? (
                  <>
                    <span>
                      {event.playerId} ·{' '}
                      {event.type === 'MOVE' && event.captured ? 'CAPTURE (MOVE)' : event.type}
                    </span>
                    <HistoryEventDetails event={event} />
                  </>
                ) : (
                  `Ply ${ply} · Not reached`
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function ReplayPosition({
  view,
  onSeek,
}: {
  readonly view: ReplayView;
  readonly onSeek: (ply: number) => void;
}) {
  const last = view.events.at(-1);
  const captures = view.events.filter((e) => e.type === 'MOVE' && e.captured);
  return (
    <>
      {view.error && (
        <p className="replay-error" role="alert">
          Replay stopped at ply {view.error.ply}: {view.error.message} Last valid position:{' '}
          {view.validPlies}.
        </p>
      )}
      {view.observation && (
        <div className="replay-layout">
          <section className="replay-board-panel" aria-label="Replay position">
            <p role="status">
              Ply {view.cursor} / {view.total} · Quiet count {view.quiet} / 60 · Turn{' '}
              {view.observation.currentPlayer}
            </p>
            <p>
              P1: {view.observation.playerColors.P1 ?? 'Unassigned'} · P2:{' '}
              {view.observation.playerColors.P2 ?? 'Unassigned'}
            </p>
            <Board
              squares={view.observation.board}
              disabled
              onSquareClick={() => {}}
              lastAction={last}
            />
            <p>
              Last action:{' '}
              {last
                ? `${last.playerId} · ${last.type === 'MOVE' && last.captured ? 'CAPTURE' : last.type}`
                : 'Opening'}
            </p>
            <p>
              Position result:{' '}
              {view.observation.result ? outcomeLabel(view.observation.result) : 'Active'}
            </p>
            <p>Captures so far: {captures.length}</p>
          </section>
          <ReplayMoveList
            events={view.events}
            cursor={view.cursor}
            total={view.total}
            onSeek={onSeek}
          />
        </div>
      )}
      <section aria-label="Material and hidden inventory">
        <h2>Material and hidden inventory</h2>
        <p>
          Public inventory = standard starting inventory minus reached FLIPs/captures. No hidden
          square identities are used.
        </p>
        <p>
          Remaining pieces: RED{' '}
          {view.inventory.filter((r) => r.color === 'RED').reduce((n, r) => n + r.remaining, 0)} ·
          BLACK{' '}
          {view.inventory.filter((r) => r.color === 'BLACK').reduce((n, r) => n + r.remaining, 0)}
        </p>
        {view.balances.length ? (
          view.balances.map((balance) => (
            <p key={balance.label}>
              {balance.label}: RED {balance.red} · BLACK {balance.black} · RED − BLACK{' '}
              {balance.red - balance.black}
            </p>
          ))
        ) : (
          <p>Weighted balance: Not recorded.</p>
        )}
        <p>
          Weighted balance includes the public remaining inventory, including unrevealed pieces; it
          is not a recorded EV score.
        </p>
        <div className="replay-table">
          <table>
            <thead>
              <tr>
                <th>Piece</th>
                <th>Hidden</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {view.inventory.map((row) => (
                <tr key={`${row.color}-${row.rank}`}>
                  <th>
                    {pieceLabel(row)} ({row.color} {row.rank})
                  </th>
                  <td>{row.hidden}</td>
                  <td>{row.remaining}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-label="Interesting intervals">
        <h2>Interesting intervals · reached moves only</h2>
        <p>
          Reversals compare a player's consecutive turns; repeating blocks span 2–8 quiet moves;
          long no-progress runs start at 20 plies. These markers do not adjudicate game rules.
        </p>
        <div className="replay-intervals">
          {view.intervals.length ? (
            view.intervals.map((interval) => (
              <button
                key={`${interval.kind}-${interval.start}`}
                onClick={() => onSeek(interval.start)}
              >
                {interval.kind} · {interval.start}
                {interval.end !== interval.start ? `–${interval.end}` : ''}
              </button>
            ))
          ) : (
            <p>No intervals yet.</p>
          )}
        </div>
      </section>
      <DecisionDiagnostics durationMs={view.durationMs} />
      <details>
        <summary>Available match metadata</summary>
        <dl>
          {view.metadata.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}
