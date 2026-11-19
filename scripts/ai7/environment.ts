import { performance } from 'node:perf_hooks';
import {
  applyAction,
  createInitialState,
  getLegalActions,
  getObservation,
  PIECE_DISTRIBUTION,
  type ActionEvent,
  type GameAction,
  type GameResult,
  type Piece,
  type PieceRank,
  type PlayerId,
  type PlayerObservation,
} from '../../packages/game-core/src/index';
import { createShuffledDeck } from '../../apps/web/src/game/deck';
import { createSeededRandom } from '../../packages/ai-agents/src/seeded-random';

export const ACTION_COUNT = 1056;
export const OBSERVATION_VERSION = 'public-v1';
export const RANKS = Object.keys(PIECE_DISTRIBUTION) as PieceRank[];
const colors = ['RED', 'BLACK'] as const;

export function actionId(action: GameAction): number {
  return action.type === 'FLIP' ? action.position : 32 + action.from * 32 + action.to;
}

export function decodeAction(id: number): GameAction {
  if (!Number.isInteger(id) || id < 0 || id >= ACTION_COUNT)
    throw new RangeError('Action ID must be an integer in [0, 1056).');
  return id < 32
    ? { type: 'FLIP', position: id }
    : { type: 'MOVE', from: Math.floor((id - 32) / 32), to: (id - 32) % 32 };
}

// This is the ONLY per-decision game data contract passed to Python. No seed, deck, Core IDs,
// private chase tracker, result ownership hint, or heuristic score is included.
export interface PublicInput {
  readonly board: readonly number[];
  readonly references: readonly number[];
  readonly hiddenInventory: readonly number[];
  readonly remainingInventory: readonly number[];
  readonly history: readonly (readonly number[])[];
  readonly player: number;
  readonly color: number;
  readonly quiet: number;
  readonly ply: number;
  readonly legal: readonly number[];
}

export function createPublicMemory() {
  const references = Array<number>(32).fill(0);
  const hidden = colors.flatMap(() => RANKS.map((rank) => PIECE_DISTRIBUTION[rank]));
  const remaining = [...hidden];
  const recent: number[][] = [];
  let quiet = 0;
  let ply = 0;
  const pieceIndex = (piece: ActionEvent['piece']) =>
    colors.indexOf(piece.color) * 7 + RANKS.indexOf(piece.rank);

  function accept(event: ActionEvent): void {
    if (event.ply !== ply + 1)
      throw new Error('Public history must be a complete accepted prefix.');
    let mover: number;
    let target = 0;
    if (event.type === 'FLIP') {
      // A square can be flipped only once. Original reveal square is a stable,
      // public physical reference, independent of the hidden/private piece ID.
      mover = event.position + 1;
      references[event.position] = mover;
      hidden[pieceIndex(event.piece)]! -= 1;
      quiet = 0;
    } else {
      mover = references[event.from]!;
      target = references[event.to]!;
      if (mover === 0) throw new Error('Move without a public reveal reference.');
      references[event.to] = mover;
      references[event.from] = 0;
      if (event.captured !== null) remaining[pieceIndex(event.captured)]! -= 1;
      quiet = event.captured === null ? quiet + 1 : 0;
    }
    ply = event.ply;
    recent.push([
      event.type === 'FLIP' ? 1 : 2,
      event.playerId === 'P1' ? 1 : 2,
      event.type === 'MOVE' ? event.from + 1 : 0,
      (event.type === 'FLIP' ? event.position : event.to) + 1,
      mover,
      target,
      RANKS.indexOf(event.piece.rank) + 1,
      colors.indexOf(event.piece.color) + 1,
      event.type === 'MOVE' && event.captured ? RANKS.indexOf(event.captured.rank) + 1 : 0,
      event.type === 'MOVE' && event.captured ? colors.indexOf(event.captured.color) + 1 : 0,
    ]);
    if (recent.length > 20) recent.shift();
  }

  function encode(observation: PlayerObservation, legal: readonly GameAction[]): PublicInput {
    return {
      board: observation.board.map((square) =>
        square.kind === 'EMPTY' ? 0 : square.kind === 'HIDDEN' ? 1 : 2 + pieceIndex(square.piece),
      ),
      references: [...references],
      hiddenInventory: [...hidden],
      remainingInventory: [...remaining],
      history: recent.map((event) => [...event]),
      player: observation.currentPlayer === 'P1' ? 0 : 1,
      color: colors.indexOf(observation.playerColors[observation.currentPlayer]!) + 1,
      quiet,
      ply,
      legal: legal.map(actionId),
    };
  }
  return { accept, encode };
}

