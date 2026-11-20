# Combined research conclusion

This evaluation adds an exact independent tactical bank and one identical historical opponent to the earlier Intel result. It does not train, fine-tune, select a replacement checkpoint, or run EV/AI-6A.

## 1. Independent immediate tactics and 2. action ranking

- GAE-0.95, win: matched-seed probability-mass differences pp = [1.6, 3.61, 2.77]; top1 differences pp = [3.0, 5.5, 4.0]; rank differences = [-0.27, -0.43, -0.445] (negative rank difference is better). Assess each alongside conditional CIs in tactical-generalization-report.md; a sampling-mass change is distinct from a greedy-choice change.
- CHAIN-lite, win: matched-seed probability-mass differences pp = [0.92, 0.47, -1.48]; top1 differences pp = [3.25, 1.5, -2.75]; rank differences = [-0.328, -0.048, 0.345] (negative rank difference is better). Assess each alongside conditional CIs in tactical-generalization-report.md; a sampling-mass change is distinct from a greedy-choice change.
- GAE-0.95, defense: matched-seed probability-mass differences pp = [0.79, -0.46, -0.49]; top1 differences pp = [0.0, -0.75, -2.25]; rank differences = [-0.015, 0.028, -0.005] (negative rank difference is better). Assess each alongside conditional CIs in tactical-generalization-report.md; a sampling-mass change is distinct from a greedy-choice change.
- CHAIN-lite, defense: matched-seed probability-mass differences pp = [-0.48, 1.64, 2.19]; top1 differences pp = [0.0, 1.75, 3.0]; rank differences = [0.007, -0.04, -0.04] (negative rank difference is better). Assess each alongside conditional CIs in tactical-generalization-report.md; a sampling-mass change is distinct from a greedy-choice change.

## 3. Ability across intermediate checkpoints

All five predetermined endpoints were evaluated. The complete trajectory table and adjacent paired intervals are retained. An isolated highest intermediate value is not a selected model or evidence of a lasting final improvement. See tactical-generalization-report.md; source positions are paired across checkpoints.

## 4. Common historical opponent and 5. NO_PROGRESS

- GAE-0.95 vs random: aggregate descriptive deltas pp = {'win_rate': 30.013020833333336, 'draw_rate': -26.106770833333332, 'loss_rate': -3.906249999999999, 'score': 16.959635416666675, 'no_progress_rate': -25.976562499999993}; three separate training-seed score differences pp = [14.06, 18.95, 17.87]. Changes in wins, losses and NO_PROGRESS are separate outcomes; aggregate score alone does not establish opponent-general improvement.
- CHAIN-lite vs random: aggregate descriptive deltas pp = {'win_rate': 3.9713541666666687, 'draw_rate': -4.296875, 'loss_rate': 0.32552083333333426, 'score': 1.822916666666674, 'no_progress_rate': -4.231770833333326}; three separate training-seed score differences pp = [0.49, 1.17, 3.81]. Changes in wins, losses and NO_PROGRESS are separate outcomes; aggregate score alone does not establish opponent-general improvement.
- GAE-0.95 vs m1_exp2_baseline_4023: aggregate descriptive deltas pp = {'win_rate': 23.307291666666664, 'draw_rate': -14.453125, 'loss_rate': -8.854166666666666, 'score': 16.080729166666664, 'no_progress_rate': -15.0390625}; three separate training-seed score differences pp = [18.07, 17.77, 12.4]. Changes in wins, losses and NO_PROGRESS are separate outcomes; aggregate score alone does not establish opponent-general improvement.
- CHAIN-lite vs m1_exp2_baseline_4023: aggregate descriptive deltas pp = {'win_rate': 1.8229166666666656, 'draw_rate': -1.302083333333326, 'loss_rate': -0.5208333333333315, 'score': 1.171875, 'no_progress_rate': -1.302083333333337}; three separate training-seed score differences pp = [6.45, -0.78, -2.15]. Changes in wins, losses and NO_PROGRESS are separate outcomes; aggregate score alone does not establish opponent-general improvement.

## 6. Timing

Intel's original complete campaign duration is measured; the approximately-three-hour M1 campaign duration remains user-reported. One actual M1 historical baseline timing record is available from its original checkpoint, with configuration and instrumentation qualifications. Full baseline timing logs from comparable M1 runs are not supplied. A pure hardware speed ratio is not established. See cross-machine-performance.md.

## 7. Next controlled training experiment

Use the observed game and tactical effects jointly to choose a single predeclared question. Replicate GAE-0.95 on additional fresh training seeds and fresh confirmation decks before adoption. If game gains coexist with tactical weakness, separate reward-credit/critic calibration from immediate action-ranking competence using new training-generated diagnostics and a fixed common terminal-return calibration set. Do not tune on this tactical bank or new final-test results and then call them independent confirmation. Keep the reserved 100+100 bank untouched until a separately fixed confirmation protocol. CHAIN-lite conclusions apply only to this alpha/reference design; no claim about the entire published CHAIN method follows.

Inputs are identified in import-validation.json, compatibility-validation.json, plan.json, and shared-evaluation-manifest.sha256. Exact per-checkpoint hashes are retained. No existing training artifacts were modified.
