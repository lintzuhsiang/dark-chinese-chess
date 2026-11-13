import {
  applyAction,
  createInitialState,
  getObservation,
  PIECE_DISTRIBUTION,
} from '@dark-chess/game-core';
import type {
  ActionEvent,
  GameAction,
  GameState,
  Piece,
  PieceColor,
  PieceRank,
  PlayerId,
  PlayerObservation,
} from '@dark-chess/game-core';

export interface CoreIdentity {
  readonly revision: string;
  readonly files: Readonly<Record<string, string>>;
}
export interface ReplayError {
  readonly ply: number;
  readonly message: string;
}
export interface MatchSummary {
  readonly index: number;
  readonly seed: number;
  readonly leg: number;
  readonly agents: Readonly<Record<PlayerId, string>>;
  readonly length: number;
  readonly outcome: string;
  readonly available: boolean;
}
export interface ReplayFile {
  readonly raw: Record<string, unknown>;
  readonly matches: readonly MatchSummary[];
  readonly warnings: readonly string[];
}
export interface Interval {
  readonly start: number;
  readonly end: number;
  readonly kind: 'Reversal' | 'Repeating moves' | 'No progress' | 'Last capture' | 'Last FLIP';
}
export interface MaterialRow {
  readonly color: PieceColor;
  readonly rank: PieceRank;
  readonly hidden: number;
  readonly remaining: number;
}
export interface Balance {
  readonly label: string;
  readonly red: number;
  readonly black: number;
}
export interface ReplayView {
  readonly match: MatchSummary;
  readonly cursor: number;
  readonly total: number;
  readonly validPlies: number;
  readonly observation: PlayerObservation | null;
  readonly quiet: number;
  // Only the reached prefix leaves the trusted replay boundary.
  readonly events: readonly ActionEvent[];
  readonly intervals: readonly Interval[];
  readonly inventory: readonly MaterialRow[];
  readonly balances: readonly Balance[];
  readonly metadata: readonly (readonly [string, string])[];
  readonly durationMs: number | null;
  readonly error: ReplayError | null;
}

export const MAX_FILE_BYTES = 128 * 1024 * 1024;
export const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const player = (value: unknown): value is PlayerId => value === 'P1' || value === 'P2';
const rank = (value: unknown): value is PieceRank =>
  typeof value === 'string' && Object.hasOwn(PIECE_DISTRIBUTION, value);
const color = (value: unknown): value is PieceColor => value === 'RED' || value === 'BLACK';
const textValue = (value: unknown): string => (typeof value === 'string' ? value : 'Not recorded.');

export function outcomeLabel(value: unknown): string {
  const result = record(value);
  if (result?.type === 'DRAW') return `DRAW · ${textValue(result.reason)}`;
  if (result?.type === 'WIN' && player(result.winner))
    return `${result.winner} wins · ${textValue(result.reason)}`;
  return 'Not recorded.';
}

export function importTournament(text: string): ReplayFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file.');
  }
  const raw = record(parsed);
  const manifest = record(raw?.manifest);
  if (
    raw?.schemaVersion !== 1 ||
    record(manifest?.runner)?.implementation !== 'ai-eval-v2' ||
    !Array.isArray(raw.matches)
  ) {
    throw new Error('Expected schemaVersion 1, ai-eval-v2 tournament JSON.');
  }
  if (!raw.matches.length) throw new Error('Tournament has no matches.');
  const agents = record(record(raw.configuration)?.agents);
  const seen = new Set<string>();
  const matches = raw.matches.map((value: unknown, index: number): MatchSummary => {
    const match = record(value);
    if (!match || !integer(match.deckSeed) || (match.leg !== 0 && match.leg !== 1)) {
      throw new Error(
        `Malformed match selector entry ${index + 1}: expected deckSeed and leg 0 or 1.`,
      );
    }
    const key = `${match.deckSeed}:${match.leg}`;
    if (seen.has(key)) throw new Error(`Ambiguous seed + leg: ${key}.`);
    seen.add(key);
    const report = record(match.report);
    const metadata = record(report?.metadata);
    const names = record(metadata?.agentConfiguration);
    const seats = record(match.seats);
    const agentName = (seat: PlayerId) => {
      const competitor = seats?.[seat];
      return typeof names?.[seat] === 'string'
        ? (names[seat] as string)
        : textValue(record(agents?.[typeof competitor === 'string' ? competitor : ''])?.id);
    };
    const outcome = record(report?.outcome);
    return {
      index,
      seed: match.deckSeed,
      leg: match.leg,
      agents: { P1: agentName('P1'), P2: agentName('P2') },
      length: Array.isArray(report?.actions)
        ? report.actions.length
        : integer(match.gameLength)
          ? match.gameLength
          : 0,
      outcome: match.gameResult
        ? outcomeLabel(match.gameResult)
        : outcome?.type === 'COMPLETED'
          ? outcomeLabel(outcome.result)
          : typeof outcome?.type === 'string'
            ? `${outcome.type} · ${textValue(outcome.reason ?? record(outcome.error)?.code)}`
            : textValue(record(match.failure)?.category),
      available: report !== null,
    };
  });
  const warnings =
    manifest?.sourceStableDuringRun === false
      ? [
          'Source changed during this run. The report does not identify one reproducible executed version. Recorded actions can still be checked against the current Core.',
        ]
      : [];
  return { raw, matches, warnings };
}

