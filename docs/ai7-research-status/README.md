# M1 research status — 2026-11-20

Branch: `experiment/m1-gae-restart-strategies-20261115`.

Campaign4B completed B0/B1/B2 × seeds 7011, 7023, 7037, each at 3,640,000 transitions (nine runs). B0 uses normal starts; B1 uses uniform archive restarts with probability .30; B2 uses endgame archive restarts with probability .30. B3 was not run because valid public-state replicated targets were unavailable.

Campaign5 completed twelve additional runs (lambda .90/.85 and endgame restart .50/.70, three seeds each). Its evaluations used the already explored 20M decks and remain exploratory.

The preregistered 21M B1−B0 confirmation completed all 9,216 normal-start games across six final models and three opponents. The primary score effect against Intel GAE095 seed6011 is +2.96 percentage points, seed-level 95% t interval [−1.77,+7.69]pp. Superiority was not established; equivalence was not established. See the [verified final report](21m-b1-confirmation/confirmatory-final-report.md), paired analysis and completion verification in the same directory.

21M is now evaluated and exposed for this M1 cohort. No 22M calibration or reserved tactical evaluation was run by this task. Intel freshness statements remain limited to its supplied audit scope and date.

The two restart design/integration documents describe historical preparation and launch stages; this status supersedes their progress statements. Original manifests, source snapshots, checkpoints, audits and per-game records remain under the gitignored `benchmark-results/ai7-selfplay/` directories. This Git snapshot includes source, tests and compact final analysis, not the full artifact archive. Hashes in completion verification refer to those original local artifacts.
