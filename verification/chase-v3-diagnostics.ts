/** V3 enforcement evidence. Historical pre-v3 results remain in their original artifact. */
import { isDeepStrictEqual } from 'node:util';
import {
  applyAction,
  getObservation,
  getPublicOrdinaryMoves,
  projectPermittedPublicAction,
  type ChaseState,
  type GameAction,
  type GameResult,
  type PieceColor,
  type PieceRank,
} from '../packages/game-core/src/index';
import {
  arrangedInitial,
  type ProjectionFixture,
} from '../packages/game-core/tests/public-projection-fixtures';

type Entry = readonly [number, PieceColor, PieceRank];
export interface ChaseDiagnosticStep {
  readonly ply: number;
  readonly action: GameAction;
  readonly before: ChaseState | null;
  readonly after: ChaseState | null;
  readonly newEligibleTargets: readonly number[];
  readonly result: GameResult | null;
}
export interface ChaseDiagnostic {
  readonly name: string;
  readonly intended: string;
  readonly entries: readonly Entry[];
  readonly actions: readonly GameAction[];
  readonly steps: readonly ChaseDiagnosticStep[];
  readonly replayed: true;
  readonly rejection: string | null;
  readonly rejectedAction: GameAction | null;
}
const f = (position: number): GameAction => ({ type: 'FLIP', position });
const m = (from: number, to: number): GameAction => ({ type: 'MOVE', from, to });

// Only annotate threats using shared Core queries; never implement capture geometry here.
function newTargets(
  before: ProjectionFixture['state'],
  after: ProjectionFixture['state'],
  action: GameAction,
): number[] {
  if (action.type !== 'MOVE' || before.board[action.to] !== null) return [];
  const color = before.playerColors[before.currentPlayer];
  if (color === null) return [];
  const old = getPublicOrdinaryMoves(getObservation(before).board, color);
  const board = getObservation(after).board;
  const next = getPublicOrdinaryMoves(board, color);
  const reciprocal = getPublicOrdinaryMoves(board, color === 'RED' ? 'BLACK' : 'RED');
  return next
    .filter(
      (candidate) =>
        candidate.from === action.to &&
        board[candidate.to]?.kind === 'REVEALED' &&
        !old.some((previous) => previous.from === action.from && previous.to === candidate.to) &&
        !reciprocal.some((reply) => reply.from === candidate.to && reply.to === action.to),
    )
    .map((candidate) => candidate.to);
}

function run(
  name: string,
  intended: string,
  entries: readonly Entry[],
  actions: readonly GameAction[],
): ChaseDiagnostic {
  const fixture = arrangedInitial(entries);
  const steps: ChaseDiagnosticStep[] = [];
  let rejection: string | null = null;
  let rejectedAction: GameAction | null = null;
  for (const action of actions) {
    const before = fixture.state;
    const snapshot = JSON.stringify(before);
    const actual = applyAction(before, before.currentPlayer, action);
    // Trusted differential oracle chooses the actual FLIP outcome, not an Agent.
    const reveal = action.type === 'FLIP' ? before.board[action.position]!.piece : undefined;
    const projected = projectPermittedPublicAction(
      { observation: getObservation(before), publicHistory: fixture.history },
      action,
      reveal,
    );
    if (!actual.ok) {
      if (!isDeepStrictEqual(projected, actual))
        throw new Error(`${name}: rejection parity mismatch.`);
      if (JSON.stringify(before) !== snapshot) throw new Error('Rejected action mutated state.');
      rejection = actual.error.code;
      rejectedAction = action;
      break;
    }
    if (
      !projected.ok ||
      !isDeepStrictEqual(projected.observation, getObservation(actual.state)) ||
      !isDeepStrictEqual(projected.event, actual.event)
    )
      throw new Error(`${name}: public/private projection mismatch.`);
    if (JSON.stringify(before) !== snapshot) throw new Error(`${name}: Core mutated input.`);
    if (/"(?:id|reference|attackerId|targetId|chase)":/.test(JSON.stringify(projected)))
      throw new Error('Public projection leaked private references.');
    steps.push({
      ply: actual.state.plyCount,
      action,
      before: before.chase,
      after: actual.state.chase,
      newEligibleTargets: newTargets(before, actual.state, action),
      result: actual.state.result,
    });
    fixture.state = actual.state;
    fixture.history.push(actual.event);
  }
  const replayed = arrangedInitial(entries);
  for (const action of actions.slice(0, steps.length)) {
    const result = applyAction(replayed.state, replayed.state.currentPlayer, action);
    if (!result.ok) throw new Error(`Replay rejected: ${result.error.code}`);
    replayed.state = result.state;
    replayed.history.push(result.event);
  }
  if (!isDeepStrictEqual(replayed, fixture)) throw new Error(`${name}: exact replay mismatch.`);
  return {
    name,
    intended,
    entries,
    actions: actions.slice(0, steps.length),
    steps,
    replayed: true,
    rejection,
    rejectedAction,
  };
}

