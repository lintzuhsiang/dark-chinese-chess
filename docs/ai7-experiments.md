# AI-7 self-play experiment archive

Implementation is maintained on `experiment/selfplay-zero`, based on `c377a68`, in the
existing `experiment/selfplay-zero` worktree. Branch A remains on `phase-2`.
The three commits separate the reusable self-play implementation, Exp 1 campaign,
and Exp 2 instrumentation and controlled treatments. This is a reviewable split
of previously uncommitted work, not a claim that these commits existed during
training. Exp 1 source files come from its frozen source snapshot; Exp 2 records
the subsequent implementation changes.

- Self-play: [protocol](ai7-selfplay.md), [pilot results](ai7-pilot-report.md).
- Exp 1: [architecture protocol](ai7-overnight.md),
  [results](ai7-results/exp1/summary.md),
  [W/D/L and diagnostics](ai7-results/exp1/comparison.csv),
  [structured results](ai7-results/exp1/comparison.json),
  [learning failure analysis](ai7-results/exp1/failure-analysis.md).
- Exp 2: [P0 instrumentation](ai7-instrumentation.md),
  [P0 report](ai7-results/exp2/instrumentation-report.md),
  [P0 validation](ai7-results/exp2/instrumentation-validation.md),
  [P1/P2 protocol](ai7-p1p2.md), [results](ai7-results/exp2/summary.md),
  [W/D/L and diagnostics](ai7-results/exp2/comparison.csv),
  [structured results](ai7-results/exp2/comparison.json),
  [research review](ai7-results/exp2/research-review.md).

Reports are historical records. References inside them to filenames such as
`config.json`, checkpoints or manifests refer to their original artifact
folders, not this small Git archive. Markdown/JSON formatting may be normalized;
original reports and frozen source hashes remain in the artifact folders below.

## Local artifacts (excluded from Git)

Under `benchmark-results/ai7-selfplay/`:

- `overnight-comparison/20261114-v1/`: Exp 1 runs and frozen source snapshot.
- `learning-failure-analysis/20261114-v1/`: Exp 1 additional evaluations.
- `instrumentation-phase1/20261114-v1/`: P0 runs and validation evidence.
- `p1p2-comparison/20261114-v1/`: Exp 2 runs and frozen source snapshot.
- `p1p2-analysis/20261114-v1/`: Exp 2 detailed analysis.

Checkpoints, full trajectories, logs, generated plots, environments and installed
dependencies remain local and ignored. Git contains runnable tools, protocols,
tests and small result summaries; it does not contain every artifact needed to
rerun checkpoint analysis without the local data. Source snapshots and artifact
provenance retain the original branch/revision from run time.

GameCore, existing AI baselines and browser behavior are unchanged. No new
training, remote push, merge or deployment is part of this archive operation.
