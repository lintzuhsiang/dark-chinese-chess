# AI-6A — Selective tactical search evaluation

2026-11-11. **Implemented and verified as a selective baseline, uncommitted.**
No AI-6B/6C features, Core changes, weight tuning, commits, push or deployment.

## Reproducible implementation

Starting revision `76fed95` on `phase-2`; unchanged Core pin
`b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75`. The strict Core guard is unchanged.
Frozen control: original `expected-value-agent-v1`, unchanged from the starting
commit, with original piece values, weights, chance model and seed tie-breaking.
The new source/configuration is captured by each existing AI-2 benchmark manifest,
including the complete dirty source archive, not described as committed HEAD.

- `packages/ai-agents/src/tactical-search.ts`: bounded public expectiminimax,
  ordering, projection accounting, cached per-node expansions and explanation.
- `packages/ai-agents/src/tactical-agent.ts`: configuration capture and GameAgent.
- Existing Worker dispatch adds `tactical-6a`; UI label **戰術搜尋（上限6手）**.
  Original EV remains the default. No Worker architecture change.
- `scripts/ai-eval/tactical-descriptor.ts`: exact experiment identity/configuration.
- `scripts/ai-eval/tactical-benchmark.ts`: paired runs, diagnostic collection,
  replay and offline immediate capture-win exposure audit using the existing harness.
- `e2e/tactical-search.spec.ts`: real production Worker samples in both engines.

Public search state contains observation, accepted/hypothetical public events and
fixed player perspective only. Every successor uses existing Core projection.
Interior candidate geometry comes from shared Core movement; chase legality is
filtered by Core. All positive reveal outcomes are weighted using the updated
public inventory. No concealed world, physical ID or deck seed enters policy code.

## Decision flow and scope

1. Reserve/count all projections used by the unchanged full-root EV callable.
   It scores every permitted action and supplies the exact depth1 fallback.
2. Retain eight root actions, reserving a best-EV choice and best-EV FLIP. Prioritize
   actor wins, recaptures, defense, captures and threats before static EV. Interior
   width is four. All actions with a terminal outcome are mandatory exceptions.
3. Deepen through common horizons2–6, maximizing/minimizing for the original player.
   Terminal results stop early; active leaves use unchanged EV structural V.
   There is no seventh leaf action and no mate-distance bonus.
4. Evaluate every positive outcome of a retained FLIP. Chance children use full
   alpha-beta windows; average exact selective-subtree values, not cutoff bounds.
   No probability-mass pruning, determinization or sampling.
5. Check before every Core projection; maximum8,192 attempts includes fallback,
   ordering, chance branches and chase rejections. Reuse already projected node
   expansions across iterations. An exhausted iteration contributes no choice or
   root score; return the deepest fully completed iteration, or original EV.

`completedDepth` is the completed horizon of the **selected action tree**, allowing
terminal stops. It does not prove six actual actions in every branch or minimax
optimality against omitted actions. Diagnostics distinguish maximum visited ply,
recursive node visits, generated nodes, leaf evaluations, baseline projections,
total projections, reuse hits, cutoffs and budget exhaustion. Recursive visit/leaf
counts exclude the precomputed baseline; baseline projections are separately shown.
Root rows include every offered action and its one-ply score, retention, completed
depth, chance-outcome count and final search score (null if no completed deeper
iteration covers it). Interior counts refer to fully expanded/ranked nodes;
incomplete expansion count is separate. Nodes list excluded tactical actions too.
Node rows include work from discarded iterations; only `iterations` and final root
search scores identify completed backups. Interior branch scores are explicitly
static leaf/terminal values, not claimed as backed-up values at every depth.

## Predeclared experiment

- Pilot: two pairs/four games, decks51000–51001.
- Held-out: **16 pairs/32 games**, decks51200–51215, fixed before results. No
  weight/configuration changes or outcome-based seed/sample-size expansion.
- Both: Agent root20261111, exact same-deck seat swaps, administrative cap1024
  accepted plies, maximum six plies/8,192 projections, default widths8/4.
