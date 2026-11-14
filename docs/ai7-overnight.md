# AI-7 overnight controlled architecture campaign

This extends the first terminal-only PPO pilot. It does not change GameCore, Chase
v4, existing AI baselines, Branch A, or the browser default. The experiment runs in
the existing `experiment/selfplay-zero` worktree, now on `ai-self-play`. Original
run sources remain preserved as exact source snapshots and hashes. Archiving the
implementation in Git is separate from campaign execution; the campaign does not
push, merge, or deploy changes.

## Independent workstreams and configurations

Four Codex subagents implemented infrastructure, an independent larger critic,
the board CNN, and evaluation/research respectively, with non-overlapping file
ownership. The coordinator integrated and reviewed their interfaces and owns the
local supervisor. CPU-intensive training and smoke profiles run sequentially.

| Configuration   | Network                                                                                  | Parameters |
| --------------- | ---------------------------------------------------------------------------------------- | ---------: |
| Baseline        | Existing shared 2163→128→128 MLP, policy/value heads                                     |    429,857 |
| Improved Critic | Identical actor, independent 2163→256→256→128→1 value MLP                                |  1,082,529 |
| Board CNN       | Two 32-channel 3×3 convolutions, separate 595-feature public encoder, combined MLP/heads |    400,129 |

The critic model's initial actor weights match the baseline exactly for seeds 11,
23, and 37. The CNN has a similar but not exactly matched parameter count. Core's
board is eight rows of four columns, row-major; the CNN maps all 16 board-category
and 33 reveal-reference categories per square into 49 channels without pooling.
It retains every feature from the same 2,163-float public observation. The remaining
595 inventory/history/rule-state inputs use their own encoder.

All nine runs start with random initialization. The first pilot's learned weights
are not reused. Architecture is the sole primary configuration difference. PPO,
terminal rewards, action masks, public information, batch size, threads, optimizer,
and opponent sampling probabilities are identical. Shared-gradient flow changes
when the critic is separated, as intended by that architecture experiment.

## Predeclared comparison protocol

- Exactly three training seeds per configuration: 11, 23, 37.
- Initial target: 4,000,000 authoritative environment transitions per run.
- The common target is finalized **before campaign training** from sequential
  32,768-step end-to-end profiles of all three configurations, with a 50% slowdown
  allowance, one hour reserved for evaluation, three minutes for final reporting,
  and additional scheduling headroom. If needed, every architecture/seed receives
  the same reduced step target. `config.json` is the authority for the chosen budget.
- A Latin-square execution order balances architecture order across the seeds:
  baseline/critic/CNN for 11, critic/CNN/baseline for 23, CNN/baseline/critic for 37.
- CPU only, at most two Torch threads, one interop thread, 16 games per batch,
  and only one intensive training job at a time. launchd gives the campaign a
  lower CPU priority and low-priority I/O.
- Quarter-step milestones align validation and historical snapshots across models.
  The older first-pilot snapshot schedule was update-based; the new common schedule
  changes checkpoint availability consistently for all nine retrained configurations.
- PPO remains gamma=1, GAE lambda=1, Adam 3e-4/epsilon1e-5, four epochs,
  minibatch256, clip .2, target KL .03, value coefficient .5, entropy coefficient
  .01, gradient norm cap .5. Rewards remain exactly +1/0/−1 at termination and
  zero elsewhere. No reward shaping, search, imitation, or expert training examples.
- Training deck seeds stay below 900,000. Independent validation uses
  1,100,000–1,100,007, both seats, at the initial and quarter-step checkpoints.
- Final held-out decks are 3,000,000–3,000,127, with swapped seats: 256 planned
  games for the initial and final policy of **each** training run. These decks
  are fresh relative to the first pilot. Action RNG streams reset identically
  for each fixed-policy evaluation.
- The final policy is the predetermined training endpoint. Neither final-test
  outcomes nor probes select checkpoints, tune hyperparameters, or feed PPO.

The environment encoder was vectorized without changing a single float. Tests
compare bytes against the old encoder across real Core prefixes and counter/category
boundaries. Populated-history construction measured about 174.5→33.4 μs locally.
No Banqi rules were moved into Python or reimplemented for speed.

Exact transition caps can end a batch before all games finish. Those games are
explicitly counted as incomplete and excluded from PPO; they never receive a
manufactured draw or bootstrap outcome. Complete learner-seat trajectories and
terminal reward ownership are unchanged.

## Exact recovery and retention

`latest.pt` contains weights, Adam state, Torch/NumPy/Python and opponent-sampling
RNGs, historical opponent weights/configs, counters, milestone state, and raw-log
offsets. Exact resume is tested against uninterrupted training for all three
architectures, including identical completed-game records. SIGTERM interrupts
collection/optimization cooperatively; an interrupted update rolls back all model,
optimizer, and RNG state to a coherent boundary before saving. Rolled-back work
is reported separately. Orphaned raw-log tails are retained separately on recovery.

The single-run CLI accepts `--architecture`, `--resume`, `--deadline-epoch`,
`--checkpoint-every-steps`, `--max-replays`, and validation controls. Resume cannot
change architecture, seed, batch/thread/device settings, validation, or checkpoint
protocol, and cannot extend an existing absolute deadline. The 128-update ceiling
has been replaced by an explicit bounded limit up to 100,000 updates.

