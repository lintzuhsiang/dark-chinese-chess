# AI-5.1 — Gameplay investigation and visible turn pacing

2026-11-11. UI pacing and diagnostic tests are implemented. The subsequently
approved SAFETY-TIE-1 policy variant is recorded in section F. **Core rules,
contracts, baseline Agent behavior, values/weights, and the Core pin are unchanged.**
Existing AI-5 work is preserved. The owner subsequently approved committing AI-5,
AI-5.1, and SAFETY-TIE-1; no push, deployment, or tuning tournament.

## A. Findings from reproducible decisions

These reproduce the observed classes of behavior, not an unrecorded exact user
game. Two cases come from the existing AI-4 benchmark; the third is a fully legal
constructed opening. Full initial decks and accepted prefixes are embedded in
tracked tests, without depending on ignored benchmark files. Boards, all legal
candidates, component scores and relevant history are in the
[decision evidence](ai-5-1-decision-evidence.md) and
[chase investigation](ai-5-1-chase-rule-proposal.md). Indices are zero-based row-major.

### A1. Unnecessary sacrifice: net exposure hides the last piece's risk

Deck 20005, leg 0, before ply 177; P1/BLACK, seed 3581166702, quiet count 37.
Only one hidden square remains. Black's last piece is Advisor10. Red has an
Elephant13 and Advisor18 among its remaining revealed pieces.

| Candidate           | Material raw | Threat friendly/enemy exposed | Threat raw | Mobility raw |             V |
| ------------------- | -----------: | ----------------------------: | ---------: | -----------: | ------------: |
| Safe Advisor10→9    |          -25 |                         0 / 5 |         +5 |          -20 | -0.2368951613 |
| Chosen Advisor10→14 |          -25 |                        6 / 11 |         +5 |          -20 | -0.2368951613 |

All three aggregate feature values are identical, so the seeded tie chooses 14.
Red Advisor18→14 then captures Black's last piece: P2 wins NO_PIECES, scoring -2
from the original P1 perspective. This is a strongest immediate response across
all legal MOVEs and every positive-probability FLIP outcome.

**Cause:** net threat aggregation and missing opponent-response evaluation. The
unsafe square's additional enemy Advisor opportunity offsets the friendly Advisor
exposure exactly. Increasing the existing Threat weight cannot separate identical
vectors; changing a rank's shared value still cancels that equal-rank exchange.
There is no evidence here of incorrect rank/Cannon validation, duplicate victim
counting, or a terminal-priority bug. Values are experimental, not proven optimal,
but this particular failure is structural. The safe alternative avoids the next
capture; it does not establish a forced win from this already inferior position.

### A2. Avoiding FLIP and drawing while ahead

Deck 20001, leg 1, before ply 76; P2/BLACK, seed 4030719552, quiet count 58,
19 hidden squares, material raw +7. There are 2 legal MOVEs and 19 legal FLIPs.

| Candidate              | Material raw |   Threat raw | Mobility raw |            Q |
| ---------------------- | -----------: | -----------: | -----------: | -----------: |
| Chosen Chariot10→14    |           +7 |            0 |           +1 | 0.0710685484 |
| Best FLIP29 (expected) |           +7 | -2.631578947 |            0 | 0.0573005093 |
| Other MOVE12→13        |           +7 |           -6 |           +2 | 0.0413306452 |

FLIPs span 0.044567–0.057301, all below the chosen MOVE. The quiet MOVE removes
current exposure (threat raw -4→0) and gains one quiet mobility option. Revealing
preserves material; its expected tactical exposure lowers V. Current V includes
no information/progress feature, nor a second-ply draw check.

Core correctly makes the quiet count 59. Red's historical reply Elephant9→13
then reaches 60 and draws. Draw0 is also the strongest immediate opponent result:
all opponent FLIP expectations are negative. A FLIP by Black would reset the
counter to zero, without creating material; that does not prove it would win.

