# AI-7 Campaign 4B: M1 restart infrastructure

This records the original infrastructure stage. For the subsequent verified Intel
reference import and formal training launch, see [Intel integration](ai7-restart-intel-integration.md).

Branch: `experiment/m1-gae-restart-strategies-20261115`, based on `49a6738`.
This is the infrastructure stage. Full treatment training and primary evaluation
have not started. The owner is obtaining Intel's verified training-reference
bundle and a new Campaign 4 shared evaluation manifest. Neither is reconstructed
from the old evaluation bundle or research summaries.

## Historical failure and budget investigation

The original M1 Exp 3 artifacts are in the sibling `selfplay-zero` worktree under
`benchmark-results/ai7-selfplay/exp3/20261115-m1/`. They are read-only inputs.
The integration checkout used here did not contain that training implementation.
The new work reuses the current public environment and collector without importing
the old reward penalties or rotation treatment.

`scripts/ai7/exp3.py` in that sibling checkout froze the common target before
training. It subtracted 90 minutes for evaluation and 30 minutes for overhead
from seven hours, divided by three times the sum of measured treatment costs with
a 30% slowdown margin, and rounded down to 40,000 transitions. The resulting
`config.json` target was 2,000,000, with an estimated training cost of
17,995.85 seconds including that margin. The reported completed 2M runs were not
3.64M runs interrupted at 2M. Campaign 4B keeps its requested 3.64M endpoint;
the old automatic budget-reduction procedure will not be reused.

All three curriculum run statuses record
`RuntimeError('Terminal game without a learner decision')`:

| Seed | Last recorded transitions |
| ---- | ------------------------: |
| 5011 |                   276,456 |
| 5023 |                    45,180 |
| 5037 |                 1,191,309 |

The old curriculum sampled the learner seat independently from an endgame prefix.
Its opponent could end the game before the learner acted, violating the collector's
normal-start assumption. The old report generator also assumed all final
checkpoints existed. Missing curriculum endpoints therefore broke aggregation.
Short earlier preflights had passed without encountering this boundary.

The new collector counts these real terminal outcomes and environment transitions,
but creates no learner decision or PPO trajectory for them. The exception remains
for unexpected zero-decision **normal-start** training games. Incomplete games
continue to receive no manufactured result and contribute no PPO samples.
The collector returns `trajectory_game_ids` so nonempty PPO trajectories can be
joined to completed-game records even when a zero-decision game is between them.
The future reconciled trainer must use this mapping for audit records rather than
assuming trajectory-list offsets identify games.

## Snapshot and information boundary

`scripts/ai7/restart.ts` owns versioned simulator snapshots, outside GameCore.
Snapshots contain the private original deck, complete accepted actor/action prefix,
full Core state, public events, and the public-v1 observation. Restoring copies the
deck, replays every accepted action through the pinned Core, and compares all of
those fields exactly. It never injects deserialized counters, pieces, events or
Chase records into Core. Invalid actors, stale rules, corrupt counters and illegal
prefixes fail explicitly. Terminal snapshots may be round-tripped for correctness;
terminal records are rejected from the restart archive.

This deliberately pays replay cost per start. Direct trusted state injection is
unnecessary for this experiment. The archive preserves deterministic continuation,
the full physical state and the public memory needed for the unchanged encoder.
Snapshots are detached copies; continuing a restored environment does not mutate
its source record. Replay prefixes are setup work, never counted as fresh training
transitions or passed to PPO as policy samples.
Saved continuation transcripts identify the original archive deck seed and restart
record/ply, rather than labeling them with the unused normal-start seed.

The Node server loads a checksum-verified archive and Core-validates every record.
Python receives record IDs and public descriptors: ply, quiet counter, live/hidden
piece counts, stage, public-observation hash and endgame eligibility. Private decks,
piece IDs, snapshots and Chase ledgers stay in the simulator. The policy still
receives only public-v1 features and its authoritative legal mask. Record IDs and
sampling metadata never enter the network. A restart in the evaluation collector
is rejected: primary evaluation must use normal complete-game starts.

## Frozen archive and sampling design

`scripts/ai7/restart-design.json` is the preregistered infrastructure design.
The fixed archive uses 512 complete Uniform Random versus Uniform Random games,
deck seeds 800,000–800,511, with separate deterministic action streams. This is a
100% Uniform Random generation mixture: it supplies diverse legal histories
without requiring the missing Intel predictor. Its distribution is limited to
Random-play states; it is not claimed to represent competent self-play.