// Compare JSON by structure, independent of property order. Used only at import boundaries.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a))
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  const left = record(a),
    right = record(b);
  return (
    left !== null &&
    right !== null &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
  );
}

function accepted(value: unknown): { playerId: PlayerId; action: GameAction } | null {
  const entry = record(value),
    action = record(entry?.action);
  if (!entry || !player(entry.playerId) || !action) return null;
  if (action.type === 'FLIP' && integer(action.position) && action.position < 32) {
    return { playerId: entry.playerId, action: { type: 'FLIP', position: action.position } };
  }
  if (
    action.type === 'MOVE' &&
    integer(action.from) &&
    action.from < 32 &&
    integer(action.to) &&
    action.to < 32
  ) {
    return { playerId: entry.playerId, action: { type: 'MOVE', from: action.from, to: action.to } };
  }
  return null;
}

export interface SelectedReplay {
  readonly match: MatchSummary;
  readonly report: Record<string, unknown> | null;
  readonly states: readonly GameState[];
  readonly events: readonly ActionEvent[];
  readonly error: ReplayError | null;
}

export function selectReplay(file: ReplayFile, index: number, core: CoreIdentity): SelectedReplay {
  const match = file.matches[index];
  if (!match) throw new Error('Match does not exist.');
  const rawMatch = record((file.raw.matches as unknown[])[index]);
  const report = record(rawMatch?.report);
  const states: GameState[] = [],
    events: ActionEvent[] = [];
  const fail = (ply: number, message: string): SelectedReplay => ({
    match,
    report,
    states,
    events,
    error: { ply, message },
  });
  if (!report) return fail(0, 'No replay transcript was recorded for this match.');
  const manifest = record(file.raw.manifest),
    metadata = record(report.metadata);
  if (manifest?.coreRevision !== core.revision || metadata?.coreRevision !== core.revision) {
    return fail(0, `Incompatible Core revision. This inspector requires ${core.revision}.`);
  }
  const files = record(manifest.source)?.files;
  if (
    !Array.isArray(files) ||
    !Object.entries(core.files).every(([path, hash]) =>
      files.some((value: unknown) => {
        const item = record(value);
        return item?.path === path && item.sha256 === hash;
      }),
    )
  ) {
    return fail(
      0,
      'Incompatible or missing Core/rules source hashes. Restart the dev server after Core changes.',
    );
  }
  if (metadata?.deckSeed !== match.seed || metadata.agentSeed !== rawMatch?.agentSeed)
    return fail(0, 'Match seed metadata differs from transcript.');
  if (
    !Array.isArray(report.initialDeck) ||
    !report.initialDeck.every((value: unknown) => {
      const piece = record(value);
      return piece && typeof piece.id === 'string' && color(piece.color) && rank(piece.rank);
    })
  )
    return fail(0, 'Malformed initial deck.');
  const initial = createInitialState(report.initialDeck as Piece[]);
  if (!initial.ok) return fail(0, initial.error.code);
  if (!Array.isArray(report.actions) || !Array.isArray(report.publicHistory))
    return fail(0, 'Missing accepted actions or public history.');
  states.push(initial.state);
  for (const [i, value] of report.actions.entries()) {
    const entry = accepted(value);
    if (!entry) return fail(i + 1, 'Malformed accepted action.');
    const result = applyAction(states.at(-1)!, entry.playerId, entry.action);
    if (!result.ok) return fail(i + 1, `Core rejected action: ${result.error.code}.`);
    if (!same(result.event, report.publicHistory[i]))
      return fail(i + 1, 'Core event differs from recorded public history.');
    states.push(result.state);
    events.push(result.event);
  }
  const total = events.length;
  if (report.publicHistory.length !== total)
    return fail(total + 1, 'Recorded history contains extra events.');
  if (!same(states.at(-1), report.finalState))
    return fail(total, 'Core final state differs from recorded final state.');
  const outcome = record(report.outcome),
    final = states.at(-1)!;
  if (outcome?.type === 'COMPLETED') {
    if (
      final.status !== 'FINISHED' ||
      !same(final.result, outcome.result) ||
      !same(rawMatch?.gameResult, final.result)
    )
      return fail(total, 'Recorded terminal result differs from Core.');
  } else if (outcome?.type === 'FAILED' || outcome?.type === 'TRUNCATED') {
    if (final.status !== 'ACTIVE' || rawMatch?.gameResult !== null)
      return fail(total, 'Unfinished transcript records a terminal state.');
  } else return fail(total, 'Missing or malformed match outcome.');
  if (rawMatch?.gameLength !== total)
    return fail(total, 'Recorded game length differs from accepted actions.');
  return { match, report, states, events, error: null };
}

