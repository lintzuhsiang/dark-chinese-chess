# 現有紀錄與模型的離線分析

本次沒有訓練、更新權重、重建過去梯度或使用保留確認集。

## 保存範圍

| Run                   | 全部訓練局數 | 完整棋譜 | Checkpoints | 含診斷的 updates |
| --------------------- | -----------: | -------: | ----------: | ---------------: |
| baseline-seed-4011    |        13808 |        4 |           5 |              863 |
| baseline-seed-4023    |        14074 |        4 |           5 |              881 |
| baseline-seed-4037    |        13973 |        4 |           5 |              875 |
| low_lr-seed-4011      |        13920 |        4 |           5 |              870 |
| low_lr-seed-4023      |        13984 |        4 |           5 |              874 |
| low_lr-seed-4037      |        13773 |        4 |           5 |              862 |
| random_rich-seed-4011 |        14176 |        4 |           5 |              887 |
| random_rich-seed-4023 |        14297 |        4 |           5 |              894 |
| random_rich-seed-4037 |        14160 |        4 |           5 |              885 |

## 全部訓練摘要

以下不是固定對手評估，不能由訓練勝率比較棋力。

| Run                   |    W |     D |    L | 平均步數 | 平均往返 | 平均重複局面 |
| --------------------- | ---: | ----: | ---: | -------: | -------: | -----------: |
| baseline-seed-4011    | 2424 |  9410 | 1974 |    263.2 |     40.4 |          9.8 |
| baseline-seed-4023    | 2582 |  9475 | 2017 |    258.1 |     37.8 |          8.7 |
| baseline-seed-4037    | 2407 |  9755 | 1811 |    260.0 |     36.4 |          8.2 |
| low_lr-seed-4011      | 1944 | 10186 | 1790 |    261.2 |     29.9 |          5.5 |
| low_lr-seed-4023      | 2277 |  9512 | 2195 |    259.7 |     28.9 |          5.2 |
| low_lr-seed-4037      | 2097 |  9766 | 1910 |    263.8 |     29.9 |          5.4 |
| random_rich-seed-4011 | 2662 |  9850 | 1664 |    256.2 |     35.6 |          7.9 |
| random_rich-seed-4023 | 2232 | 10471 | 1594 |    254.2 |     34.3 |          7.5 |
| random_rich-seed-4037 | 2426 | 10234 | 1500 |    256.8 |     36.4 |          8.1 |

## 可重播棋譜中的戰術機會

僅統計 learner 的決策。勝著與防守互斥；防守只代表避免對手一手終局勝利。

| Run                   | 棋譜局數 | Learner 決策 | 完全明子決策 | 勝著機會／實際選對 | 防守機會／實際選對 |
| --------------------- | -------: | -----------: | -----------: | -----------------: | -----------------: |
| baseline-seed-4011    |        4 |          460 |          224 |             15 / 1 |              2 / 1 |
| baseline-seed-4023    |        4 |          559 |          230 |              6 / 1 |              0 / 0 |
| baseline-seed-4037    |        4 |          442 |          239 |              5 / 1 |            20 / 11 |
| low_lr-seed-4011      |        4 |          481 |          284 |             11 / 0 |              2 / 1 |
| low_lr-seed-4023      |        4 |          479 |          186 |              0 / 0 |              0 / 0 |
| low_lr-seed-4037      |        4 |          464 |          241 |              9 / 0 |             15 / 9 |
| random_rich-seed-4011 |        4 |          532 |          315 |              1 / 0 |             10 / 7 |
| random_rich-seed-4023 |        4 |          440 |          251 |              0 / 0 |            21 / 12 |
| random_rich-seed-4037 |        4 |          581 |          285 |             13 / 2 |             15 / 9 |

## 同一批實際訓練局面的 checkpoint 機率

每格為機會決策的平均機率，不是實戰勝率；同盤內多次出現的局面有相關性。不同 run 使用不同局面，不能當成公平的 treatments 排名。

| Run                   | 任務    | 機會數 | 隨機基準 | Initial |  0.91M |  1.82M |  2.73M |  Final |
| --------------------- | ------- | -----: | -------: | ------: | -----: | -----: | -----: | -----: |
| baseline-seed-4011    | win     |     15 |    8.27% |   8.27% | 10.18% | 22.98% |  8.06% |  6.84% |
| baseline-seed-4011    | defense |      2 |   75.00% |  75.03% | 53.83% | 65.44% | 69.40% | 70.08% |
| baseline-seed-4023    | win     |      6 |    9.11% |   9.10% | 15.91% |  7.50% |  5.34% |  5.75% |
| baseline-seed-4037    | win     |      5 |    7.60% |   7.60% | 10.85% | 10.64% | 10.00% | 12.86% |
| baseline-seed-4037    | defense |     20 |   55.00% |  55.00% | 54.85% | 48.07% | 52.70% | 60.77% |
| low_lr-seed-4011      | win     |     11 |    8.86% |   8.86% |  4.62% | 12.20% |  8.19% |  4.37% |
| low_lr-seed-4011      | defense |      2 |   75.00% |  75.03% | 76.60% | 82.71% | 92.13% | 90.66% |
| low_lr-seed-4037      | win     |      9 |   10.29% |  10.29% | 11.34% | 10.60% | 12.48% |  9.67% |
| low_lr-seed-4037      | defense |     15 |   55.00% |  54.99% | 45.17% | 60.24% | 54.23% | 49.55% |
| random_rich-seed-4011 | win     |      1 |   14.29% |  14.28% |  0.58% |  2.03% |  3.87% | 24.02% |
| random_rich-seed-4011 | defense |     10 |   58.33% |  58.34% | 50.54% | 60.10% | 69.51% | 68.40% |
| random_rich-seed-4023 | defense |     21 |   59.92% |  59.93% | 56.75% | 71.72% | 56.79% | 65.10% |
| random_rich-seed-4037 | win     |     13 |   10.74% |  10.74% | 11.93% | 23.30% | 13.18% | 11.57% |
| random_rich-seed-4037 | defense |     15 |   55.00% |  54.99% | 57.90% | 63.27% | 48.46% | 63.71% |

## 限制與可用價值

- Replay sample is four deterministically archived game-0 trajectories per run, not random representative sampling.
- Only fully revealed states are classified; states with hidden pieces are unclassified, not zero opportunities.
- Repeated opportunities from one game are dependent; no position-level independence claim or significance test.
- Old actions are factual; checkpoint probabilities are retrospective on old-policy states, not reconstructed behavior probabilities or causal update effects.
- Quarter membership uses completed-update environment-step totals, not exact per-game step boundaries.
- Self-play training WDL is against changing opponent mixtures, not a fixed strength benchmark.

- 摘要可分析全期終局比例、棋局長度與對手組成；棋譜只支持小樣本覆蓋與具體失誤案例。
- 已保存的 45 個模型可重複評估公共局面、對稱性與交叉對戰，不需要訓練。
- 若要估計全部訓練的戰術覆蓋率，需要更多完整棋譜，或先證明可從保存的完整邊界 checkpoint、RNG 與程式版本確定性重播。不能把 deck seed 當成完整走法紀錄。
- 過去未保存的梯度不能還原成原始測量。詳細診斷只在預先指定 minibatches 取樣，不能聲稱每個更新都有完整因果對齊。