Candidates are nonterminal prefixes at plies 16, 32, 48, and so on, with quiet
counter at most 50. The first occurrence of a complete snapshot SHA-256 is retained.
Deduplication preserves physical identity, history and quiet/Chase state; it does
not merge positions solely because their visible boards match. No future source
outcome or tactical label selects candidates. Complete source games, checksums,
source snapshots, generation transitions/time and distribution histograms are
retained separately from the training budget.

Stages use only public live-piece counts: opening >=25, middle 13–24, endgame <=12.
B2 additionally requires 4–12 live pieces, quiet <=30, assigned colors and positive
public remaining inventory for both colors. Active status and a legal next action
come from Core. Hidden pieces count as live without inspecting their identities.
This leaves at least 30 quiet plies of headroom. It does not filter using winners,
best actions or the outcome of the next move; an opponent-first termination remains
an honest possible training outcome.

`restart_sampling.py` implements B0 disabled, B1 uniform, B2 endgame-only and B3
value-error sampling. B1–B3 independently restart each new episode with probability
0.3. This is a probability over starts, not over transitions or a forced batch
quota. B0 makes no restart RNG draws. A separate sampling stream preserves the
existing deck/seat/opponent stream when disabled. Sampler checkpoints bind the
archive/catalog, treatment, seed and priority-table fingerprint and retain RNG,
start/stage counters and record frequencies. Sampler state must be embedded in the
future verified trainer's checkpoint/rollback boundary.

B3's candidate score is `min(2, abs(V(public_start) - mean(original_outcome)))`, in
the snapshot acting player's perspective. Sampling mixes 20% uniform with 80%
normalized clipped error, exponent 1; all-zero errors fall back to uniform. The
same full archive as B1 is required. Scoring requires at least eight independent
training continuation action streams per record, frozen predictor/protocol and
public-equivalence verification fingerprints, and stores target variance and
standard error. Hidden records also require at least eight distinct compatible
layout replicates with the same public observation. Action-RNG repeats on one
private layout cannot establish a learnable public-state value error.

The scorer computes **candidate** tables from supplied evidence; it does not
certify the evidence's provenance or public-equivalence proof. No real priority
table has been generated, and B3 has not passed its scientific launch gate. The
current fixed archive contains hidden states. If valid training-only replicated
targets cannot be produced for them, B3 must remain explicitly unavailable rather
than dropping those records, reusing single source outcomes or inventing tactical
priorities. The completed valid treatments can still be preserved.

## Current artifact inventory

Campaign directory:
`benchmark-results/ai7-selfplay/gae-restart-strategies-20261115/`.

- `archive/archive.json`, `archive/manifest.json`: fixed archive and provenance.
- `archive/source-games/`: complete source transcripts, including terminal results.
- `archive/source-snapshot/`: exact generation sources and design.
- `seed-audit.json`: accessible historical training-seed evidence and scope limits.
- `collection-pilot/pilot.json`: collection-only throughput/accounting diagnostics.
- `status.json` and `verification/`: current gates and verification evidence.

The archive contains 7,817 snapshots, including 3,553 B2-eligible snapshots.
Archive SHA-256:
`7bc7885f86d83c7bb3054d3672bdaf3531f55e012f190b0d3a9f5dcaf7b7fb71`.
Generation and full snapshot validation took 81.39 seconds. The manifest records
CPU time, 512 complete source games, distributions, source hashes and generation
transition cost. This cost is additional to the future 43.68M training budget.
Generation used 133,215 Core transitions. The archive has 1,059 opening, 2,027 middle
and 4,731 endgame-stage records; B2's narrower eligibility retains 3,553 of them.

The local audit found no earlier use of training seeds 7011/7023/7037 in 37
accessible actual campaign configs/run manifests. This is not a claim about
unavailable Intel runs. Archive deck seeds are training-only and may have occurred
in earlier training; model initialization seeds and environment deck seeds are
different audit questions. No reserved tactical bank was opened.

## Correctness and verification

The Vitest restart tests cover exact snapshot round-trip, identical legal masks
and public observations, deterministic continuation, quiet=59/NO_PROGRESS,
Chase v4 prohibition and stalemate, hidden-layout/private-ID invariance, source
immutability, corrupt snapshot rejection and deterministic archive generation.
Python restart tests cover the actual opponent-first terminal failure, fresh
current-policy log probabilities and values, original reward ownership, exclusion
of empty/incomplete PPO trajectories, GAE boundaries, the disabled collector's
equivalence to its original source, deterministic sampling and exact
sampler/model/Adam/RNG checkpoint continuation. B3 scoring tests use synthetic
evidence only and do not constitute valid experimental priority data.

