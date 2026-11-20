# Campaign 4B: verified Intel reference integration

The owner supplied `Downloads/intel-gae095-training-reference-v1`. The original
archive SHA-256 is `4682f71c420a673be195bd8965fc9ababe68631f166f14ed04010633f1280b76`.
The compressed archive matches its supplied sidecar, every extracted static file
matches `checksums.sha256`, and the untouched checkpoint tensors match the portable
weights. The maximum public reference probability error on M1 is
`1.1920928955078125e-07`, below the reference tolerance `1e-5`.

The supplied manifest records Intel Python 3.11.15 / Torch 2.2.2 / NumPy 1.26.4.
Actual M1 verification uses Python 3.9.6 / Torch 2.8.0 / NumPy 2.0.2. This establishes
loading and reference inference compatibility, not bitwise cross-machine training.

## Reconciled source

Core files match byte for byte; no Core changes were imported. `Policy`, `encode`,
`mask_array`, `advantages` and opponent sampling match the original source.
The local collector differs only for the previously tested restart path, reward
accounting and timing/ID metadata.

`train.py` and `learning_methods.py` were imported from the verified bundle before
adding the restart adapter. Intel's CHAIN-lite implementation is retained as
source provenance but disabled: every Campaign 4B run uses
`learning_method=gae_lambda_095`, `gae_lambda=.95`, `gamma=1`, `chain_alpha=0`.
All other PPO settings and the original opponent mixture remain unchanged.
On an identical M1 complete-game batch and identical optimizer RNG, the integrated
GAE095 optimizer produced exactly the same model tensors and Adam state as the
original Intel `optimize` function.

The adapter adds a separate archive sampling RNG, immutable resume configuration,
checkpointed sampler state and interrupted-update rollback. The original training
RNG still draws decks, seats, action streams and opponents in the same order.
Completed episodes without a learner decision do not contribute PPO rows. Audit
records now carry actual game IDs even when such an episode is omitted from the
trajectory list. The `until_step_target` flag comes directly from Intel and removes
the old wall-clock cutoff; it does not reduce the environment-transition budget.

CLI tests exercised B0, B1 and B2 at exactly 6,000 transitions, comparing full runs
against a stop/resume after two optimizer updates. Models, Adam, Torch/opponent
sampling RNGs, opponent pools, completed game logs and sampler counters/choices
matched exactly. Timings are measured separately and are not expected to match.

## Execution and remaining limitations

`restart_campaign.py` freezes source/configuration before sequential CPU-only
training. The verified execution directory is
`benchmark-results/ai7-selfplay/gae-restart-strategies-20261115/verified-training-v1/`.
It contains exact source snapshots, the nine-run Latin-square schedule, per-run
commands, pilots, checkpoint hashes, logs and atomic status. Each run has initial,
0.91M, 1.82M, 2.73M and 3.64M checkpoints; the final endpoint is never selected by
scores. Training is limited to two Torch threads and one intensive job at a time.
The supervisor refuses duplicate execution and checks disk headroom; failures leave
partial artifacts for investigation. Resuming a failed campaign is an explicit
recovery operation, while the single-run CLI supports exact checkpoint resume.

B0/B1/B2 each receive three fresh training seeds 7011/7023/7037 and exactly
3,640,000 transitions per run. B3 is explicitly unavailable because the existing
archive has hidden-information states without verified replicated compatible
hidden-layout targets. Neither single source outcomes, tactical priorities nor a
fully-revealed-only substitute are used. Nine completed runs will not be reported
as twelve completed runs or as a conclusive test of the priority hypothesis.

Three separate 65,536-transition training pilots use seed 87041, not the fresh
experimental training seeds. They include real PPO updates and the reference
validation/checkpoint schedule. `pilot-gates.json` is written only when all three
reach their exact endpoints and their final model metadata passes verification.

The proposed common protocol has SHA-256
`a890517417e4828b32aaa1089e5d4375831c9d8e9ccd451a879e6f921c3f1592`.
The local response is `M1-confirmation.json`, with evidence in
`campaign4-M1-inventory.json`. Its scope is the accessible historical campaign
metadata and documented namespaces; Intel acknowledgment and evaluator conformance
remain required. The 21,000,000–21,000,255 decks and 22,000,000–22,000,031 calibration
namespace have not been evaluated here. No final evaluation or reserved tactical
bank access is performed by the training supervisor.

## Commands

Run from the M1 integration worktree, using the existing M1 Python environment:

```sh
../selfplay-zero/.venv/bin/python -m unittest scripts.ai7.tests.test_restart -v
../selfplay-zero/.venv/bin/python -m scripts.ai7.restart_campaign prepare
../selfplay-zero/.venv/bin/python -m scripts.ai7.restart_campaign pilot
../selfplay-zero/.venv/bin/python -m scripts.ai7.restart_campaign launch
```

Preparation and execution refuse existing output/status records. The commands
above document the actual campaign; inspect existing status before attempting to
repeat them. Detached launch uses nice10, nohup, caffeinate and a new OS session.
This inhibits idle sleep; it does not override lid closure, reboot or power loss.
No commit, push, hosting or deployment is part of this execution.

## Verified launch status

All three 65,536-transition training pilots passed. Final checks passed lint,
formatting, typecheck, 851 TypeScript tests, 43 Python tests and production build.
After the pilots, the supervisor gained only per-child CPU accounting via
`resource.getrusage`. An exact diff verified that this did not alter execution,
sampling or PPO. The original pilot config/source is preserved and the final
source fingerprint reconciliation is recorded explicitly in `config.json`.

The detached supervisor was launched and independently observed with parent PID 1.
B0 seed7011 was observed running beyond 52,000 transitions toward 3,640,000.
This is a running campaign, not a completed experiment. Inspect `run-status.json`
and `runs/B0-seed-7011/status.json` for current progress. The nine scheduled valid
runs are 32,760,000 transitions; the three unavailable B3 runs are not counted as
completed. Formal evaluation remains gated on the shared protocol confirmation.
