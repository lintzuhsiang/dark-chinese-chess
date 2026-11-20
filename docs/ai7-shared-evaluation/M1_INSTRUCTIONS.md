# M1 execution instructions

1. Transfer the `.tar.gz` and its `.sha256` sidecar. Verify the archive hash against
   the independent value supplied by Intel, extract, then verify every static file:

```sh
shasum -a 256 ai7-intel-to-m1-evaluation-protocol.tar.gz
tar -xzf ai7-intel-to-m1-evaluation-protocol.tar.gz
cd ai7-intel-to-m1-evaluation-protocol
shasum -a 256 -c checksums.sha256
```

2. From the existing M1 research repository, create a new detached worktree at the
   exact base. Substitute the location of your existing repository; do not switch
   its branch or change training files. Do not commit any overlay files.

```sh
git -C ../dark-chinese-chess worktree add --detach ../m1-eval-worktree 96090e4e10e4f954cce917550b70a35ae3a06e9d
```

The path used below assumes that new worktree is next to the extracted bundle.
Use the Python executable from your existing working M1 RL environment; `python3`
below means that executable. Node26 must be on PATH. The package records Intel
Python3.11/Torch2.2.2/NumPy1.26.4 and the M1-supplied historical environment
Python3.9.6/Torch2.8.0/NumPy2.0.2; these are evidence, not a claim your current
environment is identical. No package installation is silently performed.

3. Install the unchanged frozen source into the clean evaluation checkout and run
   local conformance tests. Existing-source hashes are preserved; a dirty training
   workspace is rejected. The smoke uses two existing reference orientations,
   a mocked non-game sampling trace, existing bootstrap vectors and **one known
   accepted Core action**, never a full match. Check the printed local versions.

```sh
python3 -B evaluation/runner.py install-source --repository ../m1-eval-worktree
python3 -B evaluation/runner.py verify --repository ../m1-eval-worktree
```

If verification fails, stop before official evaluation and report the difference.
Do not change the fixed manifest or opponent, weaken the tolerance, or alter RNG
semantics just to pass. The historical opponent is already in historical-opponent/;
leave it there. Both its .pt SHA and NPZ SHA are in manifest.json. No local Intel
paths in the archived evidence need to exist on M1.

4. Inspect each owner-supplied final checkpoint. The loader checks Core/public-v1,
   model shape and exactly 3640000 steps. It reports the actual saved training seed
   and configuration; never relabel a different seed as 6011/6023/6037. Confirm the
   actual reward/curriculum/augmentation configuration before assigning a treatment.
   In particular, an old NO_PROGRESS−0.05 arm is not an All Draw−0.2 arm.

```sh
python3 -B evaluation/runner.py inspect --repository ../m1-eval-worktree --checkpoint ../m1-models/baseline-final.pt
```

5. Run the fixed decks against each opponent separately, or omit `--opponents` to
   run both. Output must be under the independent evaluation checkout's artifact
   tree. Commands below are real checked CLI options; substitute your actual file
   and use a new output directory per training seed/treatment. No checkpoint files
   are copied or rewritten by evaluation.

```sh
python3 -B evaluation/runner.py evaluate --repository ../m1-eval-worktree --checkpoint ../m1-models/baseline-final.pt --treatment baseline --machine-id m1 --opponents random --output ../m1-eval-worktree/benchmark-results/ai7-selfplay/shared/baseline-random
python3 -B evaluation/runner.py evaluate --repository ../m1-eval-worktree --checkpoint ../m1-models/baseline-final.pt --treatment baseline --machine-id m1 --opponents historical --output ../m1-eval-worktree/benchmark-results/ai7-selfplay/shared/baseline-historical
```

For both opponents in one run:

```sh
python3 -B evaluation/runner.py evaluate --repository ../m1-eval-worktree --checkpoint ../m1-models/baseline-final.pt --treatment baseline --machine-id m1 --output ../m1-eval-worktree/benchmark-results/ai7-selfplay/shared/baseline-run
```

Repeat for every actual seed of baseline, no_progress_penalty_02,
all_draw_penalty_02, endgame_curriculum, and symmetry_augmentation. A treatment tag
is owner-supplied metadata, not automatic proof of its training method. Pass
`--training-manifest ../m1-models/original-run-manifest.json` when available; its SHA
is retained and the saved checkpoint config is always exported. Confirm missing
training-source/reward definitions before interpreting cross-machine treatments.

Each run writes run-manifest.json, raw final-vs-_.json (including exact per-game
records/pair_scores), normalized per-game-_.json, and summary.json. Failed runs write
failure.json; unavailable current-match counts are null, never invented draws.

6. Compare same-machine, same actual training-seed treatments with Baseline. Include
   exactly one baseline run per seed/opponent and all treatment runs to compare.
   Both-seat legs are paired first; the unchanged Intel paired_difference uses
   10000 resamples and seed19. Different training seeds remain independent learning
   replications and are not pooled as thousands of training samples.

```sh
python3 -B evaluation/runner.py compare --repository ../m1-eval-worktree --runs ../m1-eval-worktree/benchmark-results/ai7-selfplay/shared/baseline-run ../m1-eval-worktree/benchmark-results/ai7-selfplay/shared/treatment-run --baseline-treatment baseline --output m1-comparison.json
```

7. Export compact JSON results and checksums back to Intel. No model weights,
   rollout histories, caches or tactical banks are included by this command:

```sh
python3 -B evaluation/runner.py pack-results --runs ../m1-eval-worktree/benchmark-results/ai7-selfplay/shared/baseline-run ../m1-eval-worktree/benchmark-results/ai7-selfplay/shared/treatment-run --comparisons m1-comparison.json --output m1-shared-results.tar.gz
shasum -a 256 m1-shared-results.tar.gz
```

Transfer that results archive, its SHA-256 and the local `verify` output. Keep the
original fixed manifest unchanged. Existing Intel 14M results are a different,
Intel-internal cohort; do not mix them with this 20M protocol. No full-game matches
were run to validate this export, and no current M1 checkpoint/environment was
available for live M1 execution here.
