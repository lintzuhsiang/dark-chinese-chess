import type { ChaseRecord, ChaseState, GameAction, PlayerId } from './types';
import { isCaptureThreat } from './validation';
import { readReference, readSquare, type MovementBoard } from './rule-position';

interface ChasePosition {
  readonly board: MovementBoard;
  readonly currentPlayer: PlayerId;
  readonly plyCount: number;
  readonly chase: ChaseState | null;
}

const CHASE_WINDOW_PLIES = 20;

function newTargets(
  before: MovementBoard,
  after: MovementBoard,
  from: number,
  to: number,
): number[] {
  return after.flatMap((_, target) =>
    isCaptureThreat(after, to, target) &&
    !isCaptureThreat(after, target, to) &&
    !isCaptureThreat(before, from, target)
      ? [target]
      : [],
  );
}

function sameKey(left: ChaseRecord, right: ChaseRecord): boolean {
  return (
    left.attacker === right.attacker &&
    left.target === right.target &&
    left.attackerPosition === right.attackerPosition &&
    left.targetPosition === right.targetPosition
  );
}

// Only called after ordinary validation. Rejection returns the exact previous ledger.
export function getChaseUpdate(
  before: ChasePosition,
  after: ChasePosition,
  action: GameAction,
): { readonly prohibited: boolean; readonly chase: ChaseState | null } {
  const records = (before.chase?.records ?? []).filter(
    (record) => record.ply >= after.plyCount - CHASE_WINDOW_PLIES + 1,
  );
  // Every accepted action ages the window; captures and FLIPs never add threats.
  if (action.type === 'MOVE' && readSquare(before.board, action.to)?.kind === 'EMPTY') {
    const attacker = readReference(before.board, action.from)!;
    for (const targetPosition of newTargets(before.board, after.board, action.from, action.to)) {
      const record: ChaseRecord = {
        attacker,
        target: readReference(after.board, targetPosition)!,
        attackerPosition: action.to,
        targetPosition,
        ply: after.plyCount,
      };
      if (records.filter((previous) => sameKey(previous, record)).length >= 2)
        return { prohibited: true, chase: before.chase };
      // This array is local: a later fork violation cannot consume earlier targets.
      records.push(record);
    }
  }
  return { prohibited: false, chase: records.length === 0 ? null : { records } };
}
