import type { ChaseState, GameAction, PlayerColors, PlayerId } from './types';
import { isCaptureThreat } from './validation';
import { readReference, readSquare, type MovementBoard } from './rule-position';

interface ChasePosition {
  readonly board: MovementBoard;
  readonly currentPlayer: PlayerId;
  readonly playerColors: PlayerColors;
  readonly chase: ChaseState | null;
}

function positionKey(state: ChasePosition): string {
  const squares = state.board.map((_, position) => {
    const square = readSquare(state.board, position)!;
    return square.kind === 'REVEALED' ? [square.piece.color, square.piece.rank] : square.kind;
  });
  return JSON.stringify([
    state.currentPlayer,
    state.playerColors.P1,
    state.playerColors.P2,
    squares,
  ]);
}

function revealedPosition(board: MovementBoard, id: string): number {
  return board.findIndex((_, position) => readReference(board, position) === id);
}

function newlyThreatenedTarget(
  before: ChasePosition,
  after: ChasePosition,
  from: number,
  to: number,
): string | null {
  const targets = after.board.flatMap((_, position) =>
    readSquare(after.board, position)?.kind === 'REVEALED' &&
    isCaptureThreat(after.board, to, position) &&
    !isCaptureThreat(before.board, from, position) &&
    !isCaptureThreat(after.board, position, to)
      ? [readReference(after.board, position)!]
      : [],
  );
  return targets.length === 1 ? targets[0]! : null;
}

// Called only for an otherwise legal action and its tentative, next-player state.
export function getChaseUpdate(
  before: ChasePosition,
  after: ChasePosition,
  action: GameAction,
): {
  readonly prohibited: boolean;
  readonly chase: ChaseState | null;
} {
  if (action.type === 'FLIP' || readSquare(before.board, action.to)?.kind !== 'EMPTY') {
    return { prohibited: false, chase: null };
  }

  const previous = before.chase;
  const moverId = readReference(before.board, action.from)!;
  if (
    previous?.phase === 'ESCAPE' &&
    before.currentPlayer !== previous.attackerPlayer &&
    moverId === previous.targetId
  ) {
    const attackerBefore = revealedPosition(before.board, previous.attackerId);
    const attackerAfter = revealedPosition(after.board, previous.attackerId);
    if (
      isCaptureThreat(before.board, attackerBefore, action.from) &&
      attackerAfter !== -1 &&
      !isCaptureThreat(after.board, attackerAfter, action.to)
    ) {
      return { prohibited: false, chase: { ...previous, phase: 'RENEW' } };
    }
  }

  const targetId = newlyThreatenedTarget(before, after, action.from, action.to);
  if (
    previous?.phase === 'RENEW' &&
    before.currentPlayer === previous.attackerPlayer &&
    moverId === previous.attackerId &&
    targetId === previous.targetId
  ) {
    const key = positionKey(after);
    const appearances = (previous.positionCounts[key] ?? 0) + 1;
    // The first appearance starts a position's cycle; its fourth completes return three.
    if (appearances > 3) return { prohibited: true, chase: previous };
    return {
      prohibited: false,
      chase: {
        ...previous,
        phase: 'ESCAPE',
        positionCounts: { ...previous.positionCounts, [key]: appearances },
      },
    };
  }

  return {
    prohibited: false,
    chase:
      targetId === null
        ? null
        : {
            attackerPlayer: before.currentPlayer,
            attackerId: moverId,
            targetId,
            phase: 'ESCAPE',
            positionCounts: { [positionKey(after)]: 1 },
          },
  };
}
