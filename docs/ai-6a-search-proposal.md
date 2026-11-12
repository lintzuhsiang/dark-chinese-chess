# AI-6A — Search design and approval boundary

2026-11-11. **Approved; AI-6A implemented and verified as a selective baseline.** AI-6B depends on verified AI-6A;
AI-6C depends on verified AI-6B. The owner supplied all three briefs, including
AI-6A's explicit architecture gate. No search baseline existed at preflight; the verified implementation is recorded in the evaluation report.

## Baseline and measured constraint

- Clean starting checkout: `76fed95` on `phase-2`, including frozen EV and
  SAFETY-TIE-1. Current Core pin is
  `b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75`; strict baseline guard passes.
- Current EV is one-ply chance-weighted evaluation, not adversarial search.
  `expected-value-agent.ts` lines 100–124 enumerate public reveal outcomes and
  evaluate successors. Its later safety guard checks only immediate capture wins
  in all-MOVE exact top ties. Neither is a verified AI-6A baseline.
- The existing Core public projector already validates hypothetical actions,
  reconstructs chase/quiet context, assigns colors, and determines terminal results.
  No shared Core contract or rule change is proposed.
- The public opening has 32 FLIPs and 14 positive color/rank types: 448 first-ply
  chance branches. Summing the next FLIP locations and updated distributions gives
  **192,448 second-ply FLIP branches**, excluding additional MOVE possibilities.
  Calculation: `32 * 31 * (2 * 13 + 12 * 14)`. Revealing either unique General
  removes one outcome type; revealing any other type leaves all 14 types possible.
- Local Node 26.10.0/Darwin arm64 probe: 448 projections took approximately
  3.81 ms; twelve original EV calls took 1.91–4.54 ms. These are opening-only local
  samples, not browser latency, full second-ply timing, or strength measurements.

Reproduce without submitting actions or running matches:

```sh
node --import ./scripts/ai-eval/register.mjs ./scripts/ai-eval/ai6-preflight.ts
```

The probe uses the existing Runner's public request only, asserts exact opening
counts, offered-action membership and input immutability, and prints timings.
Its shuffled deck never enters the calculation or policy. Seed50000 is only an
opening probe, not a strength-evaluation sample. Raw output is ignored at
`benchmark-results/ai6-preflight.json`.

## 1. Proposed algorithm

Implement a small public-position **selective expectiminimax** module, with a
maximum of six action plies: AI, opponent, AI, opponent, AI, opponent, then evaluation.
Terminal results stop earlier. No additional leaf action is taken as a seventh ply.

1. Compute exact one-ply EV for every offered root action, retaining original EV
   as the complete depth1 fallback. Do not change its exports or weights.
2. Retain the best eight root actions for deeper search. At interior decision
   nodes retain the best four actions. Rank by one-ply expected value, maximizing
   or minimizing for the original player's fixed perspective; break ordering ties
   by stable action order. Additionally retain every action with a terminal
   successor/outcome, even if this exceeds the nominal width. Diagnostics report
   actual retained/omitted counts. Capture/threat labels explain ordering; no new
   geometry feature or material tuning is introduced.
3. Iteratively deepen that selective tree through depths2–6. At each decision
   node maximize for the original player and minimize for the opponent. Leaves
   use the existing `evaluatePosition` underlying EV: Material, Threat/Safety,
   Mobility, and GameResult +2/-2/0 from the original perspective.
4. Keep a root iteration only when all its retained candidates/chance outcomes
   have been resolved at the common requested horizon, allowing terminal stops.
   Discard an interrupted iteration; use the last complete iteration, or original
   EV if depth2 never completes. Do not compare an unfinished deep candidate
   directly against a shallower candidate.
5. Seed only final exact-score ties. No wall-clock, deck seed, or presentation
   randomness enters ordering, budgets, values, or the chosen action.

This searches the opponent's best **retained** reply; action omission prevents a
claim of globally best replies or a full-width forced win. Top-K can omit a vital
defense, FLIP location, or a move with a temporarily poor static score. Root
alternatives excluded from deeper search remain visible in diagnostics, but are
not treated as equally searched alternatives. Even terminal-looking results in
the selective tree are not proofs against omitted actions.

## 2. Public successor representation and legality

