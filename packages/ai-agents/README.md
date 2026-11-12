# Public-information Agents

Random, Heuristic, and Expected Value Agents implement the same GameAgent interface. Policies receive
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

## AI-4 public hidden inventory and Expected Value policy

`getHiddenPieceDistribution({ observation, publicHistory })` returns totalHidden
and positive-count `{ piece: { color, rank }, count, probability }` outcomes.
Counts equal initial inventory minus public captures minus currently revealed
pieces. Historical FLIPs are not deducted a second time. The same marginal
distribution applies to each hidden square under uniform shuffling without
remembered undone disclosures. It uses no deck seed, hidden identity, or piece ID.

The helper rejects negative counts or inventory totals inconsistent with the
number of hidden squares. Zero hidden squares produce an empty outcome list.
It is independent of evaluation weights; probability will weight successor values.

The helper does not adjudicate hypothetical outcomes or change Heuristic behavior.

`createExpectedValueAgent(configuration?)` captures the same values/weights as the
Heuristic; `expectedValueAgent` uses defaults. `explainExpectedValueDecision(input,
{ seed }, configuration?)` returns the current breakdown, distribution, each
candidate's expected score, all FLIP outcome breakdowns/probability contributions,
and the selected action.

For every supplied MOVE, the approved Core `projectPermittedPublicAction` query
returns the exact public successor/event/GameResult. For each supplied FLIP,
enumerate only positive-count color/rank outcomes and project each through the
same Core query. Append the projected public event, keep perspective fixed, and
evaluate with the same Material/Threat/Mobility weights. MOVE score is V(successor);
FLIP score is the sum of probability times V(successor). Choose the maximum using
the decision seed only for exact score ties. There is no FLIP fallback or separate
reveal/material/information bonus.

First-FLIP branches assign colors and advance the turn through shared Core logic.
Terminal branch GameResult overrides features with +2/-2/0 for the original player.
No other hidden square is assigned an identity. No reply, search, sampling, time
budget, Worker, or backend is introduced. Public history must be the complete
accepted prefix; Core reconstructs only its quiet suffix for chase/counter context.
See the [approved projection boundary](../../docs/ai-4-public-projection-proposal.md).

AI-3 retains its existing partial MOVE projection and seeded FLIP fallback for a
stable baseline. EV comparisons therefore include both FLIP outcome weighting and
exact hypothetical terminal handling; they are not an isolated FLIP-only ablation.
The static evaluator still does not model the opponent's next reply or longer-term
information value. Strength and latency must be assessed through paired benchmarks.

The approved Core extraction is committed and pinned. Controlled comparisons use
unchanged default weights, 100 pairs each, and fresh deck ranges:

```sh
node --import ./scripts/ai-eval/register.mjs ./scripts/ai-eval/cli.ts \
  --agent-a expected-value --agent-b heuristic --pairs 100 --deck-start 20000 \
  --agent-seed 20261110 --output benchmark-results/expected-value-vs-heuristic.json
node --import ./scripts/ai-eval/register.mjs ./scripts/ai-eval/cli.ts \
  --agent-a expected-value --agent-b random --pairs 100 --deck-start 30000 \
  --agent-seed 20261110 --output benchmark-results/expected-value-vs-random.json
```

The Phase 2 plan records measured results and limitations. Raw reports are ignored
artifacts containing the precise executed source/configuration and seeds.

## Verification and benchmark

### SAFETY-TIE-1 experiment

`createSafetyTieAgent(configuration?)` / `safetyTieAgent` preserve the original EV
scorer and configuration. `explainSafetyTieDecision(input, { seed }, configuration?)`
adds `safetyTie: { applied, checks }`; each check records a tied MOVE and the first
legal opponent capture winning immediately, or null when none exists.

Only two or more exactly top-scoring candidates, all MOVEs, qualify. Project each
through Core, then project ordinary opponent captures through Core. If some tied
choices avoid an immediate opponent capture win, remove the losing choices and
use the original first seeded sample over the remaining order. Already terminal
successors require no reply. All-safe/all-unsafe sets retain the original choice;
unique best actions and mixed MOVE/FLIP ties are unchanged. Scores, FLIP probabilities,
values, and weights are identical to EV. Null is a narrow check, not proof of safety.

