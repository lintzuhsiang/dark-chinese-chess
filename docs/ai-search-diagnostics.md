# AI search diagnostics — recorded actions and offline evidence

This investigation makes no strategy, weight, Core, default-agent, or tournament-result changes.
All generated scores are **diagnostic-only reruns**, not historical recorded telemetry.
Action ply K means the decision at position K−1, consistent with the Inspector's
position cursor. Numeric positions are row-major A1–D8 (index 0 = A1, 31 = D8).

## Evidence and operation

The 52 selected decisions, ten prefix audits, full root rankings, interior exclusions,
chance branches, bounded leaf samples, and source comparisons are under
`benchmark-results/search-diagnostics/`. These generated artifacts are ignored by Git.

- [Full legal-root and first-interior ranking tables](../benchmark-results/search-diagnostics/full-root-rankings.md)
- [Compact 52-decision summary](../benchmark-results/search-diagnostics/decision-summary.json)
- Primary report: `tactical-6a-vs-strategic-6c-blockers-20261112-222235.json`.
- Cross-checks: both early-repetition legs in `tactical-6a-vs-progress-6b-20261112-221918.json`,
  seed 70006 in stable `6a-vs-6b-20261112-224601.json`, and seed 70019 in stable
  `6b-vs-6c-blockers-20261112-225138.json`.

Open `pnpm dev`, visit `/replay`, import the original report, and load its matching
`...-seedSEED-legLEG.json` using **Offline trace JSON**. Seek to a sampled action's
ply to see its diagnostics. The report's complete-file SHA256 must match. Earlier
positions and unsampled actions display **Not recorded.** Existing historical EV /
ranking fields remain **Not recorded.** Ordinary replay performs no search.

Generate another bounded artifact (1–24 action plies; refuses existing outputs):

```sh
node --import ./scripts/ai-eval/register.mjs scripts/ai-eval/search-diagnostics.ts \
  benchmark-results/tactical-6a-vs-strategic-6c-blockers-20261112-222235.json \
  /tmp/seed70019-diagnostics.json 70019 0 68,69,70,71,72
```

Separate same-prefix policy comparisons and static move effects:

```sh
node --import ./scripts/ai-eval/register.mjs scripts/ai-eval/search-diagnostics-counterfactual.ts \
  /tmp/seed70019-diagnostics.json /tmp/seed70019-counterfactual.json
```

The counterfactual script selects action 70 or 33 when present. These experiments
have separate budgets and are never counted as original search work or evidence
that an excluded move was actually searched. Their JSON is a separate analysis
artifact, not a historical trace attachment.

## Findings by incident

### Seed 70037, both legs, actions 8–67: early quiet repetition

Primary samples: 8, 9, 10, 39, 40, 66, 67 in both legs. Cross-check samples:
8, 39, 66, 67 in both 6A/6B legs. The full opening-to-67 prefix audits agree
with recorded actions for all four matches. There are 27 hidden pieces throughout
this quiet interval; the last progress is action 7 and action 67 reaches quiet60.

Every sampled decision uses all 8192 projections and completes **no depth-2
iteration**. Depth reports 1 and source is unchanged baseline EV. Root candidates
are scored once by EV, then retained root chance branches and their interior
ordering projections consume the remaining budget. Expanded replies/chance nodes
are not evidence of a completed search result. No partial iteration score is used.

The best-EV FLIP is reserved and retained. At action 8, selected 22→21 has
EV 0.040322581 versus best FLIP 0.033602151. This move is DEFENSE-tagged:
material stays+4, threat raw improves−2→0, and mobility raw stays0. It reduces
immediate exposure; this particular quiet move is not merely aimless shuffling. At action 66 the same EV preference
persists with quiet58; the resulting board/side-to-move has returned five times
in the quiet suffix. At action 67 an immediate draw scores 0, preferred to a
negative EV FLIP for the materially trailing player. Both legs end NO_PROGRESS.

This is not evidence that every FLIP is superior. It establishes that progress and
blocker **leaf** adjustments have no effect when search falls back to the shared
baseline EV. Quiet moves preserve similar static values and the policy has no
position-return penalty. The reserved FLIP was not excluded by root Top-K.

Classification: **AI-6D search completion/coverage**, with an **AI-6B fallback versus
leaf evaluation gap**. Whether changing budgets, ordering, or fallback improves
strength needs separate experiments. Do not infer a winning FLIP from repetition.

### Seed 70049, leg 0, actions 79–126: repetition despite completed search

Use the primary 6A/6C report: the 6A/6B game ends at action 106 and cannot explain
this interval. Samples: 79, 80, 100, 120, 125, 126. Prefix audit agrees through126.
Three pieces remain hidden. Last progress is action66; the eventual FLIP at126
occurs at quiet59 and resets the quiet count.

