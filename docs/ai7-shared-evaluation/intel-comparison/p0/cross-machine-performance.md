# Cross-machine performance accounting

No new training was run. All training numbers below come from existing Intel summary.json / metrics.jsonl. PPO update means one rollout optimization pass; optimizer minibatch steps are a separate quantity.

| Method | Seed | Wall min incl validation | Env transitions / wall s | PPO updates / train s | Rollout s | Optimizer s | Validation s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 6011 | 33.03 | 1836.7 | 0.434 | 1568.0 | 350.3 | 13.3 |
| Baseline | 6023 | 34.34 | 1766.4 | 0.428 | 1629.9 | 356.5 | 13.7 |
| Baseline | 6037 | 34.47 | 1760.1 | 0.428 | 1630.1 | 360.8 | 13.5 |
| GAE-0.95 | 6011 | 33.25 | 1824.7 | 0.460 | 1584.5 | 344.4 | 12.3 |
| GAE-0.95 | 6023 | 34.35 | 1766.0 | 0.451 | 1641.0 | 350.6 | 12.5 |
| GAE-0.95 | 6037 | 34.56 | 1755.3 | 0.451 | 1632.1 | 361.7 | 12.4 |
| CHAIN-lite | 6011 | 36.88 | 1645.1 | 0.396 | 1577.1 | 564.9 | 13.0 |
| CHAIN-lite | 6023 | 37.21 | 1630.5 | 0.398 | 1591.5 | 565.7 | 13.4 |
| CHAIN-lite | 6037 | 37.98 | 1597.4 | 0.388 | 1614.0 | 586.9 | 13.3 |

Intel whole campaign: 5.418 hours, including nine training runs, original evaluation/diagnostics and reporting. The M1 approximately-three-hour figure is user-reported, not recovered from a nine-run timing log. The descriptive ratio is 1.81× elapsed time; this is not a hardware speed ratio.

Actual Intel simulation environment: `{'coreRevision': '973bafe42f66e3414878afb3284e1f54216cbe4d', 'observationVersion': 'public-v1', 'node': 'v26.10.0', 'cpu': 'Intel(R) Core(TM) i9-8950HK CPU @ 2.90GHz', 'cpuCount': 12, 'memoryBytes': 34359738368}`. Both Torch threads=2 and one interop thread were fixed; GameCore uses its single Node process.

## One actual historical M1 timing record

The supplied original checkpoint contains this cumulative timing state: `{'env_steps': 3640000, 'updates': 881, 'completed_games': 14074, 'attempted_games': 14128, 'training_wall_seconds': 1143.979512417, 'validation_seconds': 15.42535262600005, 'optimization_seconds': 188.26149188100143, 'inference_seconds': 230.20935918100164, 'optimizer_steps': 30103}`. This is a single older Exp2 Baseline seed4023 endpoint, not the current M1 five-treatment campaign. Its configuration/dependencies/instrumentation differ from Intel, so even this baseline comparison cannot isolate hardware alone.

## Evaluation throughput

- original_Intel_evaluation: 6144 games / 432.84 collection seconds = 14.19 games/s.
- random: 4608 games / 349.24 collection seconds = 13.19 games/s; 3144.4 transitions/s.
- m1_exp2_baseline_4023: 4608 games / 463.32 collection seconds = 9.95 games/s; 2437.2 transitions/s.

These exclude checkpoint/process startup where labeled collection time; training throughput includes the separately specified validation convention. Different learned policies change game lengths and Core work, so games/s alone is not a fair hardware comparison.

To finish a matched baseline timing comparison, import original M1 campaign config.json, run-status.json, per-baseline summary.json/metrics.jsonl/manifest.json, dependency freeze, source fingerprints, CPU/thread settings and instrumentation schedule. Keep seeds/config differences explicit. No reserved tactical data is needed.