- This is a limited controlled comparison, not sufficient by itself to establish
  general strength. Use the harness's conservative paired95% Hoeffding interval;
  do not treat legs as independent. Preserve every failure/truncation and report
  its denominator. Audit all accepted transcripts using exact replay.
- p50/p95/p99 are nearest-rank elapsed decision samples; timings include policy
  work and explanation/collector overhead. Offline exposure audit is excluded.
- Immediate capture-win exposure: among accepted decisions leaving an ACTIVE
  actual successor, count those allowing any legal immediately winning opponent
  capture. This is narrower than all tactical blunders and uses the observed
  FLIP outcome, not an ex-ante FLIP risk estimate. It can include unavoidable losses.

```sh
node --import ./scripts/ai-eval/register.mjs ./scripts/ai-eval/tactical-benchmark.ts --phase pilot
node --import ./scripts/ai-eval/register.mjs ./scripts/ai-eval/tactical-benchmark.ts --phase heldout
```

Each writes `benchmark-results/ai6a-{phase}.json`, `-decisions.json` and
`-analysis.json`. `ai6a-tactical-example.json` contains only the real sacrifice's
public prefix/input and full explanation, separate from trusted private match
artifacts. Historical AI-4/5 artifacts are preserved.

## Tactical evidence and tests

The real accepted prefix from deck20005/leg0 before ply177 gives:

| Root choice  | Original one-ply EV | Six-ply selective value | Immediate tactical meaning                             |
| ------------ | ------------------: | ----------------------: | ------------------------------------------------------ |
| Advisor10→9  |       -0.2368951613 |           -0.2626008065 | Survives the immediate capture-win test                |
| Advisor10→14 |       -0.2368951613 |                      -2 | Opponent Advisor18→14 captures the last piece and wins |
| FLIP16       |       -0.2636088710 |           -0.2631048387 | Only remaining public outcome: Red Soldier             |

EV's original seed3581166702 chooses10→14. Search chooses10→9, with all five root
actions retained; the tactical loss receives GameResult-derived -2. The complete
tree/iteration scores are in the example artifact. This is a concrete local fix,
not a claim of a forced eventual win from a severely losing material position.

At the two-ply iteration the actual retained opponent replies are:

| Our MOVE | Opponent reply                     |                  Fixed-P1 score after reply | Retained reason                    |
| -------- | ---------------------------------- | ------------------------------------------: | ---------------------------------- |
| 10→9     | Elephant13→12                      |                               -0.2610887097 | Defensive escape                   |
| 10→9     | Elephant13→14                      |                               -0.2610887097 | Defensive escape                   |
| 10→9     | Elephant13→17                      |                               -0.2595766129 | Defensive escape                   |
| 10→9     | FLIP16 (Red Soldier, probability1) |                               -0.2384072581 | Best remaining ordered alternative |
| 10→14    | Advisor18→14                       |                                          -2 | Immediate opponent win, mandatory  |
| 10→14    | Elephant13→9 /12 /17               | -0.2620967742 /-0.2610887097 /-0.2595766129 | Defensive alternatives             |

Opponent minimizes, so the two-ply backups are -0.2610887097 and -2 respectively.
Each opponent node has24 legal actions but only four are retained; the artifact
lists the omitted20. Through horizons2–6 the safe action's values are
-0.2610887097, -0.2358870968, -0.2620967742, -0.2368951613,
-0.2626008065; the fatal action remains -2. This example uses7,841 projections,
1,701 recursive visits,7,836 generated nodes and380 decision cutoffs. It illustrates
both the tactical fix and horizon-dependent static threat values, not exact full-
width minimax or proof that no omitted reply is better for the opponent.

Synthetic tactical snapshots are explicitly marked as capture-ledger fixtures;
they are distinct from the real accepted prefix. Tests cover unfavorable
Advisor6-for-Soldier2 exchanges followed by recapture, profitable Soldier2-for-
General8 exchanges followed by recapture, defensive Horse escapes, evadable threats,
multiple opponent replies, a three-ply forced win with no immediate root capture,
forced capture losses, first-FLIP assignment, hidden inventory updates, terminal
exceptions, quiet-limit outcome priority and Cannon chase-only immobilization.
Full-width small-tree values match a separate exhaustive public oracle and the
unpruned variant. Spy tests verify actual Core-call accounting and discard partial
chance iterations. Both-seat complete games replay exactly; hidden permutations,
opaque IDs, frozen inputs, configuration capture and rotated full-width scores pass.

