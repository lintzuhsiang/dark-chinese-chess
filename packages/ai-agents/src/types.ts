import type {
  ActionEvent,
  GameAction,
  PlayerId,
  PlayerObservation,
} from '../../game-core/src/index';

export interface AgentInput {
  readonly observation: PlayerObservation;
  readonly legalActions: readonly GameAction[];
  readonly publicHistory: readonly ActionEvent[];
  readonly perspective: PlayerId;
}

export interface GameAgent {
  chooseAction(input: AgentInput, options: { readonly seed: number }): Promise<GameAction>;
}
