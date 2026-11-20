# AI-7 shared evaluation integration branch

Branch: `experiment/shared-evaluation`, based on
`96090e4e10e4f954cce917550b70a35ae3a06e9d`. This branch contains the
Intel evaluation overlay and M1 comparison evidence; it does not contain the
M1 Exp 3 training changes. Merge or cherry-pick this branch for Intel integration.

## Protocol identity

- Canonical protocol: `ai7-intel-p0-common-opponent-256-v1`.
- Decks: 20,000,000–20,000,255, both seats, 512 games/model/opponent.
- Shared manifest SHA-256:
  `b2076ad8b89ac39eba71ef022c0dbbaa7bbeb7a1c6cfd4f07dc6358860269568`.
- Historical M1 Exp 2 Baseline 4023 checkpoint SHA-256:
  `d7b5623b61b26b1f17dd93189a512c3c0f81a4c9d8bd7a3131728078c53bb4b8`.
- Original Intel archive SHA-256:
  `baf60128cc5026c41d0c14d23dda7f4389fce1147c51788fc31fa00cb434fd97`.

`imported-source-manifest.json` fingerprints the nine unchanged Intel Python
files imported from `evaluation/evaluator-source/`. The bundle manifest and
checksums retain the upstream identities. No GameCore or checkpoint changes are
included. Imported P0 preparation/reporting modules are upstream research tools;
they are not a replacement standalone installation of the portable bundle.

## Execution checkout versus integration checkout

The original `M1_INSTRUCTIONS.md` is preserved verbatim as historical execution
instructions. Its instruction not to commit overlays applies to the frozen
execution checkout. The owner subsequently authorized this separate integration
branch to version those files.

Do **not** run the canonical conformance checker against this branch HEAD: it
requires the exact base commit above. Create a fresh detached worktree at that
commit, then follow `M1_INSTRUCTIONS.md` using the complete original Intel
archive. The archive supplies the canonical `evaluation/runner.py`, fixtures,
source overlay and historical weights. This documentation directory is not a
complete extracted runnable bundle. In particular, `scripts/ai7/evaluate_shared.py`
also contains an older 128-deck protocol; invoking it directly is **not** the
canonical 256-deck evaluation. Use the archive runner and its frozen manifest.

The M1 local archive and SHA sidecar are preserved, outside Git, at:
`benchmark-results/ai7-selfplay/imports/intel-common-protocol/` in this worktree.
The extracted original bundle remains at the sibling directory
`../intel-common-protocol-import/ai7-intel-to-m1-evaluation-protocol/`.

## M1 comparison cohort and evidence

The actual completed M1 Exp 3 cohort is seeds 5011/5023/5037 at 2,000,000
transitions: Baseline, NO_PROGRESS −0.05, NO_PROGRESS −0.2 and rotation.
Curriculum has no completed final checkpoint; All Draw −0.2 was not run.
It must not be relabeled as the requested Intel 6011/6023/6037, 3,640,000 cohort.
The local adapter explicitly declared the separate 2M cohort while reusing the
unchanged Intel sampling kernels; the canonical endpoint gate was not changed.

The M1 comparison source snapshots and compact results are archived in
`m1-comparison/`. These Python snapshots preserve the original analysis exactly,
including machine-specific absolute paths and existing output-directory guards.
They are evidence of the executed analysis, not a portable CLI. Do not execute
them unchanged on Intel. For a fresh evaluation use the canonical bundle runner.
Intel numbers in `intel-reported-summary.json` are owner-provided summaries;
raw Intel games and training-seed uncertainty were not supplied.

Full per-game/per-position results remain outside Git in the M1 training worktree:
`../selfplay-zero/benchmark-results/ai7-selfplay/local-analysis/common-20m-2m-v1/`.
This branch includes a SHA-256 inventory so those files can be verified if
transferred separately. It includes no models, reserved tactical bank, training
rollouts, retraining, or new evaluations. Deck bootstrap uncertainty and
training-seed uncertainty must remain separate; compare W/D/L as well as score.
