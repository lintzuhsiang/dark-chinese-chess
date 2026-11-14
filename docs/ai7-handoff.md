# AI-7 experiment branch handoff

Use branch `experiment/selfplay-zero`; Branch A stays separate. Current code
includes the original self-play learner, Exp 1, Exp 2, evaluation-only symmetry
and archived-game analyses, and opt-in bounded full audit recording.

## Setup on another computer

```sh
git fetch origin
git switch --track origin/experiment/selfplay-zero
pnpm install --frozen-lockfile
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/ai7/requirements.txt
pnpm typecheck
pnpm exec vitest run scripts/ai7/tests
```

For an already existing local branch, use `git switch experiment/selfplay-zero`
and `git pull --ff-only`. Use the Node and pnpm versions specified in
`package.json`. Actual CPU, memory and supported Torch device must be measured on
each computer; do not copy the first computer's throughput forecast.

## Available results and tools

- [Symmetry protocol](ai7-symmetry.md) and
  [small result archive](ai7-results/diagnostics/symmetry-review.md).
- [Existing-record analysis](ai7-existing-records.md) and
  [result tables](ai7-results/diagnostics/existing-records-review.md).
- [Draw cases](ai7-results/diagnostics/draw-cases.md) and
  [checkpoint action rankings](ai7-results/diagnostics/draw-policy-ranking.md).
- [Audit recording and draw investigation](ai7-audit-and-draws.md).

The copied reports are historical records; bare artifact filenames in them refer
to their original local output folders. Git excludes `benchmark-results/`, model
checkpoints, full game logs, evaluation banks (including the reserved bank), and
`.venv`/`node_modules`. The offline analysis scripts require those local artifacts;
a Git checkout alone does not supply the old models or replay data. New randomly
initialized training can run without old checkpoints after setup.

## Next overnight experiment: approved design, not yet implemented

The proposed five arms are Baseline, NO_PROGRESS -0.05, NO_PROGRESS -0.2,
30% legal-endgame curriculum, and per-game 180-degree rotation augmentation,
with three paired training seeds and a preflight-selected common step budget.
The training reward adapter, curriculum starts, rotation collector, long-run
recording windows, and new five-arm supervisor are NOT implemented yet.
Do not run the old campaign launcher expecting these treatments.

The owner removed the old 5GB restriction for the next experiment. Current code
still has its historical 5GB guards; replacing these with disk/memory headroom
checks is pending, not part of this handoff commit. No Experiment 3 training is
running as part of this handoff.

Before using two computers, assign disjoint treatment/run ownership and output
folders. Paired seeds are intentional across treatments; independent repetitions
must use distinct training seeds. Separate machines' wall-clock speeds are not
algorithm evidence. Freeze source revision, protocol and evaluation seeds on both
machines before launch. Do not evaluate the reserved bank for tuning.
