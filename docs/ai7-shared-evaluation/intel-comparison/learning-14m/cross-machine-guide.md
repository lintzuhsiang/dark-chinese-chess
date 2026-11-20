# Intel AI-7 independent learning-methods campaign

This is a new campaign from the existing `experiment/selfplay-zero` AI-7 PPO
implementation, starting from source commit `96090e4`. It does not resume M1
experiments. Exact uncommitted source snapshots and SHA-256 fingerprints accompany
each campaign; the Git commit alone does not identify the new implementation.
No commit, push, deployment, or existing training interruption is part of this work.

## Fixed design

Nine runs: Baseline, GAE lambda 0.95, and CHAIN-lite, each with training seeds
6011, 6023, 6037. Every run receives exactly 3,640,000 authoritative environment
transitions, including the existing explicit accounting for incomplete games at
milestones. Incomplete games are excluded from PPO and never assigned a draw.
Quarter checkpoints occur at 910,000, 1,820,000, 2,730,000 and the final endpoint.
Initial checkpoints are controls. Intermediate results never select an endpoint.

All arms retain the baseline 2,163→128→128 MLP with 1,056 masked action logits,
429,857 parameters, LR 3e-4, gamma 1, four PPO epochs, minibatch 256, clip 0.2,
target KL 0.03, value coefficient 0.5, entropy coefficient 0.01, and max gradient
norm 0.5. Original terminal rewards are +1/0/−1, with no intermediate rewards.
GameCore, Chase v4, public observation/action representation and original opponent
mixture remain unchanged. The first four updates use current 0.8 / Random 0.2;
subsequently current 0.5 / Random 0.1 / recent 0.25 / older 0.15. Historical
snapshot timing and pool retention are shared between arms.

Only GAE-0.95 changes lambda from 1 to 0.95. Only CHAIN-lite adds:

```text
L_total = L_existing_PPO + 0.1 * mean KL(pi_pre_update || pi_current)
```

The reference set consists of up to 256 evenly spaced learner observations from
the current complete-game training rollout. All public features and legal masks
are retained. The pre-update probabilities and log probabilities are detached and
frozen before any optimizer step and reused throughout that PPO update. Illegal
actions contribute zero to both loss and gradient; their log probabilities are
masked before subtraction to avoid NaNs. The KL reaches the policy head/shared
trunk, with no direct loss on the value head.

Alpha 0.1 is fixed before pilots, using mathematical, masking and gradient sanity
checks only. No held-out performance selects alpha. Reference selection consumes
no RNG. References do not persist between PPO updates, so existing checkpoint
weights, optimizer, RNGs, rollout counters and frozen method configuration suffice
for exact reconstruction after a saved boundary or rolled-back interruption.
This is a CHAIN-inspired simplification, not a reproduction of the published method.

## Correctness and execution

The new tests compare both Baseline and CHAIN alpha=0 against the original
optimizer from commit `96090e4`, including bitwise model and Adam-state equality.
They check a hand-calculated GAE recurrence, forward KL, strict legal masks,
detached references, value-head exclusion, finite gradients, and real Core
uninterrupted versus split/resumed runs for all three treatments.

Each treatment receives a separate bounded 32,768-transition pilot with training
seed 9081. Pilots verify collection, optimization, checkpoint reload, equal
initial policies and instrumentation. They do not evaluate the final-test decks
or select a method/hyperparameter. Pilot throughput produces a forecast only;
there is no reduced target or seven-hour cutoff for the nine full runs.

