# AI-7 P1/P2 controlled experiment

This experiment tests update stability (P1) and opponent experience (P2), after
P0 instrumentation validation. All arms train the same randomly initialized
429,857-parameter baseline MLP. No Core, Chase v4, browser, existing heuristic AI,
reward, observation or action-mask changes are permitted. Training does not
commit, push, merge or deploy. The implementation and small result reports were
subsequently archived on `experiment/selfplay-zero` at the owner's request.

| Treatment        | Learning rate | Opponent mixture after the unchanged four-update warmup |
| ---------------- | ------------: | ------------------------------------------------------- |
| baseline         |        0.0003 | current .5 / Random .1 / recent .25 / older .15         |
| low_lr (P1)      |        0.0001 | same as baseline                                        |
| random_rich (P2) |        0.0003 | current .3 / Random .4 / recent .2 / older .1           |

All other PPO settings remain fixed: gamma=lambda=1, four epochs, batch256,
clip.2, targetKL.03, value coefficient.5, entropy coefficient.01, grad norm.5.
Training rewards remain terminal +1/0/-1 and intermediate0. Seeds4011/4023/4037
are new independent replications. Three treatments x three seeds are sequential,
CPU2 threads,16 simultaneous environments, lower OS priority, with Latin-square
order. Initial actor weights are identical within each matched seed.

P0 instrumentation remains enabled, with exactly its previous predetermined
sampling schedule: first10 updates then every10th update, first minibatch of each
epoch. Every completed update has probe KL, action masses, advantage and outcome
composition. Unsampled gradients are absent, never reconstructed or imputed.
Negative gradient cosine and probe losses establish association, not causality.

Target3.64M transitions per run, identical across all9. Preflight measures65,536
steps for each treatment, including diagnostics. The fixed plan retains910k
historical snapshot/validation intervals. If forecasts exceed the seven-hour
campaign budget, reduce all nine targets equally before launch, including a50%
slowdown allowance, per-run overhead,90-minute evaluation reserve and3-minute
report reserve. Config.json records the finalized target. No adaptive target or
checkpoint selection is based on final results. Actual partial runs are disclosed
and excluded from equal-budget aggregates.

Validation:32 swapped-seat pairs from1,300,000 at initial/milestones. Primary test:
Initial and Final vs Uniform Random,256 pairs from6,000,000 (512 games each).
Generalization: Initial and Final vs the fixed historical MLP baseline-seed-11
endpoint of the old overnight campaign,64 pairs from7,000,000; hash checked before
each child job. The historical evaluation tool also records a separate64-pair
Random control on those seeds; do not pool this auxiliary set into the primary
inference after inspecting results.

Existing P0 probes remain diagnostics only. Final confirmation uses8 previously
unevaluated180-degree Core-replayed geometric counterparts, including a repetition
case. These are narrow symmetry probes, not independent samples of every tactical
concept. Both initial/final probabilities are reported; probes never enter loss,
action selection, stopping or checkpoint selection.

Read final results in `overnight-summary.md`, `comparison.csv/json`,
`learning-curves.png`, per-run metrics/manifests/checkpoints and structured logs,
`historical-evaluations`, and `probes`. The legacy `architecture` column denotes
treatment here; model_config identifies the baseline MLP in every case. Source
snapshots preserve uncommitted implementation exactly. Prior campaign files remain
untouched. Configuration and LR/mixture cannot be changed during exact resume.

P1 success requires retained capability and competitive final results, not merely
smaller KL or slower learning. P2 success requires increased wins and evidence of
historical-opponent generalization; fewer losses/more draws alone is insufficient.
Report W/D/L changes, individual paired-deck confidence intervals, and matched
training-seed contrasts. Three training seeds provide limited precision; never
pool games as independent learning replications or declare a winner from points.

The detached guard/supervisor continues independently of Codex. Seven-hour and
5GB limits, atomic checkpoints, progress/status, deadline-aware cleanup, and
partial-result reporting are inherited from the verified local runner. Idle sleep
is inhibited; powered Mac with lid open is required. No cloud services are used.
