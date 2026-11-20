# Independent tactical generalization

Exact original M1 Stage2: 200 independent immediate-win positions and 200 immediate-defense positions, fully revealed, at most six live pieces. Original/rotated orientations are paired. No reserved bank was read, regenerated or evaluated. All 45 initial/intermediate/final Intel checkpoints were evaluated without model selection.

Bank SHA-256: `970fa685171b61d3b9a43c515e5cbfdd47801885ef259ca65aa3b345bc603d27`. Actual per-checkpoint SHA-256, public-only probabilities, action ranks, argmax choices and per-position metrics are preserved in tactical-results.json and tactical-probabilities/*.npz. Plan/source/test evidence are in plan.json and compatibility-validation.json.

## Final checkpoint descriptive means across three training seeds

Target probability is winning-action mass for win positions and safe-action mass for defense positions. Top1 uses the complete correct-action set, with lowest numeric legal ID to resolve exact ties; best target rank is 1 plus the number of strictly more probable legal actions. Lower rank/gap/TV is better. Uniform probability is position-specific; the ratio column averages each position's target mass divided by its own uniform mass.

| Method | Category | Target mass % | Uniform % | Top1 % | Best target rank | Mass / uniform | Symmetry gap pp | TV % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | win | 10.88 | 10.52 | 10.50 | 5.73 | 1.03 | 12.58 | 61.59 |
| Baseline | defense | 57.79 | 57.94 | 57.67 | 1.52 | 0.99 | 28.93 | 47.17 |
| GAE-0.95 | win | 13.54 | 10.52 | 14.67 | 5.35 | 1.32 | 18.31 | 70.07 |
| GAE-0.95 | defense | 57.74 | 57.94 | 56.67 | 1.53 | 1.00 | 31.89 | 50.82 |
| CHAIN-lite | win | 10.85 | 10.52 | 11.17 | 5.72 | 1.03 | 10.52 | 53.90 |
| CHAIN-lite | defense | 58.91 | 57.94 | 59.25 | 1.50 | 1.02 | 29.42 | 44.14 |

## Final treatment minus same-seed Baseline

Paired position bootstrap: 4,000 resamples, seed91023; average orientations before resampling. Intervals are conditional on these fixed trained models. They are not uncertainty over training replications. All comparisons are exploratory and multiplicity is unadjusted.

| Method | Seed | Category | Mass difference pp [95%] | Top1 difference pp [95%] | Rank difference [95%] | TV difference pp [95%] |
| --- | ---: | --- | --- | --- | --- | --- |
| GAE-0.95 | 6011 | win | +1.60 [-0.68, +3.92] | +3.00 [-1.25, +7.25] | -0.27 [-0.70, +0.15] | +11.63 [+8.70, +14.48] |
| GAE-0.95 | 6011 | defense | +0.79 [-2.85, +4.51] | +0.00 [-6.26, +6.25] | -0.01 [-0.09, +0.07] | +6.73 [+2.16, +11.33] |
| CHAIN-lite | 6011 | win | +0.92 [-1.26, +3.12] | +3.25 [-1.50, +8.25] | -0.33 [-0.81, +0.13] | -12.31 [-14.52, -10.07] |
| CHAIN-lite | 6011 | defense | -0.48 [-4.09, +3.19] | +0.00 [-7.00, +7.25] | +0.01 [-0.09, +0.10] | -8.15 [-12.20, -4.25] |
| GAE-0.95 | 6023 | win | +3.61 [+1.31, +6.13] | +5.50 [+1.25, +9.75] | -0.43 [-0.82, -0.04] | +5.69 [+2.21, +9.26] |
| GAE-0.95 | 6023 | defense | -0.46 [-5.24, +4.37] | -0.75 [-8.00, +6.25] | +0.03 [-0.07, +0.12] | -5.45 [-9.95, -0.98] |
| CHAIN-lite | 6023 | win | +0.47 [-1.41, +2.29] | +1.50 [-2.75, +5.75] | -0.05 [-0.49, +0.39] | -13.34 [-16.48, -10.11] |
| CHAIN-lite | 6023 | defense | +1.64 [-1.73, +5.27] | +1.75 [-4.25, +8.01] | -0.04 [-0.12, +0.03] | -7.70 [-12.32, -3.08] |
| GAE-0.95 | 6037 | win | +2.77 [+0.53, +4.92] | +4.00 [-0.50, +8.26] | -0.45 [-0.94, +0.06] | +8.13 [+4.97, +11.15] |
| GAE-0.95 | 6037 | defense | -0.49 [-4.69, +3.58] | -2.25 [-9.75, +4.75] | -0.01 [-0.10, +0.09] | +9.66 [+4.95, +14.43] |
| CHAIN-lite | 6037 | win | -1.48 [-3.34, +0.35] | -2.75 [-7.00, +1.50] | +0.34 [-0.14, +0.82] | +2.60 [-0.27, +5.54] |
| CHAIN-lite | 6037 | defense | +2.19 [-1.10, +5.35] | +3.00 [-3.25, +9.00] | -0.04 [-0.12, +0.04] | +6.77 [+3.09, +10.47] |

## Learning trajectories, all predetermined checkpoints

These are diagnostic trajectories on the same bank, not five independent confirmations or permission to choose the best checkpoint. Each row is one training replication. Values are mean correct-action probability across both orientations, percent.

| Method | Seed | Category | Initial | 0.91M | 1.82M | 2.73M | Final 3.64M |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 6011 | win | 10.51 | 12.10 | 10.53 | 11.03 | 11.01 |
| Baseline | 6011 | defense | 57.94 | 61.08 | 58.70 | 56.91 | 57.34 |
| Baseline | 6023 | win | 10.51 | 11.10 | 9.82 | 11.65 | 10.14 |
| Baseline | 6023 | defense | 57.94 | 60.13 | 60.24 | 60.14 | 58.66 |
| Baseline | 6037 | win | 10.52 | 10.68 | 10.82 | 10.68 | 11.48 |
| Baseline | 6037 | defense | 57.94 | 58.62 | 60.11 | 59.07 | 57.36 |
| GAE-0.95 | 6011 | win | 10.51 | 9.78 | 10.78 | 11.21 | 12.61 |
| GAE-0.95 | 6011 | defense | 57.94 | 57.44 | 59.92 | 58.54 | 58.14 |
| GAE-0.95 | 6023 | win | 10.51 | 12.81 | 12.76 | 13.12 | 13.75 |
| GAE-0.95 | 6023 | defense | 57.94 | 57.67 | 61.11 | 59.05 | 58.21 |
| GAE-0.95 | 6037 | win | 10.52 | 10.93 | 11.46 | 14.01 | 14.25 |
| GAE-0.95 | 6037 | defense | 57.94 | 59.08 | 59.65 | 61.28 | 56.88 |
| CHAIN-lite | 6011 | win | 10.51 | 9.90 | 11.15 | 10.94 | 11.93 |
| CHAIN-lite | 6011 | defense | 57.94 | 54.54 | 55.65 | 59.67 | 56.87 |
| CHAIN-lite | 6023 | win | 10.51 | 11.65 | 11.59 | 12.92 | 10.62 |
| CHAIN-lite | 6023 | defense | 57.94 | 61.13 | 57.75 | 55.70 | 60.30 |
| CHAIN-lite | 6037 | win | 10.52 | 10.07 | 9.79 | 11.86 | 10.00 |
| CHAIN-lite | 6037 | defense | 57.94 | 55.39 | 54.41 | 55.89 | 59.55 |

Per-position adjacent and initial-to-checkpoint change intervals, original/rotated results, full masked-policy total variation and all three training-seed effect vectors are in tactical-results.json. Training replication n=3 remains separate from 200 source positions/category. The selected Random-play endgames do not establish broad Banqi strategy or long forced-defense competence.

Reproduce: `python -B -m scripts.ai7_p0.tactical --output /Users/shinelin/Desktop/dark-chinese-chess/dark-chinese-chess/benchmark-results/ai7-selfplay/intel-p0/20261115-v1` in a fresh evaluation directory using the frozen plan; completed output is protected against accidental overwrite.