Each node contains only `{ observation, publicHistory, perspective }`, with the
same fixed original perspective at every depth. Append the projected public event
to create a child. No sampled complete board, physical ID, private state, or deck
seed is constructed or passed into search.

Root actions come exclusively from supplied `legalActions`. For a hypothetical
node, enumerate ordinary candidates with Core `getPublicOrdinaryMoves` for the
current player's assigned color, plus FLIP candidates at public HIDDEN squares.
Validate/project candidates through `projectPermittedPublicAction`. Filter Core's
`PERPETUAL_CHASE` rejections; treat unexpected errors as invariant failures. All
positive FLIP outcomes must validate. With null colors only FLIPs are candidates.
This composes existing Core APIs rather than duplicating move/chase rules.

Differential tests will compare these hypothetical permitted sets and all public
successors to authoritative `getLegalActions`/`applyAction` on trusted fixtures:
opening, both colors/seats, captures, General/Soldier, Cannons, chase prohibitions
and chase-only immobilization, quiet59/60 and terminal priority. Real state is
available to the test oracle only, never the search policy.

If caching is needed, begin with per-decision public observation plus full public
history/perspective keys. Equal boards with different chase/quiet histories must
not be merged. No new Core checkpoint contract is requested.

## 3. FLIP chance handling and information consistency

For each retained FLIP enumerate **every** positive outcome in the current public
hidden distribution. Weight child values by `count / totalHidden`; update that
distribution from the child's public reveal/history before another FLIP. Do not
drop rare outcomes, sample concealed boards, or renormalize a visited subset.

A future choice can depend on a reveal after that reveal becomes public. It cannot
depend on any other unrevealed identity. Expectation occurs at the FLIP before
backing its value up to the preceding decision; subsequent public branches have
their own decisions. This avoids giving a player advance knowledge of chance
outcomes or using different actions for indistinguishable hidden worlds.

No chance-node pruning initially. Alpha-beta may prune decision branches using
valid bounds; evaluate children used in chance averages with full windows so an
average never contains a cutoff bound masquerading as an exact value. Compare
pruned and unpruned search on exhaustive small public trees.

**The substantial approximation is action selection**, including omitted FLIP
locations and opponent replies, plus a finite completed horizon. The public
probability model itself remains exact for every retained action. Disclosure of
this limitation is required even though no private information leaks.

## 4. Deterministic budget and browser risks

Propose **8,192 Core projection attempts per decision**, including root fallback,
legality screening, ordering and recursive branches. Count rejected attempts too;
cache hits are reported separately. Check the budget before every attempt.
Root fallback must complete; reject a configuration that cannot cover it rather
than exceeding the declared bound. Search depth cannot exceed six. Record leaf
evaluations, retained decisions, chance outcomes, terminals, cutoffs, cache hits,
budget exhaustion and the completed depth of each root iteration.

Interior width4 and up to14 outcomes still permit up to56 branches per action ply;
the action cap does not promise six completed plies in hidden-heavy positions.
Opening depth1 fallback is a realistic outcome. Endgames can reach deeper. Always
report depth distributions and per-candidate coverage, not only maximum depth6.

Linear extrapolation of the opening's pure projection cost gives about70 ms for
8,192 attempts, before evaluation, history work, sorting and transport. This is
not a runtime guarantee: long quiet histories and browser/phone hardware differ.
Measure representative opening/middlegame/endgame Workers, p50/p95/p99, UI controls
and cancellation. Keep the existing per-request Worker and 10-second host timeout;
do not change the Worker architecture or add policy wall-clock budgets.

## 5. Alternatives

| Alternative                                            | Trade-off                                                                                                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full-width iterative expectiminimax, same budget       | Avoids Top-K omission but the opening's second ply alone exceeds the proposed budget by over23 times; often only one completed ply. Useful as a small-tree oracle, weak coverage as the main six-ply candidate. |
| Proposed root8/interior4, all chance outcomes          | Public probabilities remain exact; deliberately selective action reasoning requires owner approval and explicit coverage reporting.                                                                             |
| Sample/determinize hidden boards or drop rare outcomes | Could search deeper, but adds probability error/strategy-fusion risks. Not proposed.                                                                                                                            |
| New Core public checkpoint/legal-action API            | Could reduce repeated reconstruction costs; changes the shared boundary and needs separate approval/pin preparation. Not currently necessary or proposed.                                                       |

