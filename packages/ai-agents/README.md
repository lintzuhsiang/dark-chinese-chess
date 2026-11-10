# Public-information Agents

Random and Heuristic Agents implement the same GameAgent interface. Policies receive
only PlayerObservation, permitted GameActions, accepted public ActionEvents, fixed
PlayerId perspective, and a derived decision seed.

## Heuristic API

- createHeuristicAgent(configuration?): captures a frozen configuration and returns GameAgent.
- heuristicAgent: default configuration.
- evaluatePosition({ observation, publicHistory, perspective }, configuration?): EvaluationBreakdown.
- explainDecision(input, { seed }, configuration?): selected action, reason, current breakdown,
  and each permitted MOVE's structural evaluation/gain.

Default experimental piece values are General 8, Advisor 6, Elephant 5, Chariot 4,
Horse 3, Cannon 5, and Soldier 2. They are evaluation values, not capture ranks.
Weights are Material 1, Threat/Safety 0.5, and Quiet Mobility 0.05.
All values/weights are explicit and configurable; values must be finite/positive,
weights finite/nonnegative, and aggregate scales finite.

## Features and perspective

Material counts each color's initial inventory minus accepted public captures.
Hidden survivors remain included; revealing changes no material. Board omissions
alone do not establish captures.

The shared Core getPublicOrdinaryMoves query supplies both colors' ordinary moves
and captures without turn/chase filtering. Capture targets are deduplicated by
public destination square. Threat/Safety records friendly/enemy exposed victim
values, with raw score enemy exposure minus friendly exposure. Quiet Mobility counts
only empty-destination moves, excluding captures and FLIPs to avoid feature overlap.
Every candidate recomputes all threats, including discovered Cannon attacks.

Material and threat differences are normalized by initial per-color material (64
with defaults); mobility difference is normalized by 64. Contributions divide by
max(1, sum of weights), keeping active structural scores within [-1,1].
Breakdowns expose friendly/enemy values, raw/normalized difference, weight, and
contribution. Before color assignment all features are neutral.

Actual finished observations use GameResult: fixed-perspective win +2, loss -2,
draw 0. This remains independent of currentPlayer and feature weights.

## Decision flow and FLIP fallback

1. Validate the current turn, nonterminal status, nonempty permitted actions, and seed.
2. Evaluate the current public position.
3. For each supplied MOVE, copy the public board, relocate the revealed piece,
   append its known public capture/quiet event, and compute a structural score.
4. If there is no MOVE, choose a supplied FLIP using the seed.
5. If FLIPs remain and no MOVE strictly improves the current score, choose a seeded FLIP.
6. Otherwise choose the best MOVE, breaking exact ties with the seed.

Returned actions are fresh copies of supplied actions. No new legality rules are
implemented in the policy. A MOVE board/event patch is deliberately partial: it
does not adjudicate chase, counters, immobilization, or a hypothetical GameResult.
Its terminal flag does not predict whether the real move will end the game.
Only authoritative Core can make that determination after acceptance.

This policy does not evaluate FLIP probabilities, information value, or expected
utility. FLIPs are an explicit fallback rather than scores comparable with MOVE
outcomes. Expected-value comparison belongs to AI-4.

## Verification and benchmark

Focused policy/Core tests can run directly:

```sh
node_modules/.bin/vitest run packages/game-core/tests packages/ai-agents/tests apps/web/tests
```

These tests include direct Core-applied complete games and replay. The approved
shared Core extraction is committed and pinned at
b779f98101e95b9aff925c920e0021dda5cd6835. The existing strict guard checks this pin;
it was not bypassed to permit dirty Core changes.

The controlled Heuristic-versus-Random comparison command is:

```sh
node --import ./scripts/ai-eval/register.mjs ./scripts/ai-eval/cli.ts \
  --agent-a heuristic --agent-b random --pairs 100 --deck-start 10000 \
  --agent-seed 20261110 --output benchmark-results/heuristic-vs-random.json
```

Interpret strength only from the recorded benchmark and its uncertainty. No search, public outcome/chase
engine, broad position/geometry features, UI, Worker, or backend is introduced.
