# 五盤最後勝著機會：策略排名

固定原始方向；checkpoint 回看，不是當時每次更新的原始模型。

| Run                   | 棋譜                        | Checkpoint        | 勝著機率 | 最佳勝著排名 | 最高機率是否勝著 |
| --------------------- | --------------------------- | ----------------- | -------: | -----------: | ---------------- |
| baseline-seed-4011    | rollout-000217-game-00.json | initial.pt        |    6.66% |           13 | False            |
| baseline-seed-4011    | rollout-000217-game-00.json | step-000910000.pt |    5.87% |            9 | False            |
| baseline-seed-4011    | rollout-000217-game-00.json | step-001820000.pt |    1.04% |            7 | False            |
| baseline-seed-4011    | rollout-000217-game-00.json | step-002730000.pt |    1.12% |           10 | False            |
| baseline-seed-4011    | rollout-000217-game-00.json | final.pt          |    1.16% |           14 | False            |
| low_lr-seed-4011      | rollout-000218-game-00.json | initial.pt        |   11.11% |            6 | False            |
| low_lr-seed-4011      | rollout-000218-game-00.json | step-000910000.pt |    6.49% |            7 | False            |
| low_lr-seed-4011      | rollout-000218-game-00.json | step-001820000.pt |   29.14% |            1 | True             |
| low_lr-seed-4011      | rollout-000218-game-00.json | step-002730000.pt |    2.68% |            8 | False            |
| low_lr-seed-4011      | rollout-000218-game-00.json | final.pt          |    5.94% |            7 | False            |
| low_lr-seed-4011      | rollout-000435-game-00.json | initial.pt        |   11.11% |            5 | False            |
| low_lr-seed-4011      | rollout-000435-game-00.json | step-000910000.pt |    9.66% |            3 | False            |
| low_lr-seed-4011      | rollout-000435-game-00.json | step-001820000.pt |    6.50% |            8 | False            |
| low_lr-seed-4011      | rollout-000435-game-00.json | step-002730000.pt |    3.80% |            8 | False            |
| low_lr-seed-4011      | rollout-000435-game-00.json | final.pt          |    1.85% |            7 | False            |
| low_lr-seed-4037      | rollout-000648-game-00.json | initial.pt        |    7.69% |            8 | False            |
| low_lr-seed-4037      | rollout-000648-game-00.json | step-000910000.pt |   11.43% |            2 | False            |
| low_lr-seed-4037      | rollout-000648-game-00.json | step-001820000.pt |    4.88% |            9 | False            |
| low_lr-seed-4037      | rollout-000648-game-00.json | step-002730000.pt |    9.42% |            2 | False            |
| low_lr-seed-4037      | rollout-000648-game-00.json | final.pt          |    4.63% |           10 | False            |
| random_rich-seed-4011 | rollout-000216-game-00.json | initial.pt        |   14.28% |            5 | False            |
| random_rich-seed-4011 | rollout-000216-game-00.json | step-000910000.pt |    0.58% |            6 | False            |
| random_rich-seed-4011 | rollout-000216-game-00.json | step-001820000.pt |    2.03% |            7 | False            |
| random_rich-seed-4011 | rollout-000216-game-00.json | step-002730000.pt |    3.87% |            5 | False            |
| random_rich-seed-4011 | rollout-000216-game-00.json | final.pt          |   24.02% |            1 | True             |