const pairEntries: readonly Entry[] = [
  [0, 'RED', 'CHARIOT'],
  [5, 'BLACK', 'HORSE'],
  [20, 'RED', 'CHARIOT'],
  [25, 'BLACK', 'HORSE'],
  [1, 'BLACK', 'SOLDIER'],
  [4, 'BLACK', 'SOLDIER'],
  [21, 'BLACK', 'SOLDIER'],
  [24, 'BLACK', 'SOLDIER'],
  [31, 'BLACK', 'SOLDIER'],
  [30, 'BLACK', 'CANNON'],
  [29, 'RED', 'HORSE'],
];
// Captures clear all required empty squares from an ordinary valid initial deck.
const pairOpening = [
  f(0),
  f(1),
  m(0, 1),
  f(4),
  m(1, 0),
  f(20),
  m(0, 4),
  f(21),
  m(20, 21),
  f(24),
  m(21, 20),
  f(5),
  m(20, 24),
  f(25),
  m(24, 20),
  f(31),
  m(4, 0),
  f(30),
  m(0, 1),
];
const secondThreat = [...pairOpening, m(5, 4), m(1, 0)];
const cycle = [m(5, 4), m(1, 0), m(4, 5), m(0, 1)];

export function diagnoseChaseV3(): readonly ChaseDiagnostic[] {
  const singleEntries: readonly Entry[] = [
    [0, 'RED', 'CHARIOT'],
    [1, 'BLACK', 'SOLDIER'],
    [2, 'BLACK', 'SOLDIER'],
    [4, 'BLACK', 'SOLDIER'],
    [5, 'BLACK', 'HORSE'],
    [6, 'BLACK', 'SOLDIER'],
  ];
  const singleOpening = [
    f(0),
    f(1),
    m(0, 1),
    f(4),
    m(1, 0),
    f(2),
    m(0, 4),
    f(6),
    m(4, 0),
    f(31),
    m(0, 1),
    f(30),
    m(1, 2),
    f(29),
    m(2, 6),
    f(28),
    m(6, 2),
    f(27),
    m(2, 1),
    f(26),
    m(1, 0),
    f(5),
    m(0, 1),
  ];
  const forkOpening = (target: number) => [
    f(0),
    f(1),
    m(0, 1),
    f(4),
    m(1, 0),
    f(target),
    m(0, 4),
    f(5),
    m(4, 0),
    f(31),
    m(0, 1),
  ];
  const forkEntries = (target: number): readonly Entry[] => [
    [0, 'RED', 'CHARIOT'],
    [1, 'BLACK', 'SOLDIER'],
    [4, 'BLACK', 'SOLDIER'],
    [target, 'BLACK', 'SOLDIER'],
    [5, 'BLACK', 'HORSE'],
    [31, 'BLACK', 'GENERAL'],
  ];
  return [
    run(
      'third-appearance',
      'Position limit alone must reject appearance3; the new pair limit would reject an earlier threat in this current-only prefix.',
      pairEntries,
      [...pairOpening, ...cycle, ...cycle],
    ),
    run(
      'changing-position-pursuit',
      'A third qualifying threat by the same physical pair must be rejected even at a new board.',
      singleEntries,
      [...singleOpening, m(5, 6), m(1, 5), m(6, 2), m(5, 6)],
    ),
    run(
      'initial-fork',
      'Allow the first fork but register both candidate relationships; initial pair counts await owner choice.',
      forkEntries(2),
      forkOpening(2),
    ),
    run(
      'renewed-fork',
      'Renewal against the original target continues even when another target is added.',
      forkEntries(9),
      [...forkOpening(9), m(5, 4), m(1, 5)],
    ),
    run(
      'pair-switch',
      'After accepted threat2 exhausts A→B, C→D must not clear that restriction; final A→B renewal is forbidden.',
      pairEntries,
      [...secondThreat, m(4, 5), m(20, 21), m(25, 24), m(0, 1)],
    ),
    run(
      'flip-reset',
      'An unrelated FLIP must not erase exhausted A→B; final renewal is forbidden.',
      pairEntries,
      [...secondThreat, m(4, 5), f(29), m(25, 24), m(0, 1)],
    ),
    run(
      'capture-reset',
      'Capturing unrelated D must not erase exhausted A→B; final renewal is forbidden.',
      pairEntries,
      [...secondThreat, m(25, 24), m(20, 24), m(4, 5), m(0, 1)],
    ),
    run(
      'direct-capture-control',
      'Direct capture of B remains legal despite the exhausted pursuit allowance.',
      pairEntries,
      [...secondThreat, m(25, 24), m(0, 4)],
    ),
    run(
      'reciprocal-shuffle-control',
      'Repeated mutually capturable Horse positions are not qualifying chase/fork positions.',
      pairEntries.map(
        ([position, color, rank]) => [position, color, position === 0 ? 'HORSE' : rank] as const,
      ),
      [...pairOpening, ...cycle, ...cycle, ...cycle],
    ),
  ];
}
