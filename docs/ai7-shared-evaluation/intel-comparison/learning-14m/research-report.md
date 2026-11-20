# Intel AI-7 learning-methods campaign

State: **completed_locally_supported_experiment**. Target: **3,640,000 transitions per run**, nine runs, seeds 6011/6023/6037.

This is a new independent Intel campaign. Baseline, GAE lambda 0.95, and CHAIN-lite share the original MLP, LR=3e-4, gamma=1, four PPO epochs, original opponent mixture, terminal +1/0/-1 and authoritative unchanged Chase v4 Core.

CHAIN-lite uses alpha=0.1 and 256 evenly spaced training-rollout reference observations, frozen before each PPO update. It is a simplified CHAIN-inspired policy KL treatment, not a reproduction of the full published method. No evaluation data enters its loss.

| Method | Seed | Steps | State | Initial W/D/L | Final W/D/L vs Random | Final NO_PROGRESS |
| --- | ---: | ---: | --- | --- | --- | ---: |
| baseline | 6011 | 3640000 | completed | 40/185/31 | 48/188/20 | 188 |
| gae_lambda_095 | 6011 | 3640000 | completed | 40/185/31 | 113/132/11 | 132 |
| chain_lite | 6011 | 3640000 | completed | 40/185/31 | 57/176/23 | 175 |
| gae_lambda_095 | 6023 | 3640000 | completed | 45/176/35 | 125/127/4 | 126 |
| chain_lite | 6023 | 3640000 | completed | 45/176/35 | 47/186/23 | 186 |
| baseline | 6023 | 3640000 | completed | 45/176/35 | 40/196/20 | 196 |
| chain_lite | 6037 | 3640000 | completed | 44/181/31 | 66/174/16 | 174 |
| baseline | 6037 | 3640000 | completed | 44/181/31 | 52/188/16 | 188 |
| gae_lambda_095 | 6037 | 3640000 | completed | 44/181/31 | 109/140/7 | 139 |

## Matched final policy contrasts versus Random

Deltas compare each treatment against the same-seed baseline on the identical 128 deck pairs. Positive win delta means more wins, not merely fewer losses. Percentile intervals below apply to score, conditional on each trained model.

| Method | Seed | Win delta pp | Draw delta pp | Loss delta pp | Score delta [paired 95% CI] |
| --- | ---: | ---: | ---: | ---: | --- |
| gae_lambda_095 | 6011 | 25.39 | -21.88 | -3.52 | 0.1445 [0.095703125, 0.1953125] |
| gae_lambda_095 | 6023 | 33.20 | -26.95 | -6.25 | 0.1973 [0.15234375, 0.2421875] |
| gae_lambda_095 | 6037 | 22.27 | -18.75 | -3.52 | 0.1289 [0.083984375, 0.173828125] |

gae_lambda_095: mean matched win-rate delta across three training seeds = 26.95 pp; exploratory seed-level t95 = [12.96, 40.95] pp. Three seeds provide limited precision; this is not multiplicity-adjusted.
| chain_lite | 6011 | 3.52 | -4.69 | 1.17 | 0.0117 [-0.037109375, 0.05859375] |
| chain_lite | 6023 | 2.73 | -3.91 | 1.17 | 0.0078 [-0.037109375, 0.05078125] |
| chain_lite | 6037 | 5.47 | -5.47 | 0.00 | 0.0273 [-0.01171875, 0.06640625] |

chain_lite: mean matched win-rate delta across three training seeds = 3.91 pp; exploratory seed-level t95 = [0.41, 7.4] pp. Three seeds provide limited precision; this is not multiplicity-adjusted.

## Separate final head-to-head results

| Treatment run | W/D/L against matched baseline | Paired score | NO_PROGRESS |
| --- | --- | ---: | ---: |
| chain_lite-seed-6011 | 40/183/33 | 0.5137 | 183 |
| chain_lite-seed-6023 | 40/186/30 | 0.5195 | 184 |
| chain_lite-seed-6037 | 34/196/26 | 0.5156 | 196 |
| gae_lambda_095-seed-6011 | 74/159/23 | 0.5996 | 159 |
| gae_lambda_095-seed-6023 | 89/158/9 | 0.6562 | 158 |
| gae_lambda_095-seed-6037 | 103/143/10 | 0.6816 | 143 |

## Existing eight-probe diagnostics

These are narrow, previously used one-move checks, not the independent tactical benchmark. Values are initial-to-final changes in target action probability, in percentage points.

| Run | Immediate win | Avoid immediate loss | Winning repetition break |
| --- | ---: | ---: | ---: |
| baseline-seed-6011 | 55.86 | -2.45 | 52.20 |
| gae_lambda_095-seed-6011 | -9.51 | 16.37 | -23.79 |
| chain_lite-seed-6011 | 5.75 | 5.68 | 15.21 |
| gae_lambda_095-seed-6023 | -1.46 | -7.56 | 44.07 |
| chain_lite-seed-6023 | -12.68 | -1.30 | -12.64 |
| baseline-seed-6023 | 26.41 | -14.25 | 11.80 |
| chain_lite-seed-6037 | 7.15 | 5.57 | 10.28 |
| baseline-seed-6037 | 16.82 | 6.29 | 19.56 |
| gae_lambda_095-seed-6037 | 52.63 | 10.24 | 15.62 |

## Evidence and interpretation

Winning conversion is assessed from wins and losses separately from draws/score. Matched per-seed treatment contrasts, paired-deck bootstrap intervals, and head-to-head results are exported in comparison.json. Independent training seeds, n=3, are the replication unit. Score gains caused only by extra draws do not demonstrate better winning conversion.

Eight pre-existing Core-validated probes are diagnostics only; initial/final probability changes appear in probes/ and comparison.json. The prior M1 400-position tactical bank is unavailable here: broad tactical competence remains unverified. The reserved 100-win/100-defense bank is never opened or evaluated. No intermediate checkpoint selects the final model.

## Cross-machine qualifications

M1 source/dependency fingerprints, seed exclusivity and shared historical opponent are unverified/pending. No historical checkpoint is fabricated. Official local results use Uniform Random and separate matched-seed head-to-head matches. No EV/AI-6A games enter the benchmark. The shared manifest fixes exact deck seeds, both seats, RNG semantics and raw terminal-reason metrics.

Intel uses Python 3.11, PyTorch 2.2.2 and NumPy 1.26.4 because official macOS x86 wheels stop at PyTorch 2.2.x. These differ from the repository's M1 requirement pins (2.8.0/2.0.2); source and dependency differences preclude claiming byte-identical cross-machine inference. Transfer identical trusted models and run under a common compatible evaluation runtime before direct pooling. Within-Intel matched-seed contrasts remain independently interpretable.

The new 14M candidate final-test protocol was registered after prior campaigns; neither campaign is retrospectively described as having preregistered it. Local manifest audits run before freezing. If a later M1 audit finds an overlap, retain Intel results with the limitation; never change seeds after seeing scores.

No commitment to completion by a clock time is inferred from the pilot forecast. Incomplete work is explicitly pending, never a draw or evidence of no effect. Check run-status.json and per-run status.json for actual progress.
