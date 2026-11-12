import { getChaseUpdate } from './chase';
import { evaluateOutcomeFacts } from './outcomes';
import { PIECE_DISTRIBUTION } from './piece-distribution';
import type { RulePosition } from './rule-position';
import { actionMetadata } from './transition';
import type {
  GameAction,
  PieceColor,
  PieceRank,
  PublicPiece,
  PublicProjectionInput,
  PublicProjectionResult,
  PublicSquare,
} from './types';
import { getActionError, getPublicOrdinaryMoves } from './validation';

function samePiece(left: PublicPiece, right: PublicPiece): boolean {
  return left.color === right.color && left.rank === right.rank;
}

function transition(position: RulePosition, action: GameAction, reveal?: PublicPiece) {
  const board = [...position.board];
  let metadata;
  if (action.type === 'FLIP') {
    // The caller supplies an enumerated public outcome, never an actual hidden piece.
    const piece = { color: reveal!.color, rank: reveal!.rank };
    board[action.position] = {
      kind: 'REVEALED',
      piece,
      reference: `reveal-${position.plyCount + 1}`,
    };
    metadata = actionMetadata(position, action, piece, null);
  } else {
    const source = board[action.from]!;
    const target = board[action.to]!;
    if (source.kind !== 'REVEALED') throw new RangeError('Expected a revealed MOVE source.');
    board[action.from] = { kind: 'EMPTY' };
    board[action.to] = source;
    metadata = actionMetadata(
      position,
      action,
      source.piece,
      target.kind === 'REVEALED' ? target.piece : null,
    );
  }
  const { event, ...updates } = metadata;
  const candidate: RulePosition = { ...position, ...updates, board };
  const update = getChaseUpdate(position, candidate, action);
  return { position: { ...candidate, chase: update.chase }, event, prohibited: update.prohibited };
}

function publicInventory({ observation, publicHistory }: PublicProjectionInput) {
  if (observation.board.length !== 32) throw new RangeError('Public board requires 32 squares.');
  const counts = { RED: { ...PIECE_DISTRIBUTION }, BLACK: { ...PIECE_DISTRIBUTION } };
  for (const [index, event] of publicHistory.entries()) {
    if (event.ply !== index + 1 || event.playerId !== (index % 2 === 0 ? 'P1' : 'P2')) {
      throw new RangeError('Public history must be the complete accepted sequential prefix.');
    }
    if (event.type === 'MOVE' && event.captured !== null) {
      counts[event.captured.color][event.captured.rank] -= 1;
    }
  }
  if (observation.currentPlayer !== (publicHistory.length % 2 === 0 ? 'P1' : 'P2')) {
    throw new RangeError('Public turn does not match the accepted prefix.');
  }
  const ranks = Object.keys(PIECE_DISTRIBUTION) as PieceRank[];
  const remaining = {
    RED: ranks.reduce((sum, rank) => sum + counts.RED[rank], 0),
    BLACK: ranks.reduce((sum, rank) => sum + counts.BLACK[rank], 0),
  };
  let hidden = 0;
  for (const square of observation.board) {
    if (square.kind === 'REVEALED') counts[square.piece.color][square.piece.rank] -= 1;
    else if (square.kind === 'HIDDEN') hidden += 1;
  }
  const inventory = [...Object.values(counts.RED), ...Object.values(counts.BLACK)];
  if (
    inventory.some((count) => count < 0) ||
    inventory.reduce((sum, count) => sum + count, 0) !== hidden
  ) {
    throw new RangeError('Public inventory is inconsistent with the accepted prefix.');
  }

  return { counts, remaining };
}