Each run retains initial/final/latest and at most three intermediate full
checkpoints; historical policy weights are embedded rather than depending on files
that might be removed. At most four selected full training transcripts and two
evaluation replays per checkpoint are archived. All compact completed-game results
and optimization metrics are retained. Historical experiment directories remain
untouched.

## Unattended supervisor

`prepare_campaign.py` profiles the models sequentially, chooses a feasible common
target, freezes configuration/source hashes, and writes a complete source snapshot.
`launch_campaign.py` registers one task-specific, single-use job in the existing
user launchd domain. Its plist is stored inside the campaign directory; no hosting
or external service is created.

The launchd process holds an idle-sleep assertion with `caffeinate -i` while the
campaign runs. This prevents idle sleep, not lid closure, logout, reboot, power loss,
or forced system sleep. Keep the Mac powered and awake with the lid open for the
intended unattended window. The runner survives normal Codex/tool-session exit.

For the 2026-11-14 campaign, launchd registered successfully but macOS privacy
controls denied its access to the Desktop worktree's `pyvenv.cfg`, so that attempt
started no training. The verified fallback is `launch_detached.py`: `nice -n 10`,
`nohup`, a new OS session, `caffeinate -i`, and the same independent guard/supervisor.
The initiating launcher exited; a separate process check found the guard parented
to PID 1 with the trainer making progress. Proof is in
`independence-verification.json`; the added launcher has a separate source hash in
`detached-launch-status.json`. The failed launchd logs remain available. The actual
campaign is `overnight-comparison/20261114-v1`, with an equal **3,640,000-transition**
target per run and a hard deadline of **09:03 on 2026-11-14, Asia/Taipei**.

An independent lightweight guard process supervises the sequential campaign
process. The seven-hour clock starts with that guard and includes all training,
evaluation, and reporting. The campaign leaves explicit evaluation/report reserves;
the guard starts graceful shutdown before the absolute seven-hour boundary. Each
trainer and evaluator also receives its own absolute deadline so a supervisor
failure cannot remove its time bound. A restart refuses to launch another writer
while a recorded prior heavy job is still alive.

Both Python and Node enforce the campaign-specific 5,000,000,000-byte artifact
budget. Checkpoint writes charge the actual serialized size while the old and
temporary copies coexist. The supervisor reserves 200 MB for orderly shutdown and
reporting, samples usage continuously, and cleans up isolated child process groups.
No cloud compute or paid service is used.

Each run has an atomic `status.json`; `run-status.json` records campaign state,
per-run training/evaluation/probe state, PIDs, commands, reasons, and limits.
Timestamped stdout and stderr are preserved as separate structured JSONL streams.
Checkpoints and progress survive failures. Partial evaluations are retained without
overwriting them; an interrupted game is neither a completed game nor a draw.
The report is regenerated from persisted results, including failures and missing runs.

## Evaluation-only probes and uncertainty

Eight frozen Core-validated public positions cover immediate captures, avoiding an
opponent's immediate terminal winning MOVE, unequal public FLIP risk, a winning
repetition break, and immediate endgame conversion. FLIP risk averages all possible
revealed ranks/colors from public remaining inventory, never the actual hidden deck.

Probe labels and fixture setup do not enter model inputs or training. The existing
cooperative test-position compiler uses setup heuristics solely to construct legal
public histories; those heuristics are not training teachers. Probe results compare
initial/final categorical action mass, not trained action labels. These are narrow
one-move tests and cannot establish general defense, coordination, strategic FLIP
quality, or multi-move endgame conversion.

Each policy receives seat-paired score and difference intervals using independent
deck pairs. Architecture replication uses the **training seed** as its unit:
three seeds, not pooled thousands of games. Reports include exploratory t intervals
(fragile normality assumptions at n=3) and conservative bounded-seed intervals.
Multiple comparisons are disclosed. Highest point estimate alone never selects a
winner. Incomplete/unequal-step runs are excluded from equal-budget aggregates.

EV and AI-6A evaluations are optional and outside the primary Random comparison.
They are omitted from the fixed primary schedule to protect fair completion of
all nine runs; existing pilot baseline results are not presented as new results.

## Inspection and commands

Each campaign has a new directory under
`benchmark-results/ai7-selfplay/overnight-comparison/`. Inspect:

- `config.json`, `preflight-profiles.json`, `source-provenance.json`, `source-snapshot/`.
- `run-status.json`, `guard-status.json`, `launch-status.json`, `logs/`.
- `overnight-summary.md`, `comparison.csv`, `comparison.json`, `learning-curves.png`.
- `runs/{architecture}-seed-{seed}/`, `evaluations/`, `probes/`.

```sh
.venv/bin/python -m scripts.ai7.prepare_campaign --output CAMPAIGN_DIRECTORY
.venv/bin/python -m scripts.ai7.launch_campaign \
  --config CAMPAIGN_DIRECTORY/config.json --label local.banqi.ai7.UNIQUE_LABEL
.venv/bin/python -m scripts.ai7.research --campaign CAMPAIGN_DIRECTORY
```

The coordinator launches only after integrated correctness gates and smoke tests
pass, then verifies the process from a separate tool session using launchd and
live progress. Successful registration alone is not evidence that training is alive.
The eventual report answers the research questions using actual available results;
it does not promise improvement, better critics, faster CNN learning, or tactical skill.