Automated verification: **749 tests across36 files**, typecheck, lint, formatting,
production build and release-artifact checks passed. All **56 Chromium/WebKit
browser checks** passed, including actual tactical decisions, public transport,
turn guards, cancellation/retry, terminal Review, local play and accessibility.

## Paired measurements

Pilot completed4/4 games and2/2 pairs: search **3/1/0 W/D/L**, average0.875,
paired95% interval **[0,1]**. This is runtime/correctness evidence only. All four
transcripts replay exactly, sources stayed stable, and there were no errors,
illegal actions or truncations. The configuration was unchanged for held-out play.

Of355 search decisions, completed horizons1–6 occurred68/112/16/31/77/51 times.
Budget exhaustion:304/355 (85.6%); six-ply completion:51/355 (14.4%). Total retained
root actions were2,841/6,425; fully ranked interior actions483,183/1,487,880.
Excluded tactical-labelled actions across ranked nodes:29,470. Projection p50/p95
and maximum were8,192. Search policy latency p50/p95/p99 was233.95/499.03/649.84 ms;
EV was1.62/6.20/9.43 ms. Capture-win exposure was0/351 eligible search successors
and4/353 EV successors. One game ended in NO_PROGRESS.

Held-out results (fixed decks51200–51215, no changes after the pilot):

| Metric                         |         Tactical AI-6A |                  Frozen EV |
| ------------------------------ | ---------------------: | -------------------------: |
| W/D/L,32 completed games       |              22 /10 /0 |                  0 /10 /22 |
| Average score                  |                0.84375 |                    0.15625 |
| Decision samples               |                  2,850 |                      2,839 |
| Node.js elapsed p50/p95/p99 ms | 231.96 /438.08 /726.56 |         2.22 /13.01 /23.39 |
| Immediate capture-win exposure |      0 /2,823 eligible | 38 /2,834 eligible (1.34%) |

All32 games/16 pairs completed; all32 transcripts replay exactly. No illegal
actions, Agent errors, runner failures or truncations. A scored10 wins/6 draws
as P1 and12 wins/4 draws as P2. Paired mean0.84375; conservative95% Hoeffding interval
**[0.5042246211,1]**, based on16 pair observations. Its lower bound narrowly exceeds
0.5 under the harness's independent-pair sampling assumptions. This supports an
advantage against this frozen EV opponent/cohort, not broad strength across
opponents/openings. Consecutive deterministic seeds do not prove representativeness
or independence. No post-hoc expansion, weight change or strength-based test gate.

| Completed selective horizon | Decisions | Share |
| --------------------------- | --------: | ----: |
| 1 (exact EV fallback)       |       872 | 30.6% |
| 2                           |       591 | 20.7% |
| 3                           |       304 | 10.7% |
| 4                           |       318 | 11.2% |
| 5                           |       316 | 11.1% |
| 6                           |       449 | 15.8% |

Thus51.3% completed only one/two plies. Budget exhaustion:2,401/2,850 (84.2%).
Some six-ply work was visited in761 decisions, but only449 completed the six-ply
iteration. This is not six-ply coverage on every decision. Projection p50/p95/max
was8,192. Recursive visits:4,968,062 total, median1,617, p95 3,080, max4,617;
generated nodes:21,250,330 total, median8,074. Baseline EV work is counted separately.

Root retention:22,369/51,132 actions, including10,489/27,647 available FLIPs.
Fully ranked interior retention:3,233,884/10,033,880 actions. There were2,400
incomplete interior expansions; their unfinished rankings are excluded from those
denominators. Excluded tactical-labelled actions:207,662 across ranked nodes,
including31 root actions. Terminal exceptions remain mandatory. The raw decision
file records each omitted root and the aggregate interior omissions; full node
lists are available from `explainTacticalDecision` and the real-case artifact.

