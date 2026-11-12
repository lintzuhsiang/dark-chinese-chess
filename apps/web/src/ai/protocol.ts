import type { GameAction, PlayerId } from '@dark-chess/game-core';
import type { AgentInput } from '../../../../packages/ai-agents/src/types';

export const AGENT_LABELS = {
  'tactical-6a': '戰術搜尋（上限6手）',
  'expected-value': '期望值',
  'safety-tie-1': '期望值＋安全決勝',
  heuristic: '啟發式',
  random: '隨機',
} as const;
export type AgentKind = keyof typeof AGENT_LABELS;

export interface DecisionToken {
  readonly requestId: number;
  readonly generation: number;
  readonly revision: number;
  readonly playerId: PlayerId;
}

export interface WorkerDecisionRequest {
  readonly type: 'CHOOSE_ACTION';
  readonly token: DecisionToken;
  readonly agent: AgentKind;
  readonly input: AgentInput;
  readonly seed: number;
}

export type WorkerDecisionResponse =
  | {
      readonly type: 'ACTION';
      readonly token: DecisionToken;
      readonly action: GameAction;
      readonly durationMs: number;
    }
  | {
      readonly type: 'ERROR';
      readonly token: DecisionToken;
      readonly code: 'AGENT_ERROR';
      readonly durationMs: number;
    };

export type AiFailure =
  | 'UNAVAILABLE'
  | 'WORKER_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'INVALID_ACTION'
  | 'AGENT_ERROR'
  | 'TIMEOUT';

export function sameToken(left: DecisionToken, right: DecisionToken): boolean {
  return (
    left.requestId === right.requestId &&
    left.generation === right.generation &&
    left.revision === right.revision &&
    left.playerId === right.playerId
  );
}

export function sameAction(left: GameAction, right: GameAction): boolean {
  return left.type === 'FLIP'
    ? right.type === 'FLIP' && left.position === right.position
    : right.type === 'MOVE' && left.from === right.from && left.to === right.to;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function counter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function readToken(value: unknown): DecisionToken | null {
  if (
    !record(value) ||
    !counter(value.requestId) ||
    !counter(value.generation) ||
    !counter(value.revision) ||
    (value.playerId !== 'P1' && value.playerId !== 'P2')
  )
    return null;
  return {
    requestId: value.requestId,
    generation: value.generation,
    revision: value.revision,
    playerId: value.playerId,
  };
}

export function readAction(value: unknown): GameAction | null {
  if (!record(value)) return null;
  if (value.type === 'FLIP' && counter(value.position) && value.position < 32)
    return { type: 'FLIP', position: value.position };
  if (
    value.type === 'MOVE' &&
    counter(value.from) &&
    value.from < 32 &&
    counter(value.to) &&
    value.to < 32
  )
    return { type: 'MOVE', from: value.from, to: value.to };
  return null;
}

export function readWorkerResponse(value: unknown): WorkerDecisionResponse | null {
  if (!record(value)) return null;
  const token = readToken(value.token);
  if (
    token === null ||
    typeof value.durationMs !== 'number' ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0
  )
    return null;
  if (value.type === 'ERROR' && value.code === 'AGENT_ERROR')
    return { type: 'ERROR', token, code: 'AGENT_ERROR', durationMs: value.durationMs };
  const action = readAction(value.action);
  return value.type === 'ACTION' && action !== null
    ? { type: 'ACTION', token, action, durationMs: value.durationMs }
    : null;
}