These decisions finish depth4, then depth5 at125/126, while exhausting8192
projections. They **do not fall back**. At actions80,100,120 the strategic agent's
19→18 has completed score 0.171733871; the first ranked FLIP has 0.138010753.
The same score persists at quiet13,33,53; returns rise to ten by action120.
At120 the immediate base material raw15, threat raw−1 and mobility raw15 are
unchanged by19→18. A reduction in safe escapes or deeper attack improvement is
not established by these static terms.
At126 the FLIP13 completes at0.171612903 and wins selection. Thus the best FLIP
was admitted and evaluated; “FLIPs were pruned” does not explain this sequence.

The trace establishes a selective-horizon preference, not a forced conversion
plan. Progress adjustment is based on **projected leaf quiet count**, which a
hypothetical capture/FLIP can reset; it is not a direct root repetition penalty.
No node-by-node backed-up score/PV exists to attribute the entire result to a
particular hypothetical reset. That causal attribution remains unestablished.

Classification: **AI-6B/AI-6C leaf behavior**, and **AI-6D horizon/coverage** are
candidates; the precise repeated-score mechanism beyond the observed selective
scores is **Not yet established**. Interior excluded replies are listed in the
full tables; their deeper values were not computed.

### Seed 70006, leg 0, actions 140–200: material lead without conversion

Primary samples:140,141,160,180,199,200. Prefix audit agrees through200. At140
6C captures22→26, taking its public material difference from+23 to+25. All pieces
are revealed. That is the last progress; action200 ends NO_PROGRESS. Depths5–6
complete. At180 the selected move returns to a prior quiet-suffix position; by199
6A can obtain completed score0. At180, material raw25, threat raw0 and mobility
raw21 remain unchanged by the selected move; a stronger conversion plan is not
visible in those base terms. At200 quiet59, all legal quiet continuations end
in the same draw; the selected move has ordering rank23 and is nevertheless
retained because all terminal actions are reserved. Width8 is a target, not an
absolute cap when terminal reserves exceed it. The final depth6 uses only50
projections because it repeatedly visits immediate terminal children.

The stable6A/6B cross-check is a **different trajectory**: samples140,160,180,199,200
finish depth5, have a+10 lead by160, and ultimately draw at210, not200. It must
not be conflated with the primary+25 case. Its sampled prefixes also reproduce.

Neither material advantage is a proven forced win. No retrograde/tablebase or
exhaustive full-width proof was performed. The data establishes failure to
convert in recorded play despite completed selective search, rather than an
EV fallback or an illegal Core repetition.

Classification: **AI-6B conversion pressure** / **AI-6C endgame leaf evaluation** /
**AI-6D selective horizon** remain competing explanations for the missed earlier
conversion. A forced winning alternative is **Not yet established**.

### Seed 70019, leg 0, around70: potential coordinated attack / strategic divergence

Primary samples68–72 and stable6B/6C samples69–71 reproduce recorded choices.
At70 the black chariot9→5 is root rank1, THREAT-tagged and retained. Its main
alternative9→13 is rank2 and also retained. Both get completed depth2 scores;
this divergence is **not caused by root pruning**.

Separate same-public-prefix policy comparisons isolate the leaf feature:

| Policy      | 9→5 completed score | 9→13 completed score | Choice |
| ----------- | ------------------: | -------------------: | ------ |
| 6A          |         0.002016129 |          0.005824373 | 9→13   |
| 6B          |         0.002016129 |          0.005824373 | 9→13   |
| 6C blockers |         0.008578629 |          0.008324373 | 9→5    |

Static counterfactual measurement:9→5 newly threatens red soldier6;9→13 threatens
soldier12. After9→5 there are4 safe quiet replies among5 permitted quiet replies,
versus5/5 after9→13. “Safe” here means the moved opponent piece's destination
cannot immediately be captured by an ordinary public move; FLIPs are excluded.
This narrow count is not a forced-attack proof. Quiet moves by black horse24,
advisor25 and elephant29 are potential coordination alternatives; all are listed
with root admission and immediate effects in the counterfactual artifact. No
longer coordinated win has been established for them.

The first selected-root interior node admits6→10 (DEFENSE), FLIP19, FLIP8,
FLIP16; it excludes the other ten replies by interior width/ranking. Historical
reply71 is6→10 and was admitted. Its defense is seen by the depth2 search.

Classification: **AI-6C strategic/leaf evaluation**, demonstrated by isolated
same-prefix 6A/6B/6C reruns. Whether9→5 is stronger is **Not yet established**.
The excluded coordination moves warrant counterfactual deeper analysis before
calling them an AI-6D ranking defect.

### Seed 70036, leg 1, around33: a leaf feature breaks a base-score tie

Samples31–35 reproduce. At33 both8→9 and8→12 are DEFENSE-tagged, EV0.197580645,
root ranks1/2, retained and evaluated through completed depth2. 6A/6B completed
scores tie at0.181955645 and the recorded decision seed selects8→9 in separate
same-prefix reruns. 6C scores0.188518145 versus0.189455645 and chooses8→12.

The immediate blocker adjustment is0.0065625 versus0.0075, a difference0.0009375.
The completed-search difference is also0.0009375. Neither action immediately
creates a new capture target; both have2/2 safe quiet replies under the narrow
measurement above. This supports structural empty-space access breaking a tie,
not a demonstrated coordinated attack. Neighboring action32 falls back to EV,
but action33 itself does not.

