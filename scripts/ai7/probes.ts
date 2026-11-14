// Evaluation-only Core-derived diagnostics. Never imported by environment.ts or PPO.
import {
  createInitialState,
  createPublicProjectionContext,
  getLegalActions,
  getObservation,
  getPublicOrdinaryMoves,
  projectPublicAction,
  type GameAction,
  type PublicPiece,
  type PublicProjectionContext,
} from '../../packages/game-core/src/index';
import {
  accept,
  tacticalSnapshot,
  type ProjectionFixture,
} from '../../packages/game-core/tests/public-projection-fixtures';
import {
  recaptureFixture,
  profitableFixture,
} from '../../packages/ai-agents/tests/tactical-fixtures';
import { actionId, createPublicMemory, RANKS } from './environment';

function publicKey(fixture: ProjectionFixture): string {
  const observation = getObservation(fixture.state);
  return JSON.stringify([observation.board, observation.currentPlayer, observation.playerColors]);
}

function describeProbe(
  id: string,
  category: string,
  fixture: ProjectionFixture,
  previous = new Set<string>(),
) {
  const observation = getObservation(fixture.state);
  const legal = getLegalActions(fixture.state, fixture.state.currentPlayer);
  const memory = createPublicMemory();
  for (const event of fixture.history) memory.accept(event);
  const encoded = memory.encode(observation, legal);
  const context = createPublicProjectionContext({ observation, publicHistory: fixture.history });
  const actor = fixture.state.currentPlayer;
  const opponent = actor === 'P1' ? 'P2' : 'P1';
  const hiddenCount = encoded.hiddenInventory.reduce((sum, count) => sum + count, 0);
  const outcomes: { piece: PublicPiece; probability: number }[] = [];
  for (const [index, count] of encoded.hiddenInventory.entries()) {
    if (count > 0)
      outcomes.push({
        piece: { color: index < 7 ? 'RED' : 'BLACK', rank: RANKS[index % 7]! },
        probability: count / hiddenCount,
      });
  }
  function opponentImmediateWin(
    nextContext: PublicProjectionContext,
    nextObservation: typeof observation,
  ): boolean {
    const color = nextObservation.playerColors[opponent];
    if (color === null) return false;
    // Deliberately narrow: an opponent's immediate terminal winning MOVE, not
    // tactical/material scoring or a guessed long-horizon advantage.
    return getPublicOrdinaryMoves(nextObservation.board, color).some((reply) => {
      const branch = projectPublicAction(nextContext, reply);
      return (
        branch.ok &&
        branch.observation.result?.type === 'WIN' &&
        branch.observation.result.winner === opponent
      );
    });
  }
  const captures: number[] = [];
  const wins: number[] = [];
  const repeated: number[] = [];
  const risks: Record<number, number> = {};
  for (const action of legal) {
    const id = actionId(action);
    if (action.type === 'MOVE' && observation.board[action.to]?.kind === 'REVEALED')
      captures.push(id);
    const branches = action.type === 'FLIP' ? outcomes : [{ piece: undefined, probability: 1 }];
    let risk = 0;
    let winsEveryOutcome = true;
    for (const branch of branches) {
      const result = projectPublicAction(context, action, branch.piece);
      if (!result.ok) throw new Error(`Probe action rejected: ${result.error.code}`);
      const outcome = result.observation.result;
      const win = outcome?.type === 'WIN' && outcome.winner === actor;
      winsEveryOutcome &&= win;
      if (outcome?.type === 'WIN' && outcome.winner === opponent) risk += branch.probability;
      else if (outcome === null && opponentImmediateWin(result.nextContext, result.observation))
        risk += branch.probability;
      const key = JSON.stringify([
        result.observation.board,
        result.observation.currentPlayer,
        result.observation.playerColors,
      ]);
      if (action.type === 'MOVE' && previous.has(key) && !repeated.includes(id)) repeated.push(id);
    }
    if (winsEveryOutcome) wins.push(id);
    risks[id] = risk;
  }
  const safe = legal.map(actionId).filter((id) => risks[id]! < 1e-12);
  const risky = legal.map(actionId).filter((id) => risks[id]! > 1e-12);
  const flips = legal.filter((action) => action.type === 'FLIP').map(actionId);
  const lowRisk = flips.length ? Math.min(...flips.map((id) => risks[id]!)) : null;
  const highRisk = flips.length ? Math.max(...flips.map((id) => risks[id]!)) : null;
  return {
    id,
    category,
    evaluationOnly: true,
    observation: encoded,
    groups: {
      immediate_capture: captures,
      immediate_win: wins,
      avoid_immediate_loss: safe.length && risky.length ? safe : [],
      immediate_loss_risky: safe.length && risky.length ? risky : [],
      lowest_flip_risk: lowRisk !== highRisk ? flips.filter((id) => risks[id] === lowRisk) : [],
      highest_flip_risk: lowRisk !== highRisk ? flips.filter((id) => risks[id] === highRisk) : [],
      repetition_winning_break: repeated.length ? wins : [],
      repeated_position: repeated,
    },
    immediateLossRisk: risks,
    interpretation:
      'Only Core-terminal one-MOVE reply risk is measured. Capture probability is not a value judgment. Endgame and repetition probes test immediate winning conversion, not general strategic skill.',
  };
}