export function interestingIntervals(events: readonly ActionEvent[]): Interval[] {
  const intervals: Interval[] = [];
  let quietStart = 0,
    lastCapture = 0,
    lastFlip = 0;
  const signature = (event: ActionEvent) =>
    event.type === 'MOVE' && !event.captured ? `${event.playerId}:${event.from}:${event.to}` : '';
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!,
      previous = events[i - 2];
    if (event.type === 'FLIP' || event.captured) {
      if (quietStart && event.ply - quietStart >= 20)
        intervals.push({ start: quietStart, end: event.ply - 1, kind: 'No progress' });
      quietStart = 0;
      if (event.type === 'FLIP') lastFlip = event.ply;
      else lastCapture = event.ply;
    } else {
      quietStart ||= event.ply;
      if (
        previous?.type === 'MOVE' &&
        !previous.captured &&
        event.playerId === previous.playerId &&
        event.from === previous.to &&
        event.to === previous.from
      ) {
        intervals.push({ start: previous.ply, end: event.ply, kind: 'Reversal' });
      }
    }
    // Consecutive repeated action blocks, periods 2–8, entirely quiet moves.
    for (let period = 2; period <= 8 && i + 1 >= period * 2; period++) {
      const start = i + 1 - period * 2;
      if (
        Array.from({ length: period }, (_, k) => {
          const a = signature(events[start + k]!);
          return a !== '' && a === signature(events[start + k + period]!);
        }).every(Boolean)
      ) {
        const prior = [...intervals].reverse().find((item) => item.kind === 'Repeating moves');
        if (prior && prior.end >= start) {
          intervals[intervals.indexOf(prior)] = { ...prior, end: event.ply };
        } else intervals.push({ start: start + 1, end: event.ply, kind: 'Repeating moves' });
        break;
      }
    }
  }
  if (quietStart && events.length - quietStart + 1 >= 20)
    intervals.push({ start: quietStart, end: events.length, kind: 'No progress' });
  if (lastCapture) intervals.push({ start: lastCapture, end: lastCapture, kind: 'Last capture' });
  if (lastFlip) intervals.push({ start: lastFlip, end: lastFlip, kind: 'Last FLIP' });
  return intervals;
}

export function publicInventory(events: readonly ActionEvent[]): MaterialRow[] {
  return (['RED', 'BLACK'] as const).flatMap((pieceColor) =>
    (Object.keys(PIECE_DISTRIBUTION) as PieceRank[]).map((pieceRank) => {
      const matches = (piece: { color: PieceColor; rank: PieceRank }) =>
        piece.color === pieceColor && piece.rank === pieceRank;
      return {
        color: pieceColor,
        rank: pieceRank,
        hidden:
          PIECE_DISTRIBUTION[pieceRank] -
          events.filter((e) => e.type === 'FLIP' && matches(e.piece)).length,
        remaining:
          PIECE_DISTRIBUTION[pieceRank] -
          events.filter((e) => e.type === 'MOVE' && e.captured && matches(e.captured)).length,
      };
    }),
  );
}