Classification: **AI-6C strategic/leaf evaluation**, established for the decision
divergence; strategic benefit remains **Not yet established**.

## Source integrity, semantics and missing telemetry

Core pin: `973bafe42f66e3414878afb3284e1f54216cbe4d`. All selected original
transcripts pass authoritative Core action, event, final state and outcome replay.
The trusted host alone uses the original deck; the agent receives only frozen
public observation/history, permitted actions and a derived decision seed.

All ten audited matches show no first divergence within their audited prefix
(67, 67, 126, 200, 72, 35, 67, 67, 200, 71, in execution order).
Audits are teacher-forced historical prefixes, not continued self-play after a
divergence. Source-stable cross-check reports support stronger reproducibility
than the unstable primary reports. Every declared agent source hash matches the
current checkout and the archived recorded Git head for these reports. Archived
head contents were read with `git show` and hashed; no checkout was changed.
Tracked/untracked source archive availability is reported explicitly. Even with
matching hashes and actions, **unstable runs do not establish a single exact
executed version**, so historical action remains ground truth and all new scores
retain the diagnostic-only label.

Already available: complete root baseline EV/breakdowns, tactics, retained sets,
completed iterations, expanded-node one-ply scores/chance branches, budget and
fallback counters. New runner derives exact ordering rank/reserves using the
unchanged priority, EV and generation-order tie-break. It refuses unsupported
implementation/configuration combinations instead of assuming defaults.

The runner uses the existing leaf-evaluator hook to retain at most16 evaluations
of generated nonterminal nodes, including root and speculative nodes. Existing
base evaluation is reused; no additional projection occurs. For6A the hook returns
the already-computed total; for6B/C it calls the existing evaluator unchanged.
These samples are genuinely computed leaf-function values, **not proof that a
node was visited at the depth cutoff**. Terminal evaluations bypass this hook.
No strategy source file was modified. Tests compare the complete returned search
object against each original explain function, including scores, nodes, projection
counts, iteration completion and chosen action.

Unavailable: principal variation, per-node backed-up minimax values, partial
iteration scores, per-candidate actual traversal/cutoff counts. These remain
**Not recorded.** The first interior report is the selected root's first generated
chance outcome (or its deterministic MOVE child), not a claimed PV. Chance-outcome
probabilities use public remaining inventory; they are not original hidden identities.
Alpha-beta may skip retained replies. Partially generated expansions lost to budget
are counted but lack complete node records; they are not represented as full traces.

All scores use the acting root player's perspective. Active weighted material,
threat and mobility contributions sum within[-1,1]; terminal wins/losses are±2,
draws0. For6B/C, root and interior ordering still use base one-ply EV; only search
leaf values contain progress/strategic adjustments. A baseline-only score on an
excluded candidate is never labeled a completed search loss.

## Recommendations and validation

First investigate why complete chance-expanded ordering at early interior nodes
prevents depth2 completion. Separately evaluate whether progress awareness needs
to reach fallback decisions. Neither change is implemented here. For endgames,
select concrete candidate alternatives and compare deeper/full-width public
counterfactual searches before concluding a forced win was missed. For strategic
divergence, retain paired same-prefix comparisons and measure eventual outcomes;
a small blocker-score preference is not strength evidence by itself.

Artifacts omit the full expanded search tree and keep only root branch summaries,
one relevant interior node, at most16 leaf samples, and completed root iterations.
Largest current trace is about5MiB. Browser trace import is capped at8MiB and24
decisions, verifies original-report SHA256, and renders only the reached sampled
action. Tournament hashing is done in its existing worker and adds a file-sized
byte buffer during import; this remains bounded by the Inspector's128MiB cap,
not streaming or constant-memory parsing. No AI code is imported into the browser.

Validation: 832 unit tests across47 files passed, including exact diagnostic/original
search parity and malformed trace imports. The focused suite also passed all7 tests, including incompatible-Core and
invalid-action runner cases. Eight replay browser checks passed in
Chromium and WebKit, including source mismatch, backward visibility, malformed
attachments and no AI worker. Lint, formatting, type checking and release validation passed. Existing replay work remains uncommitted and
was preserved. No commit, push or deployment was performed.

## Task files

New: `scripts/ai-eval/search-diagnostics.ts`, `search-diagnostics-counterfactual.ts`,
`scripts/ai-eval/tests/search-diagnostics.test.ts`,
`apps/web/src/replay/OfflineDiagnostics.tsx`,
`apps/web/tests/offline-diagnostics.test.ts`, `e2e-replay/search-diagnostics.spec.ts`,
and this document. Extended existing uncommitted Replay Inspector files:
`ReplayInspector.tsx`, `replay.worker.ts`, and `protocol.ts` to attach diagnostics
and bind them to the original report SHA256. Other pre-existing Inspector edits
were preserved. Generated evidence files are local artifacts, not tournament edits.