For zero-hidden-piece decisions,330/437 (75.5%) completed horizon6. All494 decisions
with20+ hidden squares fell back to EV;378/678 with10–19 hidden squares also did.
Exact chance/ordering expansion dominates the early-game budget. A count bound
therefore provides predictable work, not consistently deep tactical coverage.

Both run manifests have identical source digest
`d720472c0aece8cc4c5f9971f621462b56b84f0c04816ffac6f5a27fd86c69c6`
and `sourceStableDuringRun: true`. A final audit checked all80 archived source-file
hashes against the checkout with zero mismatches and checked frozen EV against
`76fed95`. The dirty-source archive identifies the implementation; HEAD alone
does not. Supplementary audit: `benchmark-results/ai6a-source-audit.json`.

All10 held-out draws were NO_PROGRESS. Eight retained hidden pieces, and five
had a positive public material difference for search; those are not proofs of
available forced wins. This describes the current mixed search-vs-EV cohort and
cannot be compared directly to the historical111/200 EV-vs-Heuristic draws.

## Browser measurements

Each engine ran six fresh Workers per position (24 samples), on desktop Apple M1
macOS27.2, not physical phones. Timing is policy execution inside the Worker;
round-trip additionally includes loading/transport. Nearest-rank percentiles are
descriptive; with this small sample p99 is simply the maximum and not a reliable
estimate of tail risk. Main-thread animation frames continued in every position.

| Engine   | Policy p50/p95/p99 ms | Round-trip p95 ms |
| -------- | --------------------- | ----------------: |
| Chromium | 95.1 / 345.5 / 358.9  |             350.1 |
| WebKit   | 122 / 276 / 279       |               289 |

| Position                           | Chromium policy p50 ms | WebKit policy p50 ms |
| ---------------------------------- | ---------------------: | -------------------: |
| Fully hidden opening               |                   50.9 |                   49 |
| Two-hidden-piece tactical snapshot |                  143.8 |                  123 |
| Real sacrifice prefix              |                  337.1 |                  274 |
| Revealed exchange endgame          |                   94.8 |                   85 |

Raw combined samples are retained at `benchmark-results/ai6a-browser-latency.json`;
Playwright also records per-engine artifacts under test-results. No default or
difficulty-label promotion follows from these samples.
Engines were Chromium158.0.8127.18 and WebKit27.2. Source/configuration, engine
user agents and build hashes are preserved in `ai6a-browser-provenance.json`.
The tested Worker asset SHA-256 is
`d4207391ef848831a90e57d205841bb75f60ffb05ade916de85008fbdb5ad9d1`.

## Known limitations and next boundary

Top-K can omit a vital reply, defensive move or promising FLIP location. Root FLIP
reservation ensures one alternative is searched, not that all locations get deep
coverage. Tactical ordering uses immediate public effects and cannot prove a
threat is forcing. All-terminal equality can choose a slower win because there
is no distance-to-mate score. Cached expansions are per decision tree; no general
transposition/state framework is introduced. Long histories still cost time in
the existing public projector/evaluator. Projection bounds are not time bounds.

Keep browser defaults unchanged until measured strength and physical-device
responsiveness justify promotion. Desktop Chromium/WebKit measurements are not
iPhone/Android evidence. AI-6B progression and AI-6C geometry remain deferred under
the latest approval; terminal draw recognition here is ordinary search/Core behavior,
not a progress bonus. The modular leaf callable is bounded/pure and must not perform
uncounted Core projections. No neural-specific framework or self-play dataset
infrastructure is introduced.

Recommendation: retain AI-6A as an opt-in, reproducible baseline. It fixes the
recorded immediate sacrifice and performs better than frozen EV on this small
held-out cohort, at substantial latency cost and usually shallower-than-six depth.
Before increasing its default status, collect longer-game physical-phone evidence
and a larger independently reserved comparison against additional opponents.
The remaining draw observations justify AI-6B investigation next, with this exact
configuration frozen, existing search reused and no unconditional FLIP bonus.
That feature implementation and AI-6C geometry remain outside the current experiment.