**Cause:** expected one-step horizon/feature limitations plus legitimate draw
incentives for the side behind. FLIP is not universally beneficial. All 111
EV/Heuristic draws in the earlier comparison were NO_PROGRESS; 83 retained hidden
pieces and 47 had positive EV material difference. Those aggregate counts do not
prove a single cause for every draw, or that each material lead was convertible.

This fixture also demonstrates **ESCAPE → RENEW → null** chase tracking: the Red
Elephant's fork threatens both Soldier12 and Chariot14, so the exactly-one-target
rule resets the chain. That behavior matches Core's present definition. A simple
per-position threshold change does not close this reset path.

### A3. Pursuit across changing positions

The independent chase fixture captures four Black Soldiers and reaches a valid
ply-23 position with Red Chariot1 pursuing Black Horse5. Horse escapes and Chariot
renewals continue through five distinct threat boards, each per-key count 1.
At ply25, P1/RED with fixed seed0 has 3 MOVEs and 20 FLIPs:

| Candidate              | Material contribution | Threat contribution | Mobility contribution |        Q |
| ---------------------- | --------------------: | ------------------: | --------------------: | -------: |
| MOVE1→0                |              0.080645 |                   0 |                     0 | 0.080645 |
| MOVE1→2                |              0.080645 |            0.015121 |                     0 | 0.095766 |
| Chosen MOVE1→5         |              0.080645 |            0.015121 |              0.000504 | 0.096270 |
| Best FLIP25 (expected) |              0.080645 |            0.010585 |              0.000504 | 0.091734 |

Horse6→2 is the unique strongest immediate response across all legal MOVEs and
public FLIP expectations; it reduces fixed-P1 V to 0.081149. The first renewal is
an actual EV choice. The longer five-board path is a legal scripted reproduction,
not a claim that EV autonomously chooses every scripted move.

**Cause:** a deliberate rule-definition boundary plus one-step reward for a threat
that the defender can evade. Core already follows the same physical pair across
squares; it simply limits repeated keys, not total pursuit. No rule is silently
changed by these diagnostics.

### Terminal and execution audit

Each normalized feature is in [-1,1], weights are nonnegative, and contributions
divide by max(1,sum(weights)); hence active V is in [-1,1]. Stored WIN/LOSS override
it with +2/-2 from the original perspective, including zero/extreme valid weights.
Draw0 is neutral and intentionally not above all active evaluations. Both default
and configured tests preserve this ordering. No revealed piece creates material.

Heuristic retains its documented partial MOVE evaluation and seeded FLIP fallback.
EV uses exact Core successors and weighted FLIP outcomes; neither searches replies.
The trusted runner/browser adapter supplies copied public data, independent decision
seeds, and accepted history. Browser/runner guards revalidate proposals and do not
modify their scores. No execution-layer or terminal score error explains these cases.

## B. Implemented presentation changes

- `ai/turn-pacing.ts`: `sampleVisibleDelay` and `createTurnPresentation` implement a
  controller-level visible-time gate with injectable randomness, clock, frames,
  timers, and visibility. No timing framework or policy interface change.
- `hooks/useLocalGame.ts`: a layout effect anchors each AI turn to its preceding
  accepted human action. Two visible animation-frame callbacks provide a paint
  opportunity before dwell starts. Worker computation begins immediately as before.
- Minimum samples: human FLIP **500–900 ms**, quiet MOVE **350–700 ms**, CAPTURE
  **450–850 ms**; an AI opening uses 350–700 ms. The sample is drawn once per
  generation/revision, from presentation entropy independent of Agent/deck PRNGs.
- A ready response waits only remaining visible dwell. Slow computation presents
  without a second full wait. Hidden-tab time does not count toward visible dwell.
  Timers are minimums; browser scheduling is not a hard real-time display guarantee.
- Worker success terminates computation immediately; only presentation remains
  pending. Thinking/disabled-human-turn UI remains active. Restart/mode/revision/
  unmount cancel both pending presentation and computation. Same-revision retry
  reuses its visible anchor; stale/duplicate actions still fail the commit guards.
- Local two-player play, accessibility, Core, Session, policy output and randomness
  are unchanged. Browser tests cover already-computed replies cancelled during dwell.