function reconstructPosition({ observation, publicHistory }: PublicProjectionInput): RulePosition {
  // Validate every accepted ply; progress actions do not reset the v4 rolling ledger.
  let position: RulePosition = {
    board: Array.from({ length: 32 }, () => ({ kind: 'HIDDEN' as const })),
    currentPlayer: 'P1',
    playerColors: { P1: null, P2: null },
    status: 'ACTIVE',
    plyCount: 0,
    noProgressCount: 0,
    chase: null,
  };
  const revealedInventory = { RED: { ...PIECE_DISTRIBUTION }, BLACK: { ...PIECE_DISTRIBUTION } };
  const remaining = { RED: 16, BLACK: 16 };
  for (const event of publicHistory) {
    if (event.type === 'FLIP' && --revealedInventory[event.piece.color][event.piece.rank] < 0)
      throw new RangeError('Public reveal inventory exhausted.');
    const action: GameAction =
      event.type === 'FLIP'
        ? { type: 'FLIP', position: event.position }
        : { type: 'MOVE', from: event.from, to: event.to };
    if (getActionError(position, event.playerId, action) !== null)
      throw new RangeError(`Public history ply ${event.ply}: invalid action.`);
    const next = transition(position, action, event.type === 'FLIP' ? event.piece : undefined);
    if (next.prohibited)
      throw new RangeError(`Public history ply ${event.ply}: PERPETUAL_CHASE (v4).`);
    if (JSON.stringify(next.event) !== JSON.stringify(event)) {
      // Compare fields independently of caller property ordering.
      const actual = next.event;
      if (
        actual.type !== event.type ||
        actual.ply !== event.ply ||
        actual.playerId !== event.playerId ||
        !samePiece(actual.piece, event.piece) ||
        (actual.type === 'FLIP' && event.type === 'FLIP' && actual.position !== event.position) ||
        (actual.type === 'MOVE' &&
          event.type === 'MOVE' &&
          (actual.from !== event.from ||
            actual.to !== event.to ||
            (actual.captured === null
              ? event.captured !== null
              : event.captured === null || !samePiece(actual.captured, event.captured))))
      )
        throw new RangeError('Public event metadata does not match replay.');
    }
    if (next.event.type === 'MOVE' && next.event.captured !== null)
      remaining[next.event.captured.color] -= 1;
    const result = outcomeFor(next.position, remaining);
    if (result !== null) throw new RangeError('Active public history reaches a terminal outcome.');
    position = next.position;
  }
  const board = position.board.map((square) =>
    square.kind === 'REVEALED' ? { kind: square.kind, piece: square.piece } : { kind: square.kind },
  );
  if (
    board.some((square, i) => {
      const other = observation.board[i]!;
      return (
        square.kind !== other.kind ||
        (square.kind === 'REVEALED' &&
          (other.kind !== 'REVEALED' || !samePiece(square.piece, other.piece)))
      );
    }) ||
    position.currentPlayer !== observation.currentPlayer ||
    position.playerColors.P1 !== observation.playerColors.P1 ||
    position.playerColors.P2 !== observation.playerColors.P2
  )
    throw new RangeError('Public observation does not match complete history.');
  return position;
}

function hasPermittedAction(position: RulePosition): boolean {
  // Any remaining hidden square permits a FLIP, regardless of chase records.
  if (position.board.some((square) => square.kind === 'HIDDEN')) return true;
  const color = position.playerColors[position.currentPlayer];
  return (
    color !== null &&
    getPublicOrdinaryMoves(position.board, color).some(
      (action) => !transition(position, action).prohibited,
    )
  );
}

function outcomeFor(position: RulePosition, remaining: Readonly<Record<'RED' | 'BLACK', number>>) {
  const color = position.playerColors[position.currentPlayer];
  return evaluateOutcomeFacts(
    {
      currentPlayer: position.currentPlayer,
      noProgressCount: position.noProgressCount,
      nextPlayerHasPieces: color === null || remaining[color] > 0,
    },
    () => hasPermittedAction(position),
    () =>
      position.board.some((s) => s.kind === 'HIDDEN') ||
      (color !== null && getPublicOrdinaryMoves(position.board, color).length > 0),
  );
}

