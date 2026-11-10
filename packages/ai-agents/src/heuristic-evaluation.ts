import {
  getPublicOrdinaryMoves,
  PIECE_DISTRIBUTION,
  type ActionEvent,
  type PieceColor,
  type PieceRank,
  type PlayerId,
  type PlayerObservation,
} from '../../game-core/src/index';

export interface HeuristicWeights {
  readonly material: number;
  readonly threat: number;
  readonly mobility: number;
}

export interface HeuristicConfiguration {
  readonly pieceValues?: Partial<Readonly<Record<PieceRank, number>>>;
  readonly weights?: Partial<HeuristicWeights>;
}

export interface ResolvedHeuristicConfiguration {
  readonly pieceValues: Readonly<Record<PieceRank, number>>;
  readonly weights: HeuristicWeights;
}

// Experimental values, fixed before evaluation; these are not capture-rule ranks.
export const DEFAULT_HEURISTIC_CONFIGURATION: ResolvedHeuristicConfiguration = Object.freeze({
  pieceValues: Object.freeze({
    GENERAL: 8,
    ADVISOR: 6,
    ELEPHANT: 5,
    CHARIOT: 4,
    HORSE: 3,
    CANNON: 5,
    SOLDIER: 2,
  }),
  weights: Object.freeze({ material: 1, threat: 0.5, mobility: 0.05 }),
});

export interface FeatureBreakdown {
  readonly friendly: number;
  readonly enemy: number;
  readonly raw: number;
  readonly normalized: number;
  readonly weight: number;
  readonly contribution: number;
}

export interface EvaluationBreakdown {
  readonly perspective: PlayerId;
  readonly color: PieceColor | null;
  readonly terminal: boolean;
  readonly material: FeatureBreakdown;
  readonly threat: FeatureBreakdown;
  readonly mobility: FeatureBreakdown;
  readonly total: number;
}

export interface PositionEvaluationInput {
  readonly observation: PlayerObservation;
  readonly publicHistory: readonly ActionEvent[];
  readonly perspective: PlayerId;
}

export function resolveHeuristicConfiguration(
  configuration: HeuristicConfiguration = {},
): ResolvedHeuristicConfiguration {
  const pieceValues = {
    ...DEFAULT_HEURISTIC_CONFIGURATION.pieceValues,
    ...configuration.pieceValues,
  };
  const weights = { ...DEFAULT_HEURISTIC_CONFIGURATION.weights, ...configuration.weights };
  if (Object.values(pieceValues).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError('Heuristic piece values must be finite and positive.');
  }
  if (Object.values(weights).some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Heuristic weights must be finite and nonnegative.');
  }
  if (!Number.isFinite(initialMaterial(pieceValues)) || !Number.isFinite(weightTotal(weights))) {
    throw new RangeError('Heuristic configuration totals must be finite.');
  }
  return Object.freeze({
    pieceValues: Object.freeze(pieceValues),
    weights: Object.freeze(weights),
  });
}

function weightTotal(weights: HeuristicWeights): number {
  return weights.material + weights.threat + weights.mobility;
}

function initialMaterial(pieceValues: Readonly<Record<PieceRank, number>>): number {
  return (Object.keys(PIECE_DISTRIBUTION) as PieceRank[]).reduce(
    (sum, rank) => sum + PIECE_DISTRIBUTION[rank] * pieceValues[rank],
    0,
  );
}

function remainingMaterial(
  history: readonly ActionEvent[],
  values: Readonly<Record<PieceRank, number>>,
): Record<PieceColor, number> {
  const counts = { RED: { ...PIECE_DISTRIBUTION }, BLACK: { ...PIECE_DISTRIBUTION } };
  for (const event of history) {
    if (event.type !== 'MOVE' || event.captured === null) continue;
    const { color, rank } = event.captured;
    counts[color][rank] -= 1;
    if (counts[color][rank] < 0) {
      throw new RangeError('Public capture history exceeds the initial piece distribution.');
    }
  }
  const value = (color: PieceColor): number =>
    (Object.keys(PIECE_DISTRIBUTION) as PieceRank[]).reduce(
      (sum, rank) => sum + counts[color][rank] * values[rank],
      0,
    );
  return { RED: value('RED'), BLACK: value('BLACK') };
}

