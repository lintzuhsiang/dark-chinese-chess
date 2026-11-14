# P1/P2 訓練過程與結果研究

中文重點：

- 本次基準組不只少輸：1536局合計勝場+140、敗場−109，和局−31。不能沿用上輪「改善完全來自少輸」的結論。
- P1降低LR確實降低Probe更新幅度，但三個seed的最終Random分數均低於基準；較穩定不等於更有效學習。
- P2增加Random未顯示優於基準。確認探針改善與原探針退化並存，顯示幾何／位置／history-reference表徵敏感性值得獨立驗證。
- 凍結歷史對手相較初始有改善訊號，但最終平均接近50%，僅一個對手與64pairs不足以證明廣泛棋力優勢。
- 最終單次Value EV可能為正，最後100次update的平均仍多為負；不能據最後一列宣告Critic已恢復。
- 梯度衝突、和局advantage與Probe變化仍屬關聯，不是因果證明。下一步先做對稱性與局部更新診斷，再決定新的長程訓練。

以下為可重現的完整數表、方法與限制。所有分析均為唯讀，未執行新訓練。

# P1/P2 completed experiment review

This report reuses completed results only. No weights, rewards, Core rules or training settings were changed. Nine runs reached3.64M steps each; three training seeds per treatment. All Random tests use256 deck pairs per policy; the single historical opponent uses64 pairs. Reported seed-level t intervals are exploratory, n=3, conditional on this fixed deck set, with no multiple-comparison adjustment.

## Outcome decomposition

| Treatment   | Initial W/D/L totals | Final W/D/L totals | Win change | Loss change | Mean score improvement |
| ----------- | -------------------- | ------------------ | ---------: | ----------: | ---------------------: |
| baseline    | 215/1103/218         | 355/1072/109       |       +140 |        -109 |                8.11 pp |
| low_lr      | 215/1103/218         | 266/1068/202       |        +51 |         -16 |                2.18 pp |
| random_rich | 215/1103/218         | 313/1097/126       |        +98 |         -92 |                6.18 pp |

Baseline now gains140 wins and removes109 losses across1536 games: +4.56pp from wins, +3.55pp from fewer losses. This contradicts applying the previous campaign’s “only fewer losses” diagnosis universally. Different training and evaluation seeds mean cross-campaign improvement itself is not a controlled treatment effect.

## Process diagnostics

| Run                   | Probe KL p95 | Worst one-update winning-mass change | Original probe peak→final | EV last100-update mean | Gradient cosine<0 sampled fraction |
| --------------------- | -----------: | -----------------------------------: | ------------------------- | ---------------------: | ---------------------------------: |
| baseline-seed-4011    |       0.0260 |                            -11.81 pp | 0.942→0.445               |                 -0.173 |                              51.3% |
| low_lr-seed-4011      |       0.0089 |                             -7.69 pp | 0.609→0.414               |                 -0.118 |                              57.3% |
| random_rich-seed-4011 |       0.0245 |                            -11.75 pp | 0.753→0.254               |                 -0.158 |                              53.9% |
| low_lr-seed-4023      |       0.0081 |                             -8.43 pp | 0.518→0.311               |                 -0.036 |                              51.8% |
| random_rich-seed-4023 |       0.0227 |                            -12.97 pp | 0.841→0.200               |                 -0.165 |                              57.1% |
| baseline-seed-4023    |       0.0258 |                            -12.86 pp | 0.860→0.056               |                 -0.111 |                              52.3% |
| random_rich-seed-4037 |       0.0230 |                             -9.89 pp | 0.683→0.016               |                 -0.199 |                              54.9% |
| baseline-seed-4037    |       0.0232 |                            -11.97 pp | 0.500→0.051               |                 -0.170 |                              52.7% |
| low_lr-seed-4037      |       0.0088 |                             -7.14 pp | 0.513→0.157               |                 -0.040 |                              50.5% |

Lower LR mechanically reduces changes but does not preserve strong general tactical ability. Original-probe peak/final ratios are descriptive and peak depends on visited checkpoints; they are not checkpoint-selection criteria. Final single-update EV can look positive while the last100-update mean remains negative; do not infer Critic recovery from the last row alone. Negative cosine remains common in every arm and does not identify a causal culprit.

## Fixed historical opponent

| Treatment   | Mean final score | Mean improvement from initial | Seed-level exploratory t95 improvement       |
| ----------- | ---------------: | ----------------------------: | -------------------------------------------- |
| baseline    |          51.172% |                       8.33 pp | [-0.008382110541311785, 0.17504877720797846] |
| low_lr      |          47.917% |                       5.08 pp | [-0.008243827316943578, 0.10980632731694358] |
| random_rich |          50.000% |                       7.16 pp | [0.04042167117925082, 0.10280749548741583]   |

