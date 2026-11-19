# 21M B1−B0 confirmatory evaluation — verified final report

## Primary conclusion

**The preregistered superiority criterion was not met.** B1 has a positive mean score difference of +2.96 percentage points against frozen Intel GAE095 seed6011, with all three seed estimates positive. The preregistered seed-level 95% t interval is [−1.77,+7.69]pp and includes zero. This is inconclusive for superiority, not proof of equivalence or no effect.

Confirmatory describes the frozen prospective comparison, not a guarantee of positive results. We retain the original endpoint and interval after observing outcomes. Three positive seed signs alone have one-sided sign-test probability .125 under the fair-sign null; they do not independently establish .05 significance.

## Execution and verification

- All 18 predetermined matchups completed: six final models ×three opponents ×512 games =9,216 unique games.
- Exact deck IDs21000000–21000255, both seats; every game starts from the normal full initial board.
- All per-game winners/returns, learner seats, RNG identifiers, checkpoint hashes, terminal reasons and deck pairs were rechecked.
- Original six models, two neural opponents, shared manifest, sealed preregistration and joint-freeze hashes remain unchanged. Uniform Random is the third algorithmic opponent, not a third checkpoint.
- The initial output-subdirectory error and deterministic recovery are retained in output-recovery.json. The first in-memory matchup was lost before persistence or score inspection and replayed with unchanged models/RNG/protocol; it is not counted twice. No outcome-based rerun or checkpoint selection.
- No training,22M rollouts/calibration, reserved tactical bank or intermediate model selection. Existing conformance used only already-explored fixtures.

## Primary paired training-seed effects

| Training seed | B1−B0 score (pp) | Conditional paired-deck bootstrap95 (pp) |
| ------------- | ---------------: | ---------------------------------------- |
| 7011          |            +2.93 | [-0.98,+6.74]                            |
| 7023          |            +4.88 | [+1.27,+8.50]                            |
| 7037          |            +1.07 | [-2.93,+5.18]                            |

The deck bootstrap uses10,000 PCG64 seed19 resamples, paired by deck and both seats, conditional on each fixed model. It does not create additional training replications. Only seed7023 has a conditional deck interval entirely above zero. The primary learning-replication unit remains three training seeds.

## W/D/L and descriptive scores

Each row pools1,536 games for descriptive counts; equal seed sample sizes make its score equal the mean of the three seed scores. This pooling is not used to pretend n=1,536 independent training runs.

| Opponent              | Treatment | W/D/L       |  Score | Loss rate | NO_PROGRESS | Mean/median plies |
| --------------------- | --------- | ----------- | -----: | --------: | ----------: | ----------------- |
| intel_gae095_seed6011 | B0        | 256/982/298 | 48.63% |    19.40% |      63.54% | 237.82/235        |
| intel_gae095_seed6011 | B1        | 325/935/276 | 51.60% |    17.97% |      60.81% | 230.74/228        |
| historical4023        | B0        | 446/991/99  | 61.30% |     6.45% |      64.32% | 229.39/226        |
| historical4023        | B1        | 487/923/126 | 61.75% |     8.20% |      59.77% | 232.97/233        |
| random                | B0        | 616/860/60  | 68.10% |     3.91% |      55.92% | 217.02/214        |
| random                | B1        | 699/781/56  | 70.93% |     3.65% |      50.72% | 214.74/213        |

## Win/loss decomposition

Score difference =0.5×(win-rate difference −loss-rate difference).

| Opponent              | Extra wins | Draw change | Loss change | Win contribution (pp) | Loss contribution (pp) | Score effect (pp) |
| --------------------- | ---------: | ----------: | ----------: | --------------------: | ---------------------: | ----------------: |
| intel_gae095_seed6011 |        +69 |         -47 |         -22 |                 +2.25 |                  +0.72 |             +2.96 |
| historical4023        |        +41 |         -68 |         +27 |                 +1.33 |                  -0.88 |             +0.46 |
| random                |        +83 |         -79 |          -4 |                 +2.70 |                  +0.13 |             +2.83 |

Against the primary Intel opponent, B1 produced69 more wins and22 fewer losses. Its positive estimate is not solely draw-seeking or loss avoidance. Against Historical4023,41 additional wins were partly offset by27 additional losses; the score gain was only+.46pp. Therefore lower draw/NO_PROGRESS frequency is not a universal risk improvement.

## Prespecified secondary comparisons

| Opponent              | Three seed effects (pp) | Mean (pp) | Seed t95 (pp) |
| --------------------- | ----------------------- | --------: | ------------- |
| intel_gae095_seed6011 | +2.93, +4.88, +1.07     |     +2.96 | [-1.77,+7.69] |
| historical4023        | +0.59, +0.59, +0.20     |     +0.46 | [-0.10,+1.02] |
| random                | +2.73, +4.98, +0.78     |     +2.83 | [-2.39,+8.05] |

All nine seed-by-opponent point differences are positive. They are correlated across opponents for the same trained models and do not constitute nine independent learning replications. Secondary endpoints are descriptive, without familywise superiority claims. No post-hoc loss noninferiority margin or new success criterion is introduced.

## Relation to the previous20M exploration

The previous20M estimates favoredB1 by+4.30pp against Intel and+3.26pp against Historical4023. On21M they are+2.96pp and+.46pp. The direction persists, but effect magnitude varies substantially across deck sets. These are the same trained models: the changed estimates are not training deterioration. Do not pool the explored20M results with21M to rescue significance or alter the preregistered test.

## Audit and compatibility limitations

The joint freeze uses the supplied Intel audit and current local M1 checks. The remote Intel audit verifies current source/checkpoint identities and cites prior dynamic reference conformance; M1 does not claim to have independently rerun Intel hardware. Both audits exclude unrecorded/out-of-scope activity and retain their stated cache/history limitations. These conditions were fixed before21M outcomes, not silently promoted to universal freshness proof.

The seed t interval assumes approximately normal training-seed effects and is fragile at n=3. Conditional deck uncertainty and training variability remain separate. These results cannot establish broad superiority against arbitrary opponents, a global optimal restart ratio, a representation mechanism, or the benefit of B3. No new tactical confirmation was run, so the earlier explored-bank defense trade-off has not been independently confirmed or disproved.

## Research decision

Keep B1 as a promising candidate, not a confirmed replacement for B0. The normal-start positive direction survives21M across all three seeds/opponents, but the preregistered primary statistical criterion remains inconclusive. Additional independent training-seed replication would address a limitation that merely adding more games against the same three models cannot fully resolve. Any such study needs its own prospective authorization and plan; none is started here.

Historical4023 loss increases make risk/defense a necessary consideration in that next design. Mechanistic claims about stage diversity, critic accuracy or archive overfitting remain unisolated.22M remains unrun on this M1 task and must not be silently added to reinterpret the completed primary endpoint.

## Data exposure and reproducibility

21M is now evaluated and exposed for the M1 B0/B1 cohort. It must not be described as fresh for future model/treatment choices informed by this report. Earlier MANIFEST_ONLY audit records remain historical pre-execution evidence.

Files: preregistration.json/sha256; joint-freeze.json; joint-gates.json; audit-reconciliation.json; m1-current-conformance.json; results/*.json; per-game-results.jsonl; paired-seed-analysis.json; completion-verification.json; verify-completed-analysis.py. The verification script reads existing records only and does not launch games.

The original short confirmatory-report.md is preserved; this file expands its interpretation without changing its decision.
