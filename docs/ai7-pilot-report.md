# AI-7 Branch B pilot — 2026-11-14

The pipeline works and the policy changes. **Useful playing-strength improvement
is not established.** The primary paired comparison against Uniform Random improved
in point estimate, but its 95% interval includes no change. Emergent tactical,
defensive, FLIP, coordination, piece-value, and endgame skills remain unverified.

## Milestones

| Milestone                 | Result          | Evidence                                                                                                                                                    |
| ------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Learning sanity        | Passed          | Finite PPO updates, changed parameters, strict masks, complete Core games, exact weight/Adam continuation after reload, deterministic configured evaluation |
| 2. Measurable improvement | Inconclusive    | Primary trained-minus-initial score +4.10 percentage points; paired bootstrap 95% CI −0.59 to +8.79 points                                                  |
| 3. Emergent strategy      | Not established | Outcomes remain draw-heavy; no independent tactical/defense/FLIP/coordination/valuation probes were performed                                               |

The observations, architecture, reward ownership, command lines, opponent sampling,
and statistical protocol are specified in [the implementation guide](ai7-selfplay.md).

## Run and resource use

- Isolated worktree: `experiment/selfplay-zero`, branch `experiment/selfplay-zero`.
- Base source: `c377a68`; exact Core/rules:
  `973bafe42f66e3414878afb3284e1f54216cbe4d`.
- Hardware: Apple M1, 8 CPU cores, 8 GPU cores, 16 GiB RAM. Node 26.10.0,
  Python 3.9.6, PyTorch 2.8.0, NumPy 2.0.2. Host MPS is available; sandbox MPS is
  unavailable. CPU was chosen from measured performance.
- Shared 429,857-parameter randomly initialized MLP; training seed 7; terminal
  rewards only. Historical/current/Random opponents; no heuristic training opponents.
- Predetermined bounds: 262,144 environment steps, 64 updates, or 7,200 seconds,
  whichever stops first. Complete-batch step accounting permits a small final overshoot.
- Completed **264,609 transitions, 1,008/1,008 games, 63 PPO updates**; no incomplete
  games. Stopped at the step target. This was a small step-bounded pilot; it did
  **not** consume the full two-hour allowance.
- Training window: 128.67 seconds, including 6.97 seconds of periodic validation;
  actual training: **121.70 seconds**. Optimization: 14.33 seconds.
- Mean rollout throughput: 2,630 transitions/second. End-to-end training throughput
  excluding validation: 2,174 transitions/second. 0.518 PPO updates/second;
  153 optimizer minibatches/second. Mean measured forward cost per neural decision:
  0.091 ms; encoding and IPC are measured separately below.
- Artifacts are approximately **57 MB**, far below 5 GB, with nine checkpoints,
  one archived training game per update, compact results for every game, evaluation
  transcripts, figures, configs, optimizer/RNG states, hashes, and source snapshots.
  Dependencies are excluded. No extension training was run.

Raw run: `benchmark-results/ai7-selfplay/pilot-seed7-20261114/`.

## Primary independent strength evaluation

The initial, midpoint, and preselected final checkpoints each played **256/256
completed games**: 128 held-out decks, both seats, seeds 2,000,000–2,000,127. Random
selects uniformly among Core-legal actions. Each checkpoint uses the same independent
action streams. No evaluation trajectory enters PPO.

| Checkpoint | Training steps | Wins | Draws | Losses | Paired score | Conservative 95% CI |
| ---------- | -------------: | ---: | ----: | -----: | -----------: | ------------------- |
| Initial    |              0 |   33 |   184 |     39 |       48.83% | 36.82–60.83%        |
| Midpoint   |        133,167 |   38 |   186 |     32 |       51.17% | 39.17–63.18%        |
| Final      |        264,609 |   47 |   177 |     32 |       52.93% | 40.93–64.93%        |

Paired score assigns win=1, draw=.5, loss=0; it is **not win rate**. Pair units are
the two seat-swapped games on one deck. The final-minus-initial difference is
**+4.10 percentage points**, paired bootstrap 95% CI **[−0.59, +8.79]**. The more
conservative Hoeffding difference interval is **[−19.91, +28.11]** points. Neither
supports a confirmed improvement claim. Only one independent training seed was run.

