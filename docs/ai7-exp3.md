# Experiment 3 — M1 overnight

Five arms, paired fresh seeds 5011/5023/5037: Baseline; NO_PROGRESS terminal
reward -0.05; NO_PROGRESS -0.2; 30% of games from an independent legal endgame
prefix pool; per-game 180-degree observation/action rotation. Other settings use
the Exp 2 Baseline. All start from identical random weights per seed. Reward
penalties change terminal utility, not GameCore. Evaluation always uses original
W/D/L. Other draws remain zero. No capture, flip, repetition or attacker reward.

Output: `benchmark-results/ai7-selfplay/exp3/20261115-m1/`.

## Protocol and resources

Preflight tests all five arms, exact resume, paired initial weights and 65,536
transitions per arm before freezing a common target <=3.64M. The target uses a
30% slowdown margin, 90-minute evaluation/analysis reserve, and 30-minute general
overhead reserve within the seven-hour campaign budget. Runs are sequential,
CPU2, batch16, nice10; no GPU is assumed. Disk headroom is 30GiB, replacing 5GB
artifact caps only when explicitly enabled through AI7_DISK_HEADROOM. No old
artifacts are deleted. Training milestones are quarter steps. Config and source
SHA snapshots are frozen before launch; no outcome-based target selection.

The public-input curriculum pool has 1,024 independently seeded random-play
prefixes from seeds starting at14M, fully revealed <=6-piece states, first
qualifying state per game. No tactical labels select starts. Original deck,
accepted actions and full public memory are replayed through Core. Starting seat
is sampled independently. 30% refers to game specifications, not transitions;
report prefix plies separately. Setup transitions are not PPO training samples.
The pool, old400-state evaluation bank, reserved confirmation bank, and held-out
match seeds have disjoint ranges. The reserved bank remains unused tonight.

Rotation is selected deterministically from the independently sampled action
seed. Learner input board, references, history, legal mask and action IDs rotate;
actions map back before Core. Features, selected action and old log probability
stored for PPO all use the same transformed frame. Opponents use normal public
coordinates; this is a learner-observation augmentation only. Actual Core archive
coordinates remain original. No extra inference is used for policy averaging.

## Recording

Windowed full audit uses rollout-start step fractions [0,.01), [.245,.255),
[.495,.505), [.745,.755), [.99,1]. All minibatches in those windows record gradient
summaries and actual Adam/Probe changes. Outside windows, P0 detailed gradients
remain sampled; those minibatches cannot be treated as fully observed.

Every saved-game learner decision retains its old legal probability distribution,
value, original outcome, objective return target, raw/normalized advantage and
quiet counter, even outside full windows. Original outcome and shaped return are
separate so draw gradients stay classified as draws. Per run: up to2048 replays,
seed-based1/16 sampling; 8GB diagnostic payload cap, plus disk headroom. The cap
is a stop/rollback boundary, not silent truncation. All interrupted trajectories
are disclosed and excluded from PPO.

## Evaluation and attached analyses

- Initial/final vs Random:256 swapped-seat deck pairs, seed start16M.
- Initial/final vs fixed Exp2 baseline-seed-4011 and random_rich-seed-4037:128 pairs each at17M. SHA pinned.
- Every saved checkpoint on the same existing400 independent tactical positions
  plus rotations: win/defense probability, symmetry gap, policy equivariance,
  argmax target accuracy/ranks, paired initial changes, full trajectory.
- Replay <=64 saved games per run, evenly spaced by archived chronology, validate
  final state/history and classify fully revealed learner suffix decisions. Join
  game/ply to stored rollout-time probabilities, value/advantage and audit scope.
  This is a bounded sample, not a full-training coverage estimate.
- Report quiet<40 / quiet>=40 advantage distributions by original outcome.
- Final treatment vs matched-seed final Baseline:64 deck pairs at18M.
- Report original W/D/L, NO_PROGRESS rates and matched-training-seed contrasts;
  n=3 is exploratory. Game/bootstrap intervals do not replace training seed
  replication, and multiple comparisons require cautious interpretation.

No final result is promised before the run completes. Partial/incomplete jobs
must be explicit and cannot be counted as equal-budget evidence. Fewer draws with
more losses is not success. Changed utility, curriculum and symmetry are distinct
interventions; interactions are not tested tonight.

## Driver

`python -m scripts.ai7.exp3 --mode prepare` creates gates/profiles/config;
`--mode run` executes the frozen campaign. The detached launcher uses nohup,
caffeinate and nice10; campaign status and active child are written atomically.
The absolute training deadline leaves evaluation reserve; per-child timeout,
process-group termination and disk guard bound runaway work. Source checks happen
before each training run. A changed source requires investigation, not live edits.

## Archived campaign status (2026-11-15)

This commit archives the executed implementation; it does not claim that every
planned arm completed. The frozen preflight target was 2,000,000 transitions per
run, with seeds 5011/5023/5037. Baseline, NO_PROGRESS −0.05, NO_PROGRESS −0.2 and
rotation completed all three finals. The three curriculum runs failed before
completion; there is no All Draw −0.2 arm in this campaign.

Known limitations retained for reproducibility:

- Curriculum can terminate on an opponent move before the first learner decision;
  the collector raises `Terminal game without a learner decision`.
- The original aggregate analysis assumes all planned `final.pt` files exist and
  aborts when curriculum endpoints are missing. The later recovery analysis
  explicitly excludes those incomplete runs.
- Campaign paths and dates are specific to the archived M1 overnight run.

Intel common-protocol evaluation and M1/Intel comparison integration are kept on
`experiment/shared-evaluation`; they are not part of this training change set.
