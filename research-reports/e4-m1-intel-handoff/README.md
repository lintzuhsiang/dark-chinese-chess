# E4 M1 to Intel handoff index

The source identity is Git base f4ccb0d3f3b6ee96e0135ecea549e4bf2f1bb967 plus the frozen E4 architecture patch. Patch and checkpoint SHA-256 values are in [checkpoints.json](checkpoints.json). The index covers all 15 E4-R finals, five full B2 1.5M states, and nine E4-S endpoints. E4-S actually branched from seeds 1994011, 1994023 and 1994037.

[M1 replay receipt](replay-receipt.json) records two rollouts per seed for S0 and S2-off. Model, Adam, RNG and the frozen opponent pool matched bitwise. The first active S2 update also matched the archived metrics. This covers the historical 1.5M fork on M1. An Intel continuation needs its own runtime verification and a declared common parent.

The K2 benchmark used the archived `frozen-supervised/lab.py`. Its seed scores were 91.49%, 91.19% and 90.83%. Output metrics were saved. K2 trained weights were not saved.

The M1 archive candidate is `AI7-E4-M1-Intel-handoff-public-v1.tar.gz` with SHA-256 `9b0ccc1575f5dd19f874701b53af9bb5aae2e595d4b6b8596e7d2ce83c297013`. It contains the checkpoint blobs, source and replay instructions. [Download the verified GitHub Release asset](https://github.com/lintzuhsiang/dark-chinese-chess/releases/download/ai7-e4-m1-intel-handoff-v1/AI7-E4-M1-Intel-handoff-public-v1.tar.gz). Paths in the index refer to entries inside that archive.

## Public inference acceptance vectors

[Acceptance supplement](acceptance-vectors/README.md) contains 20 public observations, expected legal masks/probabilities/values for 15 pinned checkpoints, a verifier, and the M1 acceptance receipt. The branch supplies the verifier and public reference outputs. Running the verifier on Intel requires the corresponding checkpoint bytes in the isolated E4 worktree.

```sh
git fetch origin experiment/shared-evaluation
git show origin/experiment/shared-evaluation:research-reports/e4-m1-intel-handoff/acceptance-vectors/README.md
```