All treatment point estimates improve over their untrained policies against the historical opponent, so “zero generalization” would be too strong. However, finals remain close to50% against this one learned opponent. Random-rich has no demonstrated advantage over baseline on this generalization test. One opponent and64 pairs limit conclusions.

## Symmetry warning

| Run                       | Original winning-probe mass | 180-degree counterpart mass |
| ------------------------- | --------------------------: | --------------------------: |
| baseline-seed-4011 / 5    |                       0.151 |                       0.068 |
| baseline-seed-4011 / 6    |                       0.417 |                       0.140 |
| baseline-seed-4011 / 7    |                       0.766 |                       0.061 |
| low_lr-seed-4011 / 5      |                       0.407 |                       0.082 |
| low_lr-seed-4011 / 6      |                       0.427 |                       0.072 |
| low_lr-seed-4011 / 7      |                       0.408 |                       0.082 |
| random_rich-seed-4011 / 5 |                       0.269 |                       0.890 |
| random_rich-seed-4011 / 6 |                       0.276 |                       0.896 |
| random_rich-seed-4011 / 7 |                       0.218 |                       0.941 |
| low_lr-seed-4023 / 5      |                       0.300 |                       0.179 |
| low_lr-seed-4023 / 6      |                       0.308 |                       0.184 |
| low_lr-seed-4023 / 7      |                       0.325 |                       0.157 |
| random_rich-seed-4023 / 5 |                       0.197 |                       0.682 |
| random_rich-seed-4023 / 6 |                       0.153 |                       0.613 |
| random_rich-seed-4023 / 7 |                       0.249 |                       0.525 |
| baseline-seed-4023 / 5    |                       0.052 |                       0.132 |
| baseline-seed-4023 / 6    |                       0.052 |                       0.082 |
| baseline-seed-4023 / 7    |                       0.066 |                       0.082 |
| random_rich-seed-4037 / 5 |                       0.023 |                       0.440 |
| random_rich-seed-4037 / 6 |                       0.017 |                       0.543 |
| random_rich-seed-4037 / 7 |                       0.007 |                       0.518 |
| baseline-seed-4037 / 5    |                       0.044 |                       0.035 |
| baseline-seed-4037 / 6    |                       0.037 |                       0.032 |
| baseline-seed-4037 / 7    |                       0.074 |                       0.013 |
| low_lr-seed-4037 / 5      |                       0.139 |                       0.285 |
| low_lr-seed-4037 / 6      |                       0.157 |                       0.249 |
| low_lr-seed-4037 / 7      |                       0.175 |                       0.208 |

These are genuinely different public input vectors, including transformed public reveal references/history/action IDs, but geometrically equivalent rule tasks. Large disparities support representation/position sensitivity as a hypothesis. They do not isolate whether board position, reference coding, history or fixed action-head biases cause the difference. Mirror probes are not independent tactical task samples.

## Hypothesis assessment

- P1: supported in the narrow sense of reduced update/probe volatility. The desired equal-step strength improvement is not supported: low-LR is lower in all three matched seeds; mean difference−5.92pp, exploratory t95[−10.57,−1.28]pp. This is not proof that low LR can never work at larger budgets.
- P2: increased wins versus initial in aggregate, but not reliably more than baseline: final mean contrast−1.92pp, exploratory t95[−9.12,+5.28]pp. No demonstrated overall advantage. Mirror winning probes improve, while original winning probes often decay. General tactical learning is not established.
- Critic-gradient harm: unproven. Gradient conflicts are associations and detailed samples cover only predetermined minibatches.
- Draw-driven reinforcement: plausible mechanism, not established intent or causal proof. Roughly70–75% of decisions come from drawn games, but only a subset has positive advantage, and normalized/clipped gradients cannot be interpreted from counts alone.

## Next experiments, not executed

1. Evaluation-only symmetry audit: compare every saved checkpoint on the same original/rotated public states, per action, stage and public reference/history transformation. Add a larger fresh set of genuinely different Core-validated endgames before concluding tactical capability.
2. Deterministic targeted replays around large winning-probability drops; record all minibatches, actual pre/post-Adam parameter changes, and local counterfactual one-update actor-only/value-only/entropy-only branches from identical boundary state. These branch tests diagnose local effects, not full-training causal strength.
3. Only after those diagnostics, consider a separate symmetry-augmentation or board/action representation treatment. Board, legal mask, action IDs, history and public identity references must transform consistently; no tactical labels or shaped rewards.
4. Retain baseline as the current reference. If testing lower LR longer, compare equal steps AND equal total update displacement/compute explicitly; do not silently grant only one treatment more budget. Random40% is not adopted as default based on present evidence.

No new training or configuration promotion was performed.