function tacticalFeatures(
  observation: PlayerObservation,
  attacker: PieceColor,
  values: Readonly<Record<PieceRank, number>>,
): { threatenedValue: number; quietMoves: number } {
  const threatened = new Set<number>();
  let quietMoves = 0;
  for (const action of getPublicOrdinaryMoves(observation.board, attacker)) {
    const target = observation.board[action.to]!;
    if (target.kind === 'EMPTY') quietMoves += 1;
    else if (target.kind === 'REVEALED') threatened.add(action.to);
  }
  let threatenedValue = 0;
  for (const position of threatened) {
    const target = observation.board[position]!;
    if (target.kind === 'REVEALED') threatenedValue += values[target.piece.rank];
  }
  return { threatenedValue, quietMoves };
}

function feature(
  friendly: number,
  enemy: number,
  scale: number,
  weight: number,
  denominator: number,
  direction = 1,
): FeatureBreakdown {
  const difference = friendly - enemy;
  const raw = difference === 0 ? 0 : direction * difference;
  // Bounds also keep terminal results dominant for unusual public test fixtures.
  const normalized = Math.max(-1, Math.min(1, raw / scale));
  return {
    friendly,
    enemy,
    raw,
    normalized,
    weight,
    contribution: normalized === 0 || weight === 0 ? 0 : normalized * (weight / denominator),
  };
}

/** Structural evaluation only: no hidden identities, chase adjudication, or predicted outcomes. */
export function evaluatePosition(
  input: PositionEvaluationInput,
  configuration: HeuristicConfiguration = {},
): EvaluationBreakdown {
  const { pieceValues, weights } = resolveHeuristicConfiguration(configuration);
  const { observation, publicHistory, perspective } = input;
  const color = observation.playerColors[perspective];
  const denominator = Math.max(1, weightTotal(weights));
  const scale = initialMaterial(pieceValues);
  const neutral = (weight: number): FeatureBreakdown => feature(0, 0, 1, weight, denominator);
  let material = neutral(weights.material);
  let threat = neutral(weights.threat);
  let mobility = neutral(weights.mobility);
  if (color !== null) {
    const enemyColor = color === 'RED' ? 'BLACK' : 'RED';
    const remaining = remainingMaterial(publicHistory, pieceValues);
    const friendlyTactics = tacticalFeatures(observation, color, pieceValues);
    const enemyTactics = tacticalFeatures(observation, enemyColor, pieceValues);
    material = feature(
      remaining[color],
      remaining[enemyColor],
      scale,
      weights.material,
      denominator,
    );
    // Friendly/enemy are the VALUES EXPOSED on each side, not attacker-edge counts.
    threat = feature(
      enemyTactics.threatenedValue,
      friendlyTactics.threatenedValue,
      scale,
      weights.threat,
      denominator,
      -1,
    );
    // At most 16 pieces * 4 adjacent quiet moves per side on a valid board.
    mobility = feature(
      friendlyTactics.quietMoves,
      enemyTactics.quietMoves,
      64,
      weights.mobility,
      denominator,
    );
  }
  const terminal = observation.status === 'FINISHED';
  if (terminal && observation.result === null)
    throw new RangeError('Finished observation requires GameResult.');
  const total = terminal
    ? observation.result!.type === 'DRAW'
      ? 0
      : observation.result!.winner === perspective
        ? 2
        : -2
    : material.contribution + threat.contribution + mobility.contribution;
  return { perspective, color, terminal, material, threat, mobility, total };
}
