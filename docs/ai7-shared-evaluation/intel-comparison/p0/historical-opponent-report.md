# Shared historical opponent and new deck evaluation

Manifest SHA-256: `b2076ad8b89ac39eba71ef022c0dbbaa7bbeb7a1c6cfd4f07dc6358860269568`. Exact original historical checkpoint SHA-256: `d7b5623b61b26b1f17dd93189a512c3c0f81a4c9d8bd7a3131728078c53bb4b8`. All nine final policies are frozen. Both opponents use the same 256 new seeded decks and both seats, 512 games/model/opponent. No previous direct Intel head-to-head matches were rerun.

Historical tensor identity: original .pt loaded via `native_torch_load`; all eight tensors exactly equal the verified NPZ export. Intel inference agrees with M1 reference to max absolute probability error 2.38e-07. Encoder, model class, action/environment bytes, Core/rules, deck and RNG compatibility were checked. Git revisions/dependencies differ, so this certifies common-runtime inference compatibility, not bit-identical cross-machine trajectories.

The old Intel 14M decks overlap M1's curriculum-generation namespace. Old results remain Intel-internal evidence; they are not a shared independent final test. The new 20M proposal was fixed only after both accessible local manifests and the supplied M1 inventory were checked. The M1 inventory is exporter evidence; no claim is made to have independently opened all M1 original manifests.

## Opponent: random

These totals describe three training seeds; the independent learning-replication unit remains training seed, not the 1,536 games.

| Method | W/D/L | Win % | Draw % | Loss % | Score % | NO_PROGRESS % | Mean/median plies | Repetitions | Reversals |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Baseline | 256/1167/113 | 16.67 | 75.98 | 7.36 | 54.65 | 75.85 | 253.2/249.0 | 6.03 | 31.90 |
| GAE-0.95 | 717/766/53 | 46.68 | 49.87 | 3.45 | 71.61 | 49.87 | 213.2/212.0 | 6.00 | 27.18 |
| CHAIN-lite | 317/1101/118 | 20.64 | 71.68 | 7.68 | 56.48 | 71.61 | 248.5/244.0 | 5.88 | 30.25 |

Terminal reasons: Baseline `{'NO_PIECES': 363, 'NO_LEGAL_ACTION': 6, 'NO_PROGRESS': 1165, 'CHASE_STALEMATE': 2}`; GAE-0.95 `{'NO_PIECES': 767, 'NO_PROGRESS': 766, 'NO_LEGAL_ACTION': 3}`; CHAIN-lite `{'NO_PIECES': 430, 'NO_LEGAL_ACTION': 5, 'NO_PROGRESS': 1100, 'CHASE_STALEMATE': 1}`.

| Treatment | Seed | W/D/L | Score delta vs matched Baseline pp [paired 95%] | Win/draw/loss delta pp | NO_PROGRESS delta pp |
| --- | ---: | --- | --- | --- | ---: |
| GAE-0.95 | 6011 | 219/268/25 | +14.06 [+10.74, +17.48] | +25.20/-22.27/-2.93 | -22.07 |
| CHAIN-lite | 6011 | 96/375/41 | +0.49 [-2.73, +3.71] | +1.17/-1.37/+0.20 | -1.17 |
| GAE-0.95 | 6023 | 254/243/15 | +18.95 [+15.92, +21.97] | +35.16/-32.42/-2.73 | -32.23 |
| CHAIN-lite | 6023 | 96/377/39 | +1.17 [-1.86, +4.20] | +4.30/-6.25/+1.95 | -6.25 |
| GAE-0.95 | 6037 | 244/255/13 | +17.87 [+14.45, +21.19] | +29.69/-23.63/-6.05 | -23.63 |
| CHAIN-lite | 6037 | 125/349/38 | +3.81 [+0.39, +7.23] | +6.45/-5.27/-1.17 | -5.27 |
## Opponent: m1_exp2_baseline_4023

These totals describe three training seeds; the independent learning-replication unit remains training seed, not the 1,536 games.

| Method | W/D/L | Win % | Draw % | Loss % | Score % | NO_PROGRESS % | Mean/median plies | Repetitions | Reversals |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Baseline | 148/1162/226 | 9.64 | 75.65 | 14.71 | 47.46 | 75.59 | 254.3/251.0 | 10.28 | 41.14 |
| GAE-0.95 | 506/940/90 | 32.94 | 61.20 | 5.86 | 63.54 | 60.55 | 234.1/232.0 | 10.23 | 38.76 |
| CHAIN-lite | 176/1142/218 | 11.46 | 74.35 | 14.19 | 48.63 | 74.28 | 246.8/241.0 | 9.38 | 38.12 |

Terminal reasons: Baseline `{'NO_PIECES': 373, 'NO_PROGRESS': 1161, 'NO_LEGAL_ACTION': 1, 'CHASE_STALEMATE': 1}`; GAE-0.95 `{'NO_PIECES': 590, 'NO_LEGAL_ACTION': 6, 'NO_PROGRESS': 930, 'CHASE_STALEMATE': 10}`; CHAIN-lite `{'NO_PIECES': 392, 'NO_PROGRESS': 1141, 'CHASE_STALEMATE': 1, 'NO_LEGAL_ACTION': 2}`.

| Treatment | Seed | W/D/L | Score delta vs matched Baseline pp [paired 95%] | Win/draw/loss delta pp | NO_PROGRESS delta pp |
| --- | ---: | --- | --- | --- | ---: |
| GAE-0.95 | 6011 | 155/329/28 | +18.07 [+14.75, +21.48] | +21.48/-6.84/-14.65 | -8.01 |
| CHAIN-lite | 6011 | 53/414/45 | +6.45 [+3.52, +9.47] | +1.56/+9.77/-11.33 | +9.57 |
| GAE-0.95 | 6023 | 205/268/39 | +17.77 [+14.26, +21.29] | +29.69/-23.83/-5.86 | -24.02 |
| CHAIN-lite | 6023 | 63/362/87 | -0.78 [-3.81, +2.15] | +1.95/-5.47/+3.52 | -5.47 |
| GAE-0.95 | 6037 | 146/343/23 | +12.40 [+9.47, +15.23] | +18.75/-12.70/-6.05 | -13.09 |
| CHAIN-lite | 6037 | 60/366/86 | -2.15 [-5.27, +0.88] | +1.95/-8.20/+6.25 | -8.01 |

Per-model seats, all terminal reasons, raw games, pair scores and errors/incomplete accounting are in shared-opponent-results.json. Score is (wins+0.5*draws)/completed. Pair both seats before 10,000 deck-bootstrap resamples, seed19. These conditional intervals do not turn games into independent training replications; the three training-seed contrasts are reported separately. All new benchmarks are exploratory follow-up evaluation, not retroactive preregistration.

Reproduce: `python -B -m scripts.ai7_p0.games --output /Users/shinelin/Desktop/dark-chinese-chess/dark-chinese-chess/benchmark-results/ai7-selfplay/intel-p0/20261115-v1` using identical imported artifacts and frozen manifest in a fresh output directory.