**Verification:** all **708 tests across 34 files**, workspace typecheck, lint,
format check, production build and artifact inspection pass. The complete browser
suite passes **50 checks** (25 each Chromium/WebKit), including real Workers,
controlled visible dwell for FLIP/CAPTURE/MOVE, slow responses, already-computed
reply cancellation, stale/duplicate replies, retries, Review and local two-player
regressions. The additions include 20 deterministic pacing cases, four real-prefix
decision diagnostics and two chase diagnostics. Physical-device acceptance is not
claimed; no large benchmark experiment was needed for this investigation.

Three specialized subagents independently investigated decisions, reviewed chase
semantics and tested pacing. Main owned the controller/Worker integration, browser
checks and report, and cross-checked the fork reset and derived-counter proposal.
Files/functions changed for this task:

- `apps/web/src/ai/turn-pacing.ts`: new sampler/visible-time gate.
- `apps/web/src/hooks/useLocalGame.ts`: per-version paint anchor and response gate.
- `apps/web/tests/ai-pacing.test.ts`: deterministic clock/frame/visibility coverage.
- `e2e/ai-play.spec.ts`: visible dwell, queued-reply cancellation, controlled retry.
- `packages/ai-agents/tests/ai51-gameplay-diagnostics.test.ts` and
  `ai51-chase-diagnostics.test.ts`: standalone replayable evidence.
- This report, exact-decision appendix and chase proposal; links/status additions
  to README, the Phase 2 plan and AI-5 documentation.

## C. Rule approval boundary

The [precise amendment proposal](ai-5-1-chase-rule-proposal.md) distinguishes:

1. Maximum **two qualifying threat-position appearances**, rejecting appearance3
   (currently appearance4 is rejected). This is the second return, not third return.
2. A separate same-pair pursuit limit independent of positions. An illustrative
   maximum **four total threats** (initial + three renewals) would reject threat5;
   the existing positionCounts sum supplies the total, requiring no new state field.
3. A separate fork-continuity choice: retain today's multi-target reset, or keep
   following the already identified target when a fork adds extra targets. The
   former leaves the observed reset path; the latter can penalize legitimate forks.

Any finite non-repeating cap can also reject a legitimate long forcing attack.
This trade-off cannot be resolved by claiming an intent detector. Defender escapes
must not increment the attacker's counts. Keep invalid attempts immutable and keep
NO_PIECES → chase-filtered NO_LEGAL_ACTION → NO_PROGRESS priority unless separately
approved. Rule changes require a new reviewed Core revision; old transcripts and
benchmarks retain their old Core. Restart active browser games after any such change.

## D. Ranked AI-6 experiments (SAFETY-TIE-1 subsequently approved)

| Rank | Experiment                                              | Expected benefit / basis                                                                           | Complexity and risks                                                                                                                        | Measurement                                                                                       |
| ---- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1    | Immediate-response safety / terminal-risk tie-break     | Avoid the exact last-piece sacrifice while preserving legal choices when every move is unsafe      | Small targeted variant; do not discard winning terminal moves or invent a safe alternative. A full reply layer costs more than a tie-break. | Recorded fixture, fresh paired comparison against frozen EV, failures and browser latency         |
| 2    | Progress Awareness with opponent draw responses         | Recognize the quiet58→59→60 pattern and distinguish maintaining a lead from accepting a draw       | Medium; material lead is not a forced win and a draw while behind can be desirable. Avoid unconditional FLIP bonuses.                       | Ahead/behind counter-boundary fixtures; W/D/L, remaining hidden pieces, conversion and time costs |
| 3    | Broader bounded opponent-response evaluation            | Discount escapable chase threats and see recaptures beyond static net exposure                     | Medium/high; hidden FLIP branching grows quickly. Record selective reply coverage and deterministic computation caps.                       | Tactical captures/escapes and held-out paired scores at matched compute budgets                   |
| 4    | Relative position / conversion geometry                 | Distinguish quiet moves by future access, approach, and support                                    | Medium; avoid duplicating immediate mobility/threat features or assuming hidden identities                                                  | Endgame and distance/accessibility ablations, symmetry/permutation tests                          |
| 5    | Cannon screens / hidden-blocker structure               | Value latent tactical setup beyond immediate capture geometry                                      | Medium; use shared Core validity, not a second capture engine                                                                               | Screen/blocker fixtures and one-feature-at-a-time held-out comparisons                            |
| 6    | Rework Threat/Safety separation, then calibrate weights | Preserve friendly exposure versus enemy opportunity instead of cancelling both into one net number | Low/medium code plus experimental cost; simply increasing the current net Threat weight cannot repair equal vectors                         | Feature-vector regressions, scale/double-counting audit, separate tuning and confirmation seeds   |