export function createEvaluationProbes() {
  const probes = [
    describeProbe('capture-recapture-geometry', 'immediate_capture', recaptureFixture()),
    describeProbe('capture-general-geometry', 'immediate_capture', profitableFixture()),
    describeProbe(
      'avoid-self-exposure',
      'avoid_immediate_loss',
      tacticalSnapshot([
        [9, 'RED', 'SOLDIER'],
        [4, 'BLACK', 'ADVISOR'],
        [31, 'BLACK', 'SOLDIER'],
      ]),
    ),
    describeProbe(
      'escape-before-flip',
      'avoid_immediate_loss',
      tacticalSnapshot([
        [9, 'RED', 'GENERAL'],
        [10, 'BLACK', 'SOLDIER'],
        [31, 'BLACK', 'CANNON', false],
      ]),
    ),
    describeProbe(
      'public-chance-flip-risk',
      'flip_risk',
      tacticalSnapshot([
        [9, 'RED', 'GENERAL'],
        [0, 'BLACK', 'GENERAL'],
        [10, 'BLACK', 'SOLDIER', false],
        [31, 'BLACK', 'CANNON', false],
      ]),
    ),
    describeProbe(
      'soldier-terminal-conversion',
      'endgame_conversion',
      tacticalSnapshot([
        [9, 'RED', 'SOLDIER'],
        [10, 'BLACK', 'GENERAL'],
      ]),
    ),
    describeProbe(
      'equal-rank-terminal-conversion',
      'endgame_conversion',
      tacticalSnapshot([
        [9, 'RED', 'HORSE'],
        [10, 'BLACK', 'HORSE'],
      ]),
    ),
  ];
  const repeating = tacticalSnapshot([
    [9, 'RED', 'HORSE'],
    [10, 'BLACK', 'HORSE'],
  ]);
  const previous = new Set<string>([publicKey(repeating)]);
  const cycle: readonly GameAction[] = [
    { type: 'MOVE', from: 9, to: 8 },
    { type: 'MOVE', from: 10, to: 11 },
    { type: 'MOVE', from: 8, to: 9 },
    { type: 'MOVE', from: 11, to: 10 },
  ];
  for (let turn = 0; turn < 56; turn++) {
    accept(repeating, cycle[turn % 4]!);
    previous.add(publicKey(repeating));
  }
  probes.push(
    describeProbe('winning-break-before-no-progress', 'repetition_break', repeating, previous),
  );
  return {
    evaluationOnly: true,
    version: 'core-terminal-probes-v1',
    setup:
      'Core-validated cooperative prefixes constructed with existing test fixture compiler; its setup heuristics do not reach model inputs or training. Diagnostics are public/chance-derived.',
    probes,
  };
}

/** New geometric counterparts, replayed by authoritative Core; evaluation only. */
export function createConfirmationProbes() {
  const fixtures = [
    recaptureFixture(),
    profitableFixture(),
    tacticalSnapshot([
      [9, 'RED', 'SOLDIER'],
      [4, 'BLACK', 'ADVISOR'],
      [31, 'BLACK', 'SOLDIER'],
    ]),
    tacticalSnapshot([
      [9, 'RED', 'GENERAL'],
      [10, 'BLACK', 'SOLDIER'],
      [31, 'BLACK', 'CANNON', false],
    ]),
    tacticalSnapshot([
      [9, 'RED', 'GENERAL'],
      [0, 'BLACK', 'GENERAL'],
      [10, 'BLACK', 'SOLDIER', false],
      [31, 'BLACK', 'CANNON', false],
    ]),
    tacticalSnapshot([
      [9, 'RED', 'SOLDIER'],
      [10, 'BLACK', 'GENERAL'],
    ]),
    tacticalSnapshot([
      [9, 'RED', 'HORSE'],
      [10, 'BLACK', 'HORSE'],
    ]),
    tacticalSnapshot([
      [9, 'RED', 'HORSE'],
      [10, 'BLACK', 'HORSE'],
    ]),
  ];
  const last = fixtures[7]!;
  const cycle: readonly GameAction[] = [
    { type: 'MOVE', from: 9, to: 8 },
    { type: 'MOVE', from: 10, to: 11 },
    { type: 'MOVE', from: 8, to: 9 },
    { type: 'MOVE', from: 11, to: 10 },
  ];
  for (let i = 0; i < 56; i++) accept(last, cycle[i % 4]!);
  const categories = [
    'capture',
    'capture',
    'defense',
    'defense',
    'flip_risk',
    'endgame',
    'endgame',
    'repetition',
  ];
  const probes = fixtures.map((fixture, index) => {
    if (!fixture.initialDeck) throw new Error('Confirmation setup requires a complete replay deck');
    const initial = createInitialState([...fixture.initialDeck].reverse());
    if (!initial.ok) throw new Error('Invalid confirmation deck');
    const mirrored: ProjectionFixture = { state: initial.state, history: [] };
    const previous = new Set<string>([publicKey(mirrored)]);
    for (const event of fixture.history) {
      accept(
        mirrored,
        event.type === 'FLIP'
          ? { type: 'FLIP', position: 31 - event.position }
          : { type: 'MOVE', from: 31 - event.from, to: 31 - event.to },
      );
      previous.add(publicKey(mirrored));
    }
    return describeProbe(`confirmation-${index}`, categories[index]!, mirrored, previous);
  });
  return {
    evaluationOnly: true,
    version: 'p1p2-confirmation-mirror-v1',
    setup:
      'Previously unevaluated 180-degree geometric counterparts; every accepted prefix and action classification validated by Core. Narrow symmetry confirmation, not independent tactical tasks.',
    probes,
  };
}
