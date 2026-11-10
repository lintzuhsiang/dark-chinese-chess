import { getLegalActions, getObservation } from '../../packages/game-core/src/index';
import type {
  ActionEvent,
  GameAction,
  GameState,
  PlayerId,
  PublicPiece,
} from '../../packages/game-core/src/index';
import type { AgentInput } from '../../packages/ai-agents/src/index';

function publicPiece(piece: PublicPiece): PublicPiece {
  return { color: piece.color, rank: piece.rank };
}

function publicEvent(event: ActionEvent): ActionEvent {
  return event.type === 'FLIP'
    ? {
        ply: event.ply,
        playerId: event.playerId,
        type: 'FLIP',
        position: event.position,
        piece: publicPiece(event.piece),
      }
    : {
        ply: event.ply,
        playerId: event.playerId,
        type: 'MOVE',
        from: event.from,
        to: event.to,
        piece: publicPiece(event.piece),
        captured: event.captured === null ? null : publicPiece(event.captured),
      };
}

function freezePublic<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezePublic);
    Object.freeze(value);
  }
  return value;
}

// Trusted adapter only. Never export it from the policy package or provide its
// state argument/access to this closure to an Agent.
export function createAgentInput(
  state: GameState,
  publicHistory: readonly ActionEvent[],
  perspective: PlayerId,
): AgentInput {
  if (state.status !== 'ACTIVE' || state.result !== null) {
    throw new Error('Agent input requires an active, nonterminal game.');
  }
  if (perspective !== state.currentPlayer) {
    throw new Error('Agent perspective must be the current player.');
  }
  if (
    publicHistory.length !== state.plyCount ||
    publicHistory.some((event, index) => event.ply !== index + 1)
  ) {
    throw new Error('Public history must be the complete accepted prefix.');
  }
  const legalActions: GameAction[] = getLegalActions(state, perspective).map((action) =>
    action.type === 'FLIP'
      ? { type: 'FLIP', position: action.position }
      : { type: 'MOVE', from: action.from, to: action.to },
  );
  if (legalActions.length === 0) {
    throw new Error('Active game has no permitted actions.');
  }
  const observation = getObservation(state);
  return freezePublic({
    observation: {
      board: observation.board.map((square) =>
        square.kind === 'REVEALED'
          ? { kind: 'REVEALED' as const, piece: publicPiece(square.piece) }
          : { kind: square.kind },
      ),
      currentPlayer: observation.currentPlayer,
      playerColors: {
        P1: observation.playerColors.P1,
        P2: observation.playerColors.P2,
      },
      status: observation.status,
      result: null,
    },
    legalActions,
    publicHistory: publicHistory.map(publicEvent),
    perspective,
  });
}