No large-scale tuning, new tournaments, RL, MCTS, neural networks, or new strategy
was launched. Keep the AI-4 configuration and historical artifacts intact.

## E. Recommended next step

Review the reproduced decisions, then approve a narrowly named immediate-response
safety experiment first. A smallest concrete variant is **SAFETY-TIE-1**: among
equally highest-scored MOVEs, prefer one that does not allow an immediate legal
opponent capture win, if such a tied MOVE exists. Use shared Core projections to
check replies, preserve already terminal winning actions, and retain original tie
handling if every tied MOVE is unsafe. Keep scores, FLIP weighting, values/weights,
and offered-action membership unchanged. This directly targets A1; it does not
claim to solve strictly higher-scored sacrifices or general tactical search.

Treat Progress Awareness/opponent-draw handling as its own experiment so its effects
can be measured. The pacing task did not authorize either policy experiment; the
owner subsequently approved SAFETY-TIE-1 alone on 2026-11-11.

For Core, approve the counted-position wording, choose a continuous limit, and
decide the fork exception independently before implementation. Do not combine a
rule change with policy tuning and claim a pure strength improvement. The Core
approval boundary remains; no chase amendment is implemented.

## F. Approved SAFETY-TIE-1 implementation

The opt-in `safetyTieAgent` reuses EV scores unchanged and checks only exact top
ties containing MOVEs exclusively. Shared Core projects each MOVE and each ordinary
opponent capture, using GameResult to identify an immediate opponent win. Already
terminal successors are retained. If a safe tied alternative exists, unsafe choices
are removed; otherwise legacy tie selection remains. Mixed FLIP ties, unique best
actions, probabilities, values, weights, and original candidate order/first seeded
sample are preserved. Diagnostics return each checked MOVE and winning capture
witness. The actual A1 fixture now selects 10→9 instead of 10→14.

The original EV policy remains unchanged and is still the browser default. Select
**期望值＋安全決勝** to play the variant, or `--agent-a safety-tie-1` in the harness.
No quiet/FLIP opponent replies, nonterminal losses, progress awareness, broader
search, or Core rules were added. A null winning witness is not general safety.
Independent QA covers the recorded case, both seats/colors, unchanged scores,
terminal capture wins by elimination/immobility, mixed/unique/all-unsafe boundaries,
seeded ordering, hidden permutations and immutable inputs. Fresh paired strength
measurement remains future work; historical benchmark artifacts are untouched.

Verification: typecheck, lint, formatting, 725 tests across 35 files, production
build, and release-artifact checks passed. Complete direct-Core games run twice
in each seat and replay exactly. A one-pair/two-ply CLI smoke run recorded distinct
policy identities, stable sources and zero illegal actions/errors; both deliberately
truncated prefixes replay exactly (expected exit 2, unscored; no strength evidence).
All 30 AI browser checks passed across Chromium/WebKit. The full browser run passed
51/52; the existing Chromium phone procedure raced its final Undo assertion against
automatic preparation of the next position (history547 had already advanced to
Review607). Failure artifacts were retained; application/Core code was not changed
to address this unrelated test timing issue.
An isolated Chromium rerun passed (26.1 seconds), with the original failure
artifacts preserved. Browser automation does not replace physical-device checks.