The original EV exports remain the comparison baseline. This variant does not
detect quiet/FLIP winning replies, nonterminal losses, or a strictly higher-scored
sacrifice. The recorded fatal 10→14 tie now selects 10→9. No strength improvement
is claimed without a fresh paired comparison. Browser selection is opt-in under
**期望值＋安全決勝**; the CLI name is `safety-tie-1`.

Focused policy/Core tests can run directly:

```sh
node_modules/.bin/vitest run packages/game-core/tests packages/ai-agents/tests apps/web/tests
```

These tests include direct Core-applied complete games and replay. The AI-3 shared
Core extraction was committed and pinned at b779f98101e95b9aff925c920e0021dda5cd6835.
The subsequent approved AI-4 Core-only projection commit and current pin are
b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75. The existing strict guard checks Core/rules
against this commit; no bypass was introduced. The remaining EV implementation,
CLI, and documentation can be uncommitted and are captured in benchmark manifests.

The controlled Heuristic-versus-Random comparison command is:

```sh
node --import ./scripts/ai-eval/register.mjs ./scripts/ai-eval/cli.ts \
  --agent-a heuristic --agent-b random --pairs 100 --deck-start 10000 \
  --agent-seed 20261110 --output benchmark-results/heuristic-vs-random.json
```

Interpret strength only from recorded benchmarks and their uncertainty. Public
outcome/chase projection belongs to Core; no separate AI rule engine, search,
broad position/geometry features, UI, Worker, or backend is introduced.

## AI-6A selective tactical search

`createTacticalAgent({ search?, evaluation? })` captures immutable limits/evaluator
configuration; `tacticalAgent` uses defaults. `explainTacticalDecision(input,
{ seed }, configuration?)` returns the selected action, unchanged full-root EV
baseline, every root's coverage/score, completed iterations, public tree rows and
budget/branching diagnostics. The callable GameAgent contract is unchanged.

Default limits: maximum6 action plies,8,192 Core projection attempts, root width8,
interior width4. Tactical ordering prioritizes actor wins, recaptures, defense,
captures and threats using existing public information. Best-EV and best-FLIP root
reserves protect alternatives; every terminal action is retained even beyond width.
These are ordering/coverage choices, not evaluation bonuses or weight changes.

All positive public reveal outcomes are evaluated for each retained FLIP. The
opponent minimizes the original player's value among retained choices. A completed
common-horizon iteration replaces the previous choice; budget interruption never
publishes partial chance averages or a partial root iteration. If depth2 cannot
complete, the original EV callable's exact choice is returned. Its preliminary
projections are counted too. Alpha-beta never averages cutoff bounds at chance nodes.

Only public inputs enter `searchPublicPosition`; the optional bounded/pure leaf
callable permits later evaluation research without a general search framework.
Terminal GameResult always overrides the callable. No hidden identities, private
states, deck seeds, MCTS, progress or geometry feature is introduced.

Read completed depth and branch coverage, not just the maximum6 setting. Search
is selective and can omit important replies; it does not prove a forced win
against omitted actions. The opening can remain one-ply EV. Browser/CLI identity:
`tactical-6a`. Original EV remains the browser default and frozen control. See
[AI-6A results and limitations](../../docs/ai-6a-evaluation.md).

## AI-6B progress experiment

`progressAgent` / `explainProgressDecision` reuse the frozen6A search and public
contexts. Only late nonterminal material advantage is discounted as quiet plies
approach60; terminal values, chance handling and all search limits stay fixed.
`progress-6b` is an opt-in CLI strategy. EV remains the browser default. See
[AI-6B/6C evidence](../../docs/ai-6bc-implementation.md); the small held-out cohort
does not establish a strength gain.

## AI-6C strategic experiments

`explainStrategicDecision(input, options, features)` and `createStrategicAgent`
reuse frozen6B. Independent switches are `proximity`, `blockers` and `cannon`;
all default off, and `STRATEGIC_PRESETS` enables one at a time. Terminal values,
root EV/fallback, chance probabilities and search limits remain unchanged.
Each normalized feature has fixed weight0.03. These are public positional
heuristics, not legal-action queries or proof of a forced win.

CLI policies: `strategic-6c-proximity`, `strategic-6c-blockers`,
`strategic-6c-cannon`. They are experimental, not browser defaults. Compare each
against `progress-6b`; see the source-frozen ablation/latency evidence in
[AI-6B/6C](../../docs/ai-6bc-implementation.md). Candidate selection and promotion
are evidence decisions, not additional game rules.
