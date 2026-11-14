# AI-7 overnight architecture comparison

Campaign phase: **completed**. Common training target: **3640000 environment transitions per run**.

Terminal rewards remain +1/0/−1. Core, observations, action masks, PPO hyperparameters and opponent mixture are shared; only model architecture differs. Results below distinguish incomplete work from completed evidence.

| Architecture | Seed | Train state |   Steps | Initial score | Final score | Difference | Paired bootstrap 95% CI |
| ------------ | ---: | ----------- | ------: | ------------: | ----------: | ---------: | ----------------------- |
| baseline     |   11 | completed   | 3640000 |        51.17% |      52.73% |    1.56 pp | [-3.52, 6.45] pp        |
| critic       |   11 | completed   | 3640000 |        51.17% |      50.78% |   -0.39 pp | [-5.67, 4.69] pp        |
| cnn          |   11 | completed   | 3640000 |        52.34% |      51.56% |   -0.78 pp | [-5.86, 4.30] pp        |
| critic       |   23 | completed   | 3640000 |        52.15% |      56.25% |    4.10 pp | [-0.59, 8.79] pp        |
| cnn          |   23 | completed   | 3640000 |        50.78% |      52.73% |    1.95 pp | [-3.32, 7.42] pp        |
| baseline     |   23 | completed   | 3640000 |        52.15% |      56.25% |    4.10 pp | [-0.59, 8.79] pp        |
| cnn          |   37 | completed   | 3640000 |        51.56% |      55.47% |    3.91 pp | [-1.37, 8.79] pp        |
| baseline     |   37 | completed   | 3640000 |        52.34% |      55.47% |    3.12 pp | [-1.76, 8.01] pp        |
| critic       |   37 | completed   | 3640000 |        52.34% |      51.37% |   -0.98 pp | [-5.27, 3.32] pp        |

## Independent training-seed replication

| Architecture | Comparable completed seeds | Mean improvement | Exploratory seed-level t 95% CI | Positive individual CIs |
| ------------ | -------------------------: | ---------------: | ------------------------------- | ----------------------: |
| baseline     |                        3/3 |          2.93 pp | [-0.25, 6.11] pp                |                       0 |
| critic       |                        3/3 |          0.91 pp | [-5.99, 7.81] pp                |                       0 |
| cnn          |                        3/3 |          1.69 pp | [-4.16, 7.54] pp                |                       0 |

Training seed, not individual game, is the replication unit. With only three seeds, t intervals depend strongly on approximate normality; conservative bounded-seed intervals are also in comparison.json. Individual 128-pair policy confidence intervals do not turn thousands of games into thousands of independent learning experiments. No architecture winner is declared from the highest observed score.

## Direct research answers

- **baseline learning:** 3/3 completed seeds have a positive improvement point estimate; 0/3 have an individual paired bootstrap interval above zero. This is reported alongside replication-level intervals, not a claim based on loss reduction.
  Consistent positive point estimates, but improvement remains statistically inconclusive across the required evidence checks.
- **critic learning:** 1/3 completed seeds have a positive improvement point estimate; 0/3 have an individual paired bootstrap interval above zero. This is reported alongside replication-level intervals, not a claim based on loss reduction.
  No consistent positive learning effect established across independent training seeds.
- **cnn learning:** 2/3 completed seeds have a positive improvement point estimate; 0/3 have an individual paired bootstrap interval above zero. This is reported alongside replication-level intervals, not a claim based on loss reduction.
  No consistent positive learning effect established across independent training seeds.
- **critic versus MLP:** matched-seed final score difference mean -2.02 pp; explained-variance difference -0.168. Compare their intervals in comparison.json. Better value fit alone does not establish stronger play. CNN efficiency is compared at the same transition endpoint; curves show optimization and cost, not unobserved between-checkpoint playing strength.
- **cnn versus MLP:** matched-seed final score difference mean -1.56 pp; explained-variance difference 0.049. Compare their intervals in comparison.json. Better value fit alone does not establish stronger play. CNN efficiency is compared at the same transition endpoint; curves show optimization and cost, not unobserved between-checkpoint playing strength.
- **Tactical/endgame evidence:** probe results measure categorical action probability on eight frozen Core-validated positions. Compare initial/final masses in comparison.csv/json. Immediate captures are not necessarily good captures; endgame/repetition probes test one-move terminal conversion, not general coordination or multi-move endgames.
- **FLIP risk:** labels use publicly remaining inventory and all possible reveals, then check an opponent's immediate terminal winning MOVE. They never use actual hidden identities. This narrow risk metric cannot judge long-horizon FLIP quality.
- **Repetition/draw-seeking:** initial/final NO_PROGRESS, repeated public positions, and own-move reversals are recorded per run. Higher repetition alone is not evidence of intent. High score through draws must be separated from improved winning conversion.

## Limits and next experiment

No probe, validation, or held-out result feeds training or selects a replacement architecture. No reward shaping or baseline promotion is performed. A reliable advantage requires consistent independent seeds, positive paired evidence, and compatible replication-level uncertainty; all inconclusive cases remain inconclusive. Next prioritize a preregistered replication of any consistent effect on fresh deck seeds, or an unchanged-reward failure analysis of exploration, critic predictions and conversion if no effect is supported.

## Replay examples

- `evaluations/baseline-seed-11/replays/final-random-seed-3000000-seat-0.json` — 305 plies, result {"type": "DRAW", "reason": "NO_PROGRESS"}; deterministic Core replay verified by the archive writer.
- `evaluations/baseline-seed-11/replays/final-random-seed-3000000-seat-1.json` — 184 plies, result {"type": "DRAW", "reason": "NO_PROGRESS"}; deterministic Core replay verified by the archive writer.
- `evaluations/baseline-seed-23/replays/final-random-seed-3000000-seat-0.json` — 398 plies, result {"type": "DRAW", "reason": "NO_PROGRESS"}; deterministic Core replay verified by the archive writer.
- `evaluations/baseline-seed-23/replays/final-random-seed-3000000-seat-1.json` — 181 plies, result {"type": "DRAW", "reason": "NO_PROGRESS"}; deterministic Core replay verified by the archive writer.
- `evaluations/baseline-seed-37/replays/final-random-seed-3000000-seat-0.json` — 153 plies, result {"type": "WIN", "winner": "P1", "reason": "NO_PIECES"}; deterministic Core replay verified by the archive writer.
- `evaluations/baseline-seed-37/replays/final-random-seed-3000000-seat-1.json` — 256 plies, result {"type": "DRAW", "reason": "NO_PROGRESS"}; deterministic Core replay verified by the archive writer.

Full configurations and source hashes are in config.json/source fingerprints and each run manifest. comparison.csv/json include completed/attempted denominators, cost, entropy, value diagnostics, draw/repetition metrics and evaluation-only probe masses. Missing values remain empty/pending.