## 6. Acceptance and reuse

Keep `GameAgent`, observation, Runner, tournament and replay contracts. Export a
separate configurable tactical policy/decision explanation, with public search
nodes and a leaf-evaluator callable. The latter permits later modular progress
and optional position features without a neural-specific framework. Learned
policies, datasets, MCTS and backend inference are not part of this implementation.

Before calling AI-6A verified: cover every requested tactical case, exact small-tree
expectation/minimax oracle comparisons, terminal perspective, first-FLIP assignment,
budget accounting, chase differential tests, hidden permutations, immutable inputs,
seed reproducibility, complete games/replay, Worker responsiveness and all regressions.
One real tactical explanation must show retained/omitted replies, chance weights,
leaf/terminal scores, coverage and selected action. Test no win-rate threshold.

Freeze source/configuration with the existing manifest archive (no commit required).
Use a declared small runtime pilot first; then predeclare fresh held-out paired
seeds/sample size before inspecting strength results. Record W/D/L, paired95%
interval, immediate capture-win blunders with explicit denominator, tactical exchange
quality, p50/p95/p99, depths, projections, errors and retained truncations. Old EV
is the frozen control, not the new safety variant. No benchmark was run at preflight.

## 7. Dependency handoff to AI-6B and AI-6C

Only after AI-6A verification, reproduce the quiet58→59→60 fixture and rerun paired
matches; the historical111 draws are not evidence of current search behavior.
Draw outcomes remain0 regardless of material advantage. Reuse search before adding
progress features: a two-ply terminal draw may already be handled by tactical search.
Derive quiet suffix, remaining plies and repeated public positions from accepted
history; repetition is analysis, not a new terminal rule. Test ahead/behind,
dangerous FLIPs and genuine forced wins. No unconditional FLIP bonus is proposed.

AI-6B requires an on/off ablation and a concrete better local decision, plus the
requested progression/FLIP/conversion/latency metrics against frozen AI-6A. A feature
that does not improve decisions can be rejected; do not manufacture a strength claim.
Freeze that verified source/configuration before independent AI-6C position,
blocker and Cannon candidates. Evaluate each separately, audit overlap, reserve
fresh final seeds, then retain only justified candidates. No geometry work begins
while AI-6A/AI-6B baselines are absent.

## Owner approval and added safeguards

Research checks: [Ballard's chance-node search paper](https://www.sciencedirect.com/science/article/pii/S0004370283800150)
treats weighted chance nodes and specialized pruning; it is not a justification
for revealing concealed pieces to a policy. [Furtak and Buro's IJCAI paper](https://ijcai.org/proceedings/2015/25)
discusses strategy-fusion problems with perfect-information sampling. These support
the conservative pruning/no-private-determinization boundaries, not a claim that
selective search improves this game. The public belief construction and oracle
tests above remain necessary.

The supplied AI-6A brief says: **“Stop for approval if the proposed design requires
new shared GameCore contracts, large architectural changes, or substantial
approximations to hidden-information reasoning.”** The selected-action tree omits
FLIP locations and opponent choices; this is the substantial approximation requiring
approval, even while retained chance outcomes use exact public probabilities.

The owner approved this selective design, maximum six plies and8,192 projections,
then required tactical ordering, full root EV coverage, exact chance handling,
completed-iteration fallback, coverage diagnostics, paired EV comparisons and real
Worker measurements. This approval authorizes AI-6A only in the current experiment;
AI-6B/6C features, rule/weight changes, commits, pushes and deployment remain excluded.

Implementation refinement: every root action receives the unchanged EV evaluation
before selection. Reserve a best-EV action and, when root width exceeds one, a
best-EV FLIP. Fill remaining slots using actor-win, recapture, defensive exposure
reduction, capture, threat, then actor-relative EV ordering. Retain all terminal
actions even when this exceeds width. Diagnostic rows include omitted tactics and
every root FLIP's baseline score/outcome count. Defense/threat labels reuse existing
public exposure measurements strictly for ordering, not new evaluation features.
The existing EV callable itself performs fallback evaluation; its exact projection
count is reserved beforehand and verified against an actual-call spy test.

See [implementation and evaluation results](ai-6a-evaluation.md).
