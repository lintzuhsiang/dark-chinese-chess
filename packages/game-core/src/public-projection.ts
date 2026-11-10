import { getChaseUpdate } from './chase';
import { evaluateOutcomeFacts } from './outcomes';
import { PIECE_DISTRIBUTION } from './piece-distribution';
import type { ReferencedSquare, RulePosition } from './rule-position';
import { actionMetadata } from './transition';
import type {
  GameAction,
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
  // FLIPs and captures reset chase and the quiet counter. Only the quiet suffix
  // needs reconstruction. No initial deck, private IDs, or hidden types are built.
  let start = publicHistory.length;
  while (start > 0) {
    const event = publicHistory[start - 1]!;
    if (event.type !== 'MOVE' || event.captured !== null) break;
    start -= 1;
  }
  const board: ReferencedSquare[] = observation.board.map((square, index) =>
    square.kind === 'REVEALED'
      ? {
          kind: 'REVEALED',
          piece: { color: square.piece.color, rank: square.piece.rank },
          reference: `visible-${index}`,
        }
      : { kind: square.kind },
  );
  for (let index = publicHistory.length - 1; index >= start; index -= 1) {
    const event = publicHistory[index]!;
    if (event.type !== 'MOVE') throw new RangeError('Expected a quiet MOVE suffix.');
    const target = board[event.to];
    if (
      target?.kind !== 'REVEALED' ||
      board[event.from]?.kind !== 'EMPTY' ||
      !samePiece(target.piece, event.piece)
    ) {
      throw new RangeError('Public board does not match the accepted quiet suffix.');
    }
    board[event.from] = target;
    board[event.to] = { kind: 'EMPTY' };
  }
  let position: RulePosition = {
    board,
    currentPlayer: start % 2 === 0 ? 'P1' : 'P2',
    playerColors: { ...observation.playerColors },
    status: observation.status,
    plyCount: start,
    noProgressCount: 0,
    chase: null,
  };
  for (const event of publicHistory.slice(start)) {
    if (event.type !== 'MOVE') throw new RangeError('Expected a quiet MOVE suffix.');
    const action: GameAction = { type: 'MOVE', from: event.from, to: event.to };
    if (getActionError(position, position.currentPlayer, action) !== null) {
      throw new RangeError('Public history contains an invalid quiet MOVE.');
    }
    const next = transition(position, action);
    if (next.prohibited) throw new RangeError('Public history contains a prohibited chase return.');
    position = next.position;
  }
  return position;
}

function hasPermittedAction(position: RulePosition): boolean {
  // Any remaining hidden square permits a FLIP; revealing always resets chase.
  if (position.board.some((square) => square.kind === 'HIDDEN')) return true;
  const color = position.playerColors[position.currentPlayer];
  return (
    color !== null &&
    getPublicOrdinaryMoves(position.board, color).some(
      (action) => !transition(position, action).prohibited,
    )
  );
}

/**
 * One public branch of a permitted action. Input must describe the same complete
 * accepted prefix. FLIP requires a positive-inventory public reveal outcome.
 * The authoritative host must still validate any eventual action submission.
 */
export function projectPermittedPublicAction(
  input: PublicProjectionInput,
  action: GameAction,
  reveal?: PublicPiece,
): PublicProjectionResult {
  if (input.observation.status === 'FINISHED')
    return { ok: false, error: { code: 'GAME_FINISHED' } };
  const { counts, remaining } = publicInventory(input);
  const position = reconstructPosition(input);
  const error = getActionError(position, position.currentPlayer, action);
  if (error !== null) return { ok: false, error };
  if (action.type === 'FLIP') {
    if (
      typeof reveal !== 'object' ||
      reveal === null ||
      (reveal.color !== 'RED' && reveal.color !== 'BLACK') ||
      !Object.hasOwn(PIECE_DISTRIBUTION, reveal.rank) ||
      counts[reveal.color][reveal.rank] <= 0
    ) {
      return { ok: false, error: { code: 'INVALID_FLIP' } };
    }
  } else if (reveal !== undefined) {
    return { ok: false, error: { code: 'INVALID_ACTION' } };
  }
  const next = transition(position, action, reveal);
  if (next.prohibited) return { ok: false, error: { code: 'PERPETUAL_CHASE' } };
  if (next.event.type === 'MOVE' && next.event.captured !== null) {
    remaining[next.event.captured.color] -= 1;
  }
  const nextColor = next.position.playerColors[next.position.currentPlayer];
  const result = evaluateOutcomeFacts(
    {
      currentPlayer: next.position.currentPlayer,
      noProgressCount: next.position.noProgressCount,
      nextPlayerHasPieces: nextColor === null || remaining[nextColor] > 0,
    },
    () => hasPermittedAction(next.position),
  );
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
      status: result === null ? 'ACTIVE' : 'FINISHED',
      result,
    },
    event: next.event,
  };
}