function balances(file: ReplayFile, inventory: readonly MaterialRow[]): Balance[] {
  const agents = record(record(file.raw.configuration)?.agents);
  return (['A', 'B'] as const).flatMap((seat) => {
    const agent = record(agents?.[seat]);
    const values = record(record(agent?.configuration)?.pieceValues);
    if (
      !values ||
      !(Object.keys(PIECE_DISTRIBUTION) as PieceRank[]).every(
        (key) => typeof values[key] === 'number' && Number.isFinite(values[key]) && values[key] > 0,
      )
    )
      return [];
    const sum = (pieceColor: PieceColor) =>
      inventory
        .filter((row) => row.color === pieceColor)
        .reduce((total, row) => total + row.remaining * (values[row.rank] as number), 0);
    return [
      {
        label: `${seat}: ${textValue(agent?.id)} piece values`,
        red: sum('RED'),
        black: sum('BLACK'),
      },
    ];
  });
}

export function replayView(file: ReplayFile, selected: SelectedReplay, cursor: number): ReplayView {
  if (!integer(cursor) || cursor > selected.match.length)
    throw new Error(`Ply must be an integer from 0 to ${selected.match.length}.`);
  const reached = Math.min(cursor, selected.events.length);
  const state = selected.states[reached];
  const events = selected.events.slice(0, reached),
    inventory = publicInventory(events);
  const metadata = record(selected.report?.metadata),
    manifest = record(file.raw.manifest);
  const decisions = selected.report?.decisions;
  const decision = Array.isArray(decisions)
    ? decisions
        .map(record)
        .find(
          (d) =>
            d?.status === 'ACCEPTED' &&
            d.ply === reached - 1 &&
            d.playerId === events.at(-1)?.playerId,
        )
    : null;
  return {
    match: selected.match,
    cursor: reached,
    total: selected.match.length,
    validPlies: selected.events.length,
    observation: state ? getObservation(state) : null,
    quiet: state?.noProgressCount ?? 0,
    events,
    inventory,
    intervals: interestingIntervals(events),
    balances: balances(file, inventory),
    durationMs:
      typeof decision?.durationMs === 'number' && Number.isFinite(decision.durationMs)
        ? decision.durationMs
        : null,
    metadata: [
      ['Core revision', textValue(metadata?.coreRevision)],
      ['Runner', textValue(record(manifest?.runner)?.implementation)],
      ['Runner digest', textValue(record(manifest?.runner)?.sourceDigest)],
      ['Source digest', textValue(record(manifest?.source)?.digest)],
      ['Agent seed', String(metadata?.agentSeed ?? 'Not recorded.')],
      ['Initialization', textValue(metadata?.initialization)],
      ['Ply limit', String(metadata?.maxPlies ?? 'Not recorded.')],
      ['Decision seed algorithm', textValue(metadata?.decisionSeedAlgorithm)],
      ['Shuffle random algorithm', textValue(metadata?.randomAlgorithm)],
      ['Git head', textValue(record(manifest?.git)?.head)],
      ['Branch', textValue(record(manifest?.git)?.branch)],
      ['Source stable during run', String(manifest?.sourceStableDuringRun ?? 'Not recorded.')],
      ['Node', textValue(record(metadata?.environment)?.node)],
      ['Platform', textValue(record(metadata?.environment)?.platform)],
      ['Architecture', textValue(record(metadata?.environment)?.arch)],
      ...(['A', 'B'] as const).map((competitor): readonly [string, string] => {
        const agent = record(record(record(file.raw.configuration)?.agents)?.[competitor]);
        return [
          `${competitor} configuration`,
          agent?.configuration ? JSON.stringify(agent.configuration, null, 2) : 'Not recorded.',
        ];
      }),
    ],
    error: selected.error,
  };
}

export interface Incident {
  readonly seed: number;
  readonly leg: number;
  readonly ply: number;
}
export function parseIncident(search: string): Incident | null {
  const params = new URLSearchParams(search);
  if (!['seed', 'leg', 'ply'].some((key) => params.has(key))) return null;
  const values = ['seed', 'leg', 'ply'].map((key) => params.get(key));
  if (values.some((value) => value === null || !/^\d+$/.test(value)))
    throw new Error('Incident URL requires seed, leg (0/1), and ply as non-negative integers.');
  const [seed, leg, ply] = values.map(Number) as [number, number, number];
  if (!integer(seed) || !integer(ply) || (leg !== 0 && leg !== 1))
    throw new Error('Invalid incident URL.');
  return { seed, leg, ply };
}