The midpoint difference is +2.34 points, bootstrap CI [−2.15, +6.84]. These are
descriptive multiple-checkpoint comparisons, not evidence for selecting a favorable
checkpoint after seeing final-test results. The endpoint was selected in advance.

Raw results: `benchmark-results/ai7-selfplay/pilot-eval-random-complete/`.

## Other frozen-opponent evaluations

| Opponent and held-out decks                              | Initial W/D/L | Final W/D/L | Interpretation                                                       |
| -------------------------------------------------------- | ------------- | ----------- | -------------------------------------------------------------------- |
| Random, 64 additional pairs, seeds 2,001,000–2,001,063   | 15/96/17      | 21/92/15    | +3.13 score points; bootstrap CI [−3.52, +9.77]; inconclusive        |
| Frozen midpoint policy, same 64 pairs                    | 11/98/19      | 12/98/18    | +0.78 score points; bootstrap CI [−5.08, +6.64]; inconclusive        |
| Existing EV, 8 pairs, seeds 2,002,000–2,002,007          | 0/0/16        | 0/0/16      | No wins or draws against EV in this small sample                     |
| Frozen default AI-6A, 2 pairs, seeds 2,003,000–2,003,001 | 0/0/4         | 0/0/4       | Diagnostic sample only; insufficient for a precise strength estimate |

Every attempted game completed. Existing EV/AI-6A source and default configuration
were unchanged and held fixed at the recorded source revision. Neither supplied
training data, demonstrations, recommendations, features, or rewards. Each
evaluation directory has exact checkpoint hashes and source provenance.

Auxiliary seed sets are reported separately. They are not pooled after seeing the
primary outcome to manufacture significance. The very wide small-sample intervals
are available in the raw summaries. An initial evaluation command had a mistyped
midpoint filename; its partial output is marked aborted and excluded. The complete
replacement used the declared seed set. Repeating its initial-policy evaluation
reproduced all 256 game records exactly.

## Repetition, draws, and exploration

Primary Random evaluation:

| Diagnostic                         | Initial | Midpoint |  Final |
| ---------------------------------- | ------: | -------: | -----: |
| NO_PROGRESS draw rate              |  71.88% |   72.66% | 68.75% |
| CHASE_STALEMATE draw rate          |      0% |       0% |  0.39% |
| Own-move reversals per game        |   26.37 |    29.85 |  28.11 |
| Repeated public positions per game |    4.13 |     5.21 |   5.21 |
| Hidden pieces at termination       |       0 |        0 |      0 |
| FLIPs per game                     |      32 |       32 |     32 |

The final policy's NO_PROGRESS frequency is slightly lower, while reversals and
public-position repetition are higher. This does not demonstrate deliberate
draw-seeking or successful mitigation. Draws were already common under an
approximately uniform untrained policy. All hidden pieces were revealed in the
primary evaluation: the early face-down-board stagnation seen in the heuristic
diagnostic examples was not observed here. There is no evidence that FLIP timing
became strategically good merely because all pieces were eventually flipped.

Across training's changing opponent mixture, 708/1,008 games were draws: 707
NO_PROGRESS and one CHASE_STALEMATE. Training W/D/L is not an independent strength
estimate. Initial-to-final normalized entropy changed from .999 to .886; the
minimum update-average was .827. This rules out a nearly deterministic policy
collapse in this pilot, but does not prove sufficient exploration of rare tactics.
Entropy also depends on the visited positions and legal masks.

The final policy won 47, drew 175, and lost 32 primary-evaluation games after ever
holding an unweighted **revealed piece-count** lead. Almost every game qualifies,
making this a weak conversion diagnostic. No human piece values were assigned.
These counts cannot establish endgame conversion from a valuable-material lead.

## Optimization and likely limitations

Mean approximate KL was .00553, maximum update-average .00881; mean clip fraction
.0768. Every update changed parameters (L2 step range .86–2.42). Losses and
gradients stayed finite. Exact weights, output probabilities, values, optimizer
states, and subsequent seeded Adam updates survived checkpoint reload in tests.

The critic remains weak: rollout-time explained variance averaged **−.356**, ending
at **−.170**, and was usually negative. That indicates outcome predictions often
performed worse than a constant baseline. It is not proof of numerical instability;
KL, gradients, and parameter changes showed no corresponding explosion.

