# Intel Campaign 4A: GAE × value-head training

Branch: `experiment/intel-4a-gae-critic`. No commit, push or deployment is part
of this campaign. Existing trainer, runtime, Core and earlier models remain
unchanged. New code is isolated under `scripts/ai7_4a/`.

Three fresh training RNG seeds 7011/7023/7037; four treatments: A0=.95/OFF,
A1=.95/ON, A2=.80/OFF, A3=.80/ON. Each run completes exactly 3,640,000
environment transitions, including incomplete-game transitions; incomplete games
are excluded from PPO as in the established collector. Total 43,680,000.
One heavy trainer at a time, no wall-time shortening or score-based stopping.
Milestones: initial, .91M, 1.82M, 2.73M, 3.64M; final is the primary endpoint.

The adapter invokes the unchanged original standard PPO optimization. The only
learning interventions are lambda and two extra value-head passes. Frozen GAE
returns are computed before PPO. After standard PPO, the trunk's hidden features
are detached, shared/body and actor parameters are frozen, and exactly two full
passes in fixed rollout order update only the existing linear critic head.
Adam LR3e-4/eps1e-5/betas(.9,.999), minibatch256, loss=.5*MSE, head-only gradient
clip .5. No extra RNG draws. The separate value optimizer is stored as
`checkpoint['optimizer']['extra_value_optimizer']`; PPO's own state/parameter
groups are unchanged. A checkpoint includes both after the complete update.
Interrupted extra passes roll back with the model/PPO boundary and restore the
value optimizer. Logs record extra steps/time separately; resumable log offsets
prevent replayed records from being counted twice.

The original gamma1, LR3e-4, epochs4, entropy/clipping, MLP, masks, public inputs,
rollout16, minibatch256, opponent mixture and +1/0/−1 terminal rewards remain.
This head-only intervention does not test a new architecture, full PPG, or
additional representation learning. Its failure would not refute all forms of
better critic training.

Frozen opponents: Uniform Random, M1 Exp2 Baseline4023 final, and Intel GAE095
seed6011 final selected by seed identity. Original checkpoint bytes/hashes and
reference inference are checked. The portable training-reference bundle contains
the actual successful old configuration and source, not today's integrated code.

The proposed new common protocol has 256 deck pairs in the 21M namespace, both
seats, stochastic temperature1 masked categorical, independent PCG64 role
streams, explicit deck-derived seeds, official score 1/.5/0 and authoritative
Core stopping. Old 20M results are already-used data. A separate 32-deck
calibration namespace uses the frozen reference policy against Baseline4023;
all models predict the same public states and reference-policy sampled terminal
returns. These off-policy noisy outcomes are not exact ground truth for each new
policy. Average both seats per reference deck for uncertainty. Training-target
value loss/explained variance stay separately labeled as lambda dependent.

Manifest content/opponent hashes/source kernels are fixed before new final
results. M1 must return an explicit inventory confirmation referencing that exact
manifest SHA before final new-seed evaluation. Training proceeds independently.
Secondary tactical diagnostics use only the previously explored Stage2 400
positions, both orientations; the reserved 100+100 bank is never read.

Factorial contrasts: A2−A0, A3−A1, A1−A0, A3−A2, and interaction
(A3−A2)−(A1−A0). Score, win/loss/NO_PROGRESS, length, tactical quality and
common-reference MSE remain separate. Report each training seed; conditional
paired-deck bootstrap (10000, seed19) and paired-position bootstrap (4000,
seed91023) differ from exploratory n=3 training-seed t95 intervals. No multiplicity
adjustment or universal-mechanism claim. There is no new lambda1 control arm.

Correctness gates cover synthetic .95/.80 GAE, exact policy/trunk/logits/PPO/RNG
invariance during extra passes, real-Core A0 equivalence, exact A1/A2/A3 resume,
mask/public-input and terminal/truncation behavior. Pilots use bounded transitions
for correctness, never held-out score for selection. All artifacts and reports
are under `benchmark-results/ai7-selfplay/gae-critic-factorial-20261115/`.

Entry points (existing Intel Python3.11 environment and Node26 on PATH):

```sh
.venv-intel/bin/python -B -m unittest scripts.ai7_4a.tests.CorrectnessTests -v
.venv-intel/bin/python -B -m scripts.ai7_4a.campaign prepare
.venv-intel/bin/python -B -m scripts.ai7_4a.campaign run
```

The supervisor produces per-run logs/status/checkpoints, factorial CSV/JSON,
learning curves, common-value calibration, research-report.md and next-decision.md.
Without the M1 inventory response it records the evaluation as pending rather
than inventing results. Failed/short runs are retained and excluded from complete
factorial comparisons. Original results are never overwritten.