// Opaque, caller-owned public-derived state. No serializable ledger or private identity.
declare const contextBrand: unique symbol;
export interface PublicProjectionContext {
  readonly [contextBrand]: true;
}
type Inventory = Readonly<Record<PieceColor, Readonly<Record<PieceRank, number>>>>;
interface ContextData {
  readonly position: RulePosition;
  readonly counts: Inventory;
  readonly remaining: Readonly<Record<PieceColor, number>>;
}
const contexts = new WeakMap<PublicProjectionContext, ContextData>();
function contextFor(data: ContextData): PublicProjectionContext {
  const handle = Object.freeze({}) as PublicProjectionContext;
  contexts.set(handle, data);
  return handle;
}
export type PublicContextProjectionResult =
  | Extract<PublicProjectionResult, { readonly ok: false }>
  | (Extract<PublicProjectionResult, { readonly ok: true }> & {
      readonly nextContext: PublicProjectionContext;
    });

/** Validate the complete active public prefix once. The context owns its derived copies. */
export function createPublicProjectionContext(
  input: PublicProjectionInput,
): PublicProjectionContext {
  if (input.observation.status !== 'ACTIVE' || input.observation.result !== null)
    throw new RangeError('Projection context requires an active, nonterminal public prefix.');
  const { counts, remaining } = publicInventory(input);
  return contextFor({ position: reconstructPosition(input), counts, remaining });
}

/** Advance exactly one public branch through the same authoritative rules. */
export function projectPublicAction(
  context: PublicProjectionContext,
  action: GameAction,
  reveal?: PublicPiece,
): PublicContextProjectionResult {
  const data = contexts.get(context);
  if (data === undefined) throw new RangeError('Unknown public projection context.');
  const { position } = data;
  const error = getActionError(position, position.currentPlayer, action);
  if (error !== null) return { ok: false, error };
  let counts = data.counts;
  if (action.type === 'FLIP') {
    if (
      typeof reveal !== 'object' ||
      reveal === null ||
      (reveal.color !== 'RED' && reveal.color !== 'BLACK') ||
      !Object.hasOwn(PIECE_DISTRIBUTION, reveal.rank) ||
      counts[reveal.color][reveal.rank] <= 0
    )
      return { ok: false, error: { code: 'INVALID_FLIP' } };
    counts = {
      ...counts,
      [reveal.color]: {
        ...counts[reveal.color],
        [reveal.rank]: counts[reveal.color][reveal.rank] - 1,
      },
    };
  } else if (reveal !== undefined) return { ok: false, error: { code: 'INVALID_ACTION' } };
  const next = transition(position, action, reveal);
  if (next.prohibited) return { ok: false, error: { code: 'PERPETUAL_CHASE' } };
  const remaining = { ...data.remaining };
  if (next.event.type === 'MOVE' && next.event.captured !== null)
    remaining[next.event.captured.color] -= 1;
  const result = outcomeFor(next.position, remaining);
  const status = result === null ? 'ACTIVE' : 'FINISHED';
  const board: PublicSquare[] = next.position.board.map((square) =>
    square.kind === 'REVEALED'
      ? { kind: 'REVEALED', piece: { color: square.piece.color, rank: square.piece.rank } }
      : { kind: square.kind },
  );
  return {
    ok: true,
    observation: {
      board,
      currentPlayer: next.position.currentPlayer,
      playerColors: { ...next.position.playerColors },
      status,
      result,
    },
    event: next.event,
    nextContext: contextFor({ position: { ...next.position, status }, counts, remaining }),
  };
}

/** Compatibility wrapper: fully validate the complete prefix for each call. */
export function projectPermittedPublicAction(
  input: PublicProjectionInput,
  action: GameAction,
  reveal?: PublicPiece,
): PublicProjectionResult {
  if (input.observation.status === 'FINISHED')
    return { ok: false, error: { code: 'GAME_FINISHED' } };
  const result = projectPublicAction(createPublicProjectionContext(input), action, reveal);
  return result.ok ? { ok: true, observation: result.observation, event: result.event } : result;
}