The most directly supported limitations are **very little training** (about 1,000
games), sparse/noisy terminal outcomes, a weak value baseline, and one training
seed. The model has not demonstrated reliable exploitation of Random and lost all
small EV/AI-6A samples. Insufficient exploration of useful situations remains
possible despite high aggregate entropy. No terminal-reward sign or propagation
defect was found; complete-trajectory returns were explicitly verified for wins,
draws, losses, and both seats.

Environment throughput was adequate for this pilot. Pretraining measurements
handled about 8,200–9,000 bridged random steps/second. A 16-position neural forward
batch was .248 ms on CPU versus 2.677 ms on MPS; GPU launch/transfer overhead makes
MPS unattractive at this model size. The postflight breakdown found:

| Component                                           |            Measured cost |
| --------------------------------------------------- | -----------------------: |
| Core transition, including outcome checks           |         about 48 μs/step |
| Separate legal enumeration for the next observation |  about 48 μs/observation |
| Node public encoding                                |   about 3 μs/observation |
| Node JSON serialization                             |   about 2 μs/observation |
| Empty batched IPC round trip                        |      about 32 μs/request |
| Python encoding, initial empty history              |  about 13 μs/observation |
| Python encoding, 20-event history                   | about 172 μs/observation |

These are microbenchmarks on a working machine, not additive guarantees. The
largest measured per-observation cost is Python history/category construction;
policy sampling, separate opponent groups, small end-of-batch tails, and IPC also
reduce collection throughput. No distributed framework or rules optimization was
introduced. The preflight and postflight measurements are archived separately;
the populated-history and empty-IPC probes were added after training.

## Artifacts and representative games

- Architecture/observation specification and CLI:
  [implementation guide](ai7-selfplay.md).
- Raw curves: `pilot-seed7-20261114/metrics.jsonl` and `learning-curves.csv`.
- Standalone plot: `pilot-seed7-20261114/learning-curves.png` and `.svg`.
- Complete trusted transcripts: `pilot-eval-random-complete/replays/`.
- Example draw: `final-random-seed-2000000-seat-0.json` — 228 plies,
  NO_PROGRESS, 20 own-move reversals across both players.
- Example learner win: `final-random-seed-2000000-seat-1.json` — learner P2,
  NO_PIECES win at ply 168.
- Example learner loss: `final-random-seed-2000001-seat-1.json` — learner P2,
  P1 wins by NO_PIECES at ply 183.

All named game files have verified deterministic replay. Isolated wins and legal
captures are not evidence of learned tactical skill: Random produces those too.
The source snapshot under the run directory matches every training-manifest source
hash, including the original two training dependencies. Plotting was added later.
Each evaluation's provenance identifies that executed snapshot and checkpoint
hashes. Archives contain private decks for replay, are written directly by Node,
and never feed policy inputs or PPO samples.

Verification passed: **839 TypeScript tests across 48 files**, five Python
correctness/integration tests, lint, Prettier, TypeScript checks, and production
build. No UI behavior changed. Core/rules match the required pin; heuristic-agent
and browser source are unchanged; the original Branch A checkout remains clean.

## Separate next experiments — proposed, not run

1. A terminal-only extension with **up to four additional training hours total**,
   split among three fresh training seeds, would test reproducibility and larger
   sample sizes. Predeclare substantially larger step/update bounds, a bounded
   historical save schedule, an unchanged primary endpoint, and fresh held-out deck
   sets. The current V1 CLI's 128-update safety limit must be explicitly revised for
   that approved extension; it is unsuitable for hours of sustained training at
   the measured speed. Keep the total artifact cap and leave CPU headroom.
2. Before expensive continuation, profile and batch the public history encoder.
   Preserve the observation specification and verify byte-for-byte equivalent
   policy features. Measure whether wall-time capacity improves.
3. Add frozen, evaluation-only Core-validated tactical/defensive/FLIP/coordination
   and endgame probes, plus stronger public conversion diagnostics. These must not
   become expert labels, reward features, or training curricula. Claims about
   learned piece values need independent tests, not assigned diagnostic weights.
4. If a larger unchanged-reward experiment still fails, report that negative
   result. Compare exploration settings, opponent mixture, and value-estimation
   choices in separately controlled runs before proposing curriculum or shaping.

No reward shaping, curriculum, search, heuristic inputs, or automatic four-hour
extension has been implemented or run.