The collection pilot uses an untrained local Baseline MLP and 16,384 transitions
per treatment for B0/B1/B2. It performs zero optimizer steps and no held-out
evaluation. Its game outcomes are infrastructure diagnostics, not evidence of
playing strength or learning. It reports archive validation, reset/replay overhead,
sampling overhead, zero-decision outcomes and incomplete accounting separately.
Replay-prefix counters in existing summary fields are labeled; mean continuation
length is reported separately. These are collection-only throughput measurements,
not a verified full-training time forecast.

| Treatment | Collection transitions/s | Reset/replay seconds | Completed episodes | Mean continuation plies |
| --------- | -----------------------: | -------------------: | -----------------: | ----------------------: |
| B0        |                    4,925 |                0.004 |                 62 |                  254.10 |
| B1        |                    4,605 |                0.245 |                 66 |                  209.12 |
| B2        |                    4,381 |                0.274 |                 71 |                  204.97 |

Loading and Core-validating all 7,817 archive records took 71.17 seconds once at
pilot startup, separately from these collection rates. The pilot's exact source
snapshot is retained alongside its fingerprints; later audit-metadata/test changes
are covered by the final correctness checks. No treatment was selected from these
untrained-policy outcomes.

The checkout originally linked `node_modules` to the sibling worktree. pnpm's
recursive task-state guard rejects that arrangement. Existing dependencies were
copied locally without installation or package/lockfile changes; the original
symlink was retained in `/private/tmp`. No files were deleted.

## Reproducible commands

From this worktree, use the existing M1 Python environment:

```sh
pnpm exec vitest run scripts/ai7/tests/restart.test.ts
../selfplay-zero/.venv/bin/python -m unittest scripts.ai7.tests.test_restart -v
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Archive generation refuses an existing destination. Use a fresh folder for any
reproduction; do not overwrite the fixed campaign archive:

```sh
mkdir -p benchmark-results/ai7-selfplay/gae-restart-reproduction
node --import ./scripts/ai-eval/register.mjs scripts/ai7/restart_archive.ts \
  benchmark-results/ai7-selfplay/gae-restart-reproduction/archive
```

The collection pilot also requires a fresh output directory:

```sh
../selfplay-zero/.venv/bin/python -m scripts.ai7.restart_pilot \
  --archive benchmark-results/ai7-selfplay/gae-restart-strategies-20261115/archive/archive.json \
  --archive-sha256 7bc7885f86d83c7bb3054d3672bdaf3531f55e012f190b0d3a9f5dcaf7b7fb71 \
  --output benchmark-results/ai7-selfplay/gae-restart-strategies-20261115/collection-pilot
```

## Required next gates

1. Import Intel's separately verified successful GAE-0.95 config, manifest,
   PPO/GAE source snapshot/fingerprints, dependencies and seed6011 final model.
   Verify bytes, loading, public observations, model/optimizer/objective semantics,
   opponent mixture, stopping and checkpoint schedules. Record source differences
   and reconcile them explicitly. Existing local lambda-0.95 unit tests do not
   establish compatibility with the successful Intel implementation.
2. Integrate the sampler into that reconciled trainer, including checkpoint/resume
   and interrupted-update rollback. Repeat exact CLI-resume and throughput gates
   for the resulting training path. Freeze full treatment configs/source checksums
   before the twelve 3,640,000-transition runs. No automatic 2M fallback.
3. Freeze a valid training-only B3 predictor/target protocol or report why it cannot
   satisfy the hidden-information uncertainty requirement. Do not present the
   candidate scorer as a learned regret network.
4. Import Intel's new Campaign 4 shared evaluation manifest and overlap audit.
   21M is only a proposed namespace; its size and exact seeds are not locally
   invented or sealed. The already evaluated 20M decks remain explored evidence.
   Until the new manifest arrives, preserve checkpoints and run only labeled local
   diagnostics. The reserved 100+100 tactical bank stays untouched.

No experimental ranking, full-training checkpoint, learning-curve claim or final
research decision exists at this stage. No commit, push, deployment or external
message has been performed.