The Intel dependency file is `scripts/ai7/requirements-intel.txt`: Python 3.11,
PyTorch 2.2.2, NumPy 1.26.4, Matplotlib 3.9.4. Official macOS x86 wheels stop at
PyTorch 2.2.x ([PyTorch announcement](https://dev-discuss.pytorch.org/t/pytorch-macos-x86-builds-deprecation-starting-january-2024/1690)).
The M1 requirement file remains unchanged (PyTorch 2.8.0, NumPy 2.0.2). Record this
dependency mismatch explicitly. Use a Node version supported by `package.json`;
the local campaign uses Node 26.10.0 rather than the preinstalled Node 25.

```sh
# Run from the repository root, with compatible Node on PATH.
python3.11 -m venv .venv-intel
.venv-intel/bin/python -m pip install -r scripts/ai7/requirements-intel.txt
.venv-intel/bin/python -m unittest scripts.ai7.tests.test_intel_methods -v
.venv-intel/bin/python -m unittest scripts.ai7.tests.test_shared_protocol -v
.venv-intel/bin/python -m scripts.ai7.intel_campaign prepare \
  --output benchmark-results/ai7-selfplay/intel-learning/20261115-v1
.venv-intel/bin/python -m scripts.ai7.intel_campaign launch \
  --output benchmark-results/ai7-selfplay/intel-learning/20261115-v1
```

The detached process uses `nice`, `nohup`, a new OS session, and `caffeinate -i`.
It runs one heavy job at a time and survives the initiating terminal/session.
Idle sleep is inhibited; lid closure, logout, power loss and forced sleep can
still interrupt execution. A process lock prevents duplicate supervisors.
Frozen sources are verified before each job. No clock-based budget reduction is
allowed. Existing checkpoint and artifact guards retain failure evidence rather
than claiming incomplete runs finished. Do not edit frozen training/runtime files
during execution. Resume an interrupted campaign with the `run` command only
after verifying its supervisor is no longer alive.

## Shared final evaluation and M1 artifact contract

The campaign creates `shared-evaluation-manifest.json`, `seed-audit.json`,
`intel-source-evidence.json`, `config.json`, `source-snapshot/`, `checksums.json`
and a working-tree patch. This is a new shared final-test protocol, established
after prior experiments; neither original campaign is retrospectively preregistered.

Candidate decks are exactly 14,000,000–14,000,127, exported as 128 integers. Every
deck is played in both focal seats, 256 games per checkpoint/opponent. The audit
checks all accessible local training/validation/evaluation metadata and documented
historical ranges before freezing. Any detected collision chooses a later unused
million range before results and records why. Tactical banks, especially the
reserved 100-win/100-defense set, are not opened, hashed, regenerated or evaluated.
Prior symmetry ranges 11M/12M/13M remain protected.

M1 exclusivity remains **unverified** until its campaign metadata is returned.
This does not delay independent Intel training/evaluation. Once local results are
observed, never change those seeds. A later M1 overlap invalidates shared final-test
status and must be disclosed; keep the Intel results as local evidence.

Uniform Random uses the original collector's ordered legal-action IDs and NumPy
`default_rng`/PCG64 `choice(legal)` without a probability argument. Learned policies
use stochastic masked categorical probabilities, cast the legal probabilities to
float64, normalize and call `choice(legal, p=weights)`. Focal action RNG seed is
`deck_seed XOR 0x13579`; opponent seed additionally XORs `0x5A5A5A5A`. Reset both
streams for every game, seat, checkpoint and matchup. Temperature is 1. CPU,
two Torch threads, batch of 16 games, legal masks, seeded deck generation and
authoritative terminal handling are fixed in the manifest. A 4,096-ply safety
failure is an error, never an artificial draw.

The shared historical opponent is pending: the preferred artifact is Exp 2's
`p1p2-comparison/20261114-v1/runs/baseline-seed-4023/final.pt`. Do not substitute
a current Intel or M1 checkpoint. Before either historical comparison, establish
one trusted file's SHA-256, original source manifest, completed endpoint, baseline
MLP configuration, public observation schema and sampling settings, and transfer
identical bytes to both machines. The evaluator refuses an unestablished SHA.
EV and AI-6A are excluded from the official benchmark.

To export M1 runtime evidence without starting training:

```sh
python -m scripts.ai7.shared_protocol --machine m1 --output NEW_M1_EXPORT_DIRECTORY
python -m scripts.ai7.shared_protocol --compare \
  INTEL_EXPORT/intel-source-evidence.json M1_EXPORT/m1-source-evidence.json
```

Transfer the same evaluator/export source files before using these commands, or
run them in a separate checkout. The export describes the inspected runtime;
it does not certify the source used by an already-running campaign. Return:

- Actual original campaign `config.json`, source provenance, dependency freeze and
  source snapshot; preserve their existing bytes and hashes.
- Runtime evidence and local seed audit, including training ranges, validation,
  all earlier evaluation sets, and any unavailable metadata.
- A checkpoint index containing machine/campaign, treatment, training seed,
  initial/final/milestone endpoint, actual environment transitions, relative path,
  SHA-256, model config, Core revision, observation version and training-source
  manifest SHA-256. Transfer model bytes separately as trusted artifacts.
- Per-game outcomes keyed by protocol ID, machine, treatment, training seed,
  checkpoint SHA, opponent SHA or Random implementation hash, deck seed and focal
  seat. Include terminal winner/reason, not only training reward or aggregate score.

Names/seeds alone never establish compatibility. Compare Git commits and content
fingerprints for GameCore/rules, public observations, action encoding, model,
deck generation, sampling/stopping, plus actual dependencies and opponent bytes.
Commit differences with identical relevant contents may be harmless; training-only
method differences are intentional. Different evaluation sources/dependencies
require a common compatible runtime before direct cross-machine pooling.
Core/observation/action semantic changes can also change what was learned and
remain scientific confounds even after common-runtime evaluation. Within-campaign
matched-seed contrasts can still be reported with those limits. Keep both machine
baselines separate; same RNG seeds do not prove bitwise training equivalence.

## Outputs and scientific interpretation

The supervisor completes the nine training jobs, evaluates initial/final policies
against Random, evaluates the existing eight diagnostic Core probes, and runs
final treatment-versus-baseline matches with the same training seed and both seats.
External-opponent and direct-match results are separate. The unavailable M1
400-position tactical test bank remains pending; the eight probes are not a
substitute for that benchmark. The untouched reserved confirmation bank remains
excluded even if transferred later.

Official score is WIN=1, DRAW=0.5, LOSS=0, derived from Core results and focal
seat. Report W/D/L, all four terminal reasons, NO_PROGRESS counts/rates, each
seat, planned/attempted/completed/skipped/incomplete/error accounting, and raw
games. Average both seat legs before deck-pair intervals. Paired bootstraps use
10,000 resamples and seed 19. Three training seeds are the replication unit;
do not treat thousands of games as independent learning replications. Multiple
comparisons and fragile three-seed uncertainty remain explicit.

`research-report.md`, `comparison.csv/json`, `checkpoint-index.json`, per-run
metrics/checkpoints, `evaluations/`, `head-to-head/`, `probes/`, and structured
logs retain the evidence. `run-status.json` identifies progress and failures. The
main question is improved winning conversion and tactical competence. More draws
or a higher score alone is not evidence of stronger winning play. No final
success claim is made until the required completed evidence exists.
