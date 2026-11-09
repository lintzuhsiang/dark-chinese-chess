import type { Board, ChaseState, GameAction, GameState } from './types';
import { isCaptureThreat } from './validation';

function positionKey(state: GameState): string {
  const squares = state.board.map(square => !square ? 'EMPTY'
    : !square.revealed ? 'HIDDEN' : [square.piece.color, square.piece.rank]);
  return JSON.stringify([state.currentPlayer, state.playerColors.P1, state.playerColors.P2, squares]);
}

function revealedPosition(board: Board, id: string): number {
  return board.findIndex(square => square?.revealed && square.piece.id === id);
}

function newlyThreatenedTarget(before: GameState, after: GameState, from: number, to: number): string | null {
  const targets = after.board.flatMap((square, position) => square?.revealed
    && isCaptureThreat(after.board, to, position)
    && !isCaptureThreat(before.board, from, position)
    && !isCaptureThreat(after.board, position, to)
    ? [square.piece.id] : []);
  return targets.length === 1 ? targets[0]! : null;
}

// Called only for an otherwise legal action and its tentative, next-player state.
export function getChaseUpdate(before: GameState, after: GameState, action: GameAction): {
  readonly prohibited: boolean;
  readonly chase: ChaseState | null;
} {
  if (action.type === 'FLIP' || before.board[action.to] !== null) {
    return { prohibited: false, chase: null };
  }

  const previous = before.chase;
  const mover = before.board[action.from]!;
  if (previous?.phase === 'ESCAPE' && before.currentPlayer !== previous.attackerPlayer
    && mover.piece.id === previous.targetId) {
    const attackerBefore = revealedPosition(before.board, previous.attackerId);
    const attackerAfter = revealedPosition(after.board, previous.attackerId);
    if (isCaptureThreat(before.board, attackerBefore, action.from)
      && attackerAfter !== -1 && !isCaptureThreat(after.board, attackerAfter, action.to)) {
      return { prohibited: false, chase: { ...previous, phase: 'RENEW' } };
    }
  }

  const targetId = newlyThreatenedTarget(before, after, action.from, action.to);
  if (previous?.phase === 'RENEW' && before.currentPlayer === previous.attackerPlayer
    && mover.piece.id === previous.attackerId && targetId === previous.targetId) {
    const key = positionKey(after);
    const appearances = (previous.positionCounts[key] ?? 0) + 1;
    // The first appearance starts a position's cycle; its fourth completes return three.
    if (appearances > 3) return { prohibited: true, chase: previous };
    return {
      prohibited: false,
      chase: { ...previous, phase: 'ESCAPE', positionCounts: { ...previous.positionCounts, [key]: appearances } },
    };
  }

  return {
    prohibited: false,
    chase: targetId === null ? null : {
      attackerPlayer: before.currentPlayer,
      attackerId: mover.piece.id,
      targetId,
      phase: 'ESCAPE',
      positionCounts: { [positionKey(after)]: 1 },
    },
  };
}
