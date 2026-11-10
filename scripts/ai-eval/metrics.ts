import { pairedConfidence, percentile } from './statistics';
import type {
  Competitor,
  FailureCategory,
  ScoreSummary,
  TournamentMatch,
  TournamentSummary,
} from './tournament-types';

export function scoreAFromResult(
  match: Pick<TournamentMatch, 'gameResult' | 'seats'>,
): number | null {
  if (match.gameResult === null) return null;
  return match.gameResult.type === 'DRAW'
    ? 0.5
    : match.seats[match.gameResult.winner] === 'A'
      ? 1
      : 0;
}

export function summarizeTournament(
  matches: readonly TournamentMatch[],
  confidenceLevel = 0.95,
): TournamentSummary {
  const pairs = new Map<number, Map<0 | 1, TournamentMatch>>();
  const scores: Record<
    Competitor,
    { wins: number; draws: number; losses: number; points: number }
  > = {
    A: { wins: 0, draws: 0, losses: 0, points: 0 },
    B: { wins: 0, draws: 0, losses: 0, points: 0 },
  };
  const latency: Record<Competitor, number[]> = { A: [], B: [] };
  const illegal: Record<Competitor, number> = { A: 0, B: 0 };
  const errors: Record<Competitor, number> = { A: 0, B: 0 };
  const failures: Record<FailureCategory, number> = {
    INVALID_ACTION: 0,
    AGENT_EXCEPTION: 0,
    RUNNER_INVARIANT: 0,
    TRUNCATED: 0,
  };
  let completedGames = 0;
  let totalLength = 0;
  for (const match of matches) {
    if (
      !Number.isSafeInteger(match.pairIndex) ||
      match.pairIndex < 0 ||
      (match.leg !== 0 && match.leg !== 1)
    ) {
      throw new Error('Invalid pair index or leg.');
    }
    const expectedP1 = match.leg === 0 ? 'A' : 'B';
    const expectedP2 = match.leg === 0 ? 'B' : 'A';
    if (match.seats.P1 !== expectedP1 || match.seats.P2 !== expectedP2) {
      throw new Error('Pair legs must swap the A/B seats.');
    }
    const pair = pairs.get(match.pairIndex) ?? new Map<0 | 1, TournamentMatch>();
    if (pair.has(match.leg)) throw new Error('Duplicate leg in tournament results.');
    const partner = pair.get(match.leg === 0 ? 1 : 0);
    if (partner && (partner.deckSeed !== match.deckSeed || partner.agentSeed !== match.agentSeed)) {
      throw new Error('Pair legs must use the same deck and Agent root seeds.');
    }
    pair.set(match.leg, match);
    pairs.set(match.pairIndex, pair);
    if (!Number.isSafeInteger(match.gameLength) || match.gameLength < 0) {
      throw new Error('Invalid accepted game length.');
    }
    totalLength += match.gameLength;
    const scoreA = scoreAFromResult(match);
    if (match.scoreA !== scoreA || (scoreA === null) !== (match.failure !== null)) {
      throw new Error('GameResult, failure status, and recorded score disagree.');
    }
    if (scoreA !== null) {
      completedGames += 1;
      for (const competitor of ['A', 'B'] as const) {
        const score = competitor === 'A' ? scoreA : 1 - scoreA;
        const tally = scores[competitor];
        tally.points += score;
        if (score === 1) tally.wins += 1;
        else if (score === 0.5) tally.draws += 1;
        else tally.losses += 1;
      }
    } else {
      failures[match.failure!.category] += 1;
    }
    for (const decision of match.report?.decisions ?? []) {
      const competitor = match.seats[decision.playerId];
      latency[competitor].push(decision.durationMs);
      if (decision.status === 'INVALID_ACTION') illegal[competitor] += 1;
      if (decision.status === 'AGENT_ERROR') errors[competitor] += 1;
    }
  }
  const pairScores: number[] = [];
  for (const pair of pairs.values()) {
    const first = pair.get(0);
    const second = pair.get(1);
    if (first && second && first.scoreA !== null && second.scoreA !== null) {
      pairScores.push((first.scoreA + second.scoreA) / 2);
    }
  }
  function scoreSummary(competitor: Competitor): ScoreSummary {
    const { wins, draws, losses, points } = scores[competitor];
    return {
      wins,
      draws,
      losses,
      averageScore: completedGames === 0 ? null : points / completedGames,
    };
  }
  function latencySummary(competitor: Competitor) {
    return {
      decisions: latency[competitor].length,
      p50Ms: percentile(latency[competitor], 0.5),
      p95Ms: percentile(latency[competitor], 0.95),
      illegalActions: illegal[competitor],
      agentErrors: errors[competitor],
    };
  }
  return {
    attemptedGames: matches.length,
    completedGames,
    attemptedPairs: pairs.size,
    completedPairs: pairScores.length,
    scores: { A: scoreSummary('A'), B: scoreSummary('B') },
    averageGameLength: matches.length === 0 ? null : totalLength / matches.length,
    performance: {
      totalDecisions: latency.A.length + latency.B.length,
      illegalActions: illegal.A + illegal.B,
      agentErrors: errors.A + errors.B,
      budgetOverruns: null,
      byAgent: { A: latencySummary('A'), B: latencySummary('B') },
    },
    failures,
    paired: pairedConfidence(pairScores, confidenceLevel),
  };
}