export function terminalRewards(result: GameResult | null): Record<PlayerId, number> {
  if (result?.type !== 'WIN') return { P1: 0, P2: 0 };
  return result.winner === 'P1' ? { P1: 1, P2: -1 } : { P1: -1, P2: 1 };
}

export function createEnvironment(seed: number, suppliedDeck?: readonly Piece[]) {
  const deck = suppliedDeck ?? createShuffledDeck(createSeededRandom(seed));
  const initial = createInitialState(deck);
  if (!initial.ok) throw new Error('Invalid environment deck.');
  let state = initial.state;
  const history: ActionEvent[] = [];
  const memory = createPublicMemory();
  const positions = new Map<string, number>();
  const lastOwnMove = new Map<PlayerId, Extract<ActionEvent, { type: 'MOVE' }>>();
  let captures = 0;
  let flips = 0;
  let reversals = 0;
  let repetitions = 0;
  const everPublicCountLead = { P1: false, P2: false };
  const timings = { transitionMs: 0, legalMs: 0, encodingMs: 0, steps: 0, observations: 0 };

  function observe(): PublicInput {
    const start = performance.now();
    const legal = getLegalActions(state, state.currentPlayer);
    const encodedAt = performance.now();
    const result = memory.encode(getObservation(state), legal);
    timings.legalMs += encodedAt - start;
    timings.encodingMs += performance.now() - encodedAt;
    timings.observations += 1;
    return result;
  }

  function step(id: number) {
    const action = decodeAction(id);
    const actor = state.currentPlayer;
    const start = performance.now();
    const next = applyAction(state, actor, action);
    timings.transitionMs += performance.now() - start;
    if (!next.ok) throw new Error(`Core rejected action ${id}: ${next.error.code}`);
    state = next.state;
    history.push(next.event);
    memory.accept(next.event);
    timings.steps += 1;
    const event = next.event;
    if (event.type === 'FLIP') {
      flips += 1;
      lastOwnMove.delete(actor);
    } else {
      if (event.captured) captures += 1;
      const previous = lastOwnMove.get(actor);
      if (previous?.from === event.to && previous.to === event.from) reversals += 1;
      lastOwnMove.set(actor, event);
    }
    const publicState = getObservation(state);
    // Diagnostics only: unweighted revealed piece count, never a reward/input.
    const counts = publicState.board.reduce(
      (count, square) => {
        if (square.kind === 'REVEALED') count[square.piece.color] += 1;
        return count;
      },
      { RED: 0, BLACK: 0 },
    );
    for (const player of ['P1', 'P2'] as const) {
      const color = publicState.playerColors[player];
      if (color && counts[color] > counts[color === 'RED' ? 'BLACK' : 'RED'])
        everPublicCountLead[player] = true;
    }
    const key = JSON.stringify([
      publicState.board,
      publicState.currentPlayer,
      publicState.playerColors,
    ]);
    const seen = positions.get(key) ?? 0;
    if (seen > 0) repetitions += 1;
    positions.set(key, seen + 1);
    return { terminated: state.status === 'FINISHED', rewards: terminalRewards(state.result) };
  }

  function summary() {
    return {
      result: state.result,
      plies: state.plyCount,
      captures,
      flips,
      hidden: getObservation(state).board.filter((square) => square.kind === 'HIDDEN').length,
      reversals,
      repetitions,
      everPublicCountLead: { ...everPublicCountLead },
    };
  }

  // Trusted archive boundary; the server writes this directly to disk. It must
  // never include this object in an observation or trainer response.
  function archive() {
    return {
      initialDeck: deck,
      actions: history.map((event) => ({
        playerId: event.playerId,
        action:
          event.type === 'FLIP'
            ? { type: 'FLIP' as const, position: event.position }
            : { type: 'MOVE' as const, from: event.from, to: event.to },
      })),
      publicHistory: history,
      finalState: state,
      summary: summary(),
    };
  }
  return { observe, step, summary, archive, timings };
}
