# AI-7 results on the shared Git branch

Run the tools from `experiment/selfplay-zero`. They sync and publish experiment
records in a separate `experiment/shared-evaluation` worktree.

## Existing infrastructure audit

| Function | Inspected implementation | Classification | Decision |
| --- | --- | --- | --- |
| Shared branch | Published `origin/experiment/shared-evaluation` was inspected at `49a6738142cb31cfc86cd5d6759c9942ca21bad0`. The local branch at `547fb45` adds a CLI and archived Intel records. M1's published restart branch at `346cc1f` has the 4B 21M aggregate and per-seed evidence. | KEEP | Append new result paths to the existing published branch. Local ahead commits and historical docs remain separate from the first results publication. |
| Training and checkpoint provenance | `scripts/ai7/train.py`, `runtime.py`, Campaign4A sources and M1's historical restart trainer. Existing run manifests include the resolved config, code fingerprints, Core, runtime and training state. | KEEP | Read the actual producer artifacts. Record machine, source, config and checkpoint identity per run. Same seed or nominal baseline label does not establish equivalent training. |
| Protocol and game outcomes | `scripts/ai7/evaluate.py`, `evaluate_shared.py`, `shared_protocol.py`, 20M's frozen overlay and 21M's byte-pinned manifest. | KEEP | Retain verified kernels. The MVP consumes normal-start Campaign4-style per-matchup JSON or wrapped game JSONL. Frozen older manifests remain readable through their original tooling. |
| Structural/inference compatibility | `scripts/ai7_shared.py` dispatches the unchanged portable runner. `scripts/ai7_export_cli.py verify` uses fixed public, masked inference and RNG fixtures. P0 and 21M have source and conformance evidence. | KEEP | Publish proof with the run. Validate registered structural identity and evaluator sources, and compare the recorded runtime against fields present in the proof. Execute vectors with the intended runtime when qualifying it. |
| Per-game interchange | 20M bundle uses per-matchup JSON and normalized per-game JSON. Intel 21M has per-matchup JSON, wrapped JSONL, and presentation CSV. M1's tracked 4B evidence is aggregate/per-seed, with raw game files outside this checkout. | CONSOLIDATE | Reuse the per-matchup records containing raw games, convert once to compressed JSONL, and derive tables from those rows. Keep source records at origin. |
| SHA and bundles | `scripts/ai7_export.py` builds the Intel portable runtime archive, `scripts/ai7_export_cli.py pack-results` packs outcomes, `scripts/ai7_shared.py` verifies the pinned package, and `scripts/ai7_p0/import_bundle.py` safely extracts M1's historical audit bundle. | CONSOLIDATE | Git replaces repeated transfer of completed result archives. Each published manifest carries file hashes. Runtime/model transfer and older archive verification retain their existing purpose. |
| Analysis | `result_metrics` in `evaluate_shared.py`, `paired_difference` in `evaluate.py`, frozen 20M `compare`, 4A `joint21.py` and tracked M1 archive analysis scripts. | CONSOLIDATE | New study analysis calls the existing scoring and paired-deck functions, then groups by declared cohort/pair. Retain historical factorial calculations and reports with their original evidence. |
| Deck use | `audit_seeds`, held-out manifests, inventory audits and linked 21M freeze/exposure evidence. | CONSOLIDATE | Add append-only dataset events indexed by exact deck-set identity. Continue two-machine reservation/overlap audits against unpublished files. |
| Storage and layout | The examined checkout has one development worktree, ignored `benchmark-results/`, and no Git LFS rules for research models. `.gitattributes` preserves archived M1 CSV bytes. | KEEP | New workflow uses a separate detached worktree. Large artifacts stay in their current locations. |

## Decision

Develop independently. Use `experiment/shared-evaluation` as the single results branch, following its actual published history. Inside it, individual run records are authoritative. Study reports are generated outside the results checkout. There is no database or scheduler.

```text
results/
  <study_id>/
    study.json
    protocol.json
    <treatment>/<run_id>/
      manifest.json
      conformance.json
      games.jsonl.gz
  dataset-usage/<dataset_id>/<event_id>.json
```

Freeze the study's shared metadata before either machine publishes its first run. Declare **both** cohorts up front if importing historical 4A and 4B into one 21M collection. Their controls remain A0 and B0, respectively. The run directory stays immutable after publication. A resumed partial publication gets a new run and evaluation ID when submitted as complete. Analyzing a planned pair with multiple complete candidates flags ambiguity and refuses that contrast.

Checkpoint models, replay bundles, raw training logs, caches and tensors stay outside Git. Model references carry the SHA and a producer locator. When actual inference needs a remote checkpoint, use the existing hash-verified transfer bundle or a mutually agreed file location. A Git result is readable without it. JSON files have a 1 MiB cap. Compressed per-run games have a 4 MiB cap and a 32 MiB decoded cap. The managed tree only accepts the explicitly named formats, rejects symlinks and blocks unexpected files within run folders.

A publish always validates and stages the complete payload in an ignored local outbox first. With explicit `--push`, it fetches the published ref, validates its managed tree in a detached worktree, and creates an additive commit using a temporary Git index. The development branch and its index remain untouched. If the remote tip moved, it validates the new tip, checks the same run/evaluation IDs and retries at most three times. Same content is a no-op. Conflicting content fails. A network failure after the server accepted the push is safe to retry using the staged bytes. A failed attempt keeps those bytes. The publisher uses ordinary fast-forward pushes. A sync refuses a rewind or edits/deletions under previously synced `results/`. It returns newly discovered run IDs and local checkpoint availability if roots were supplied.

An interrupted fetch can be retried. The detached worktree is disposable, so if interruption during checkout leaves a dirty or locked checkout, inspect it and pick a fresh unused `--worktree` path. The command refuses to overwrite local changes or remove lock files. The verified outbox and existing Git history remain available.

## Minimal data contract

- **Study.** `schema_version: 1`, `study_id`, `protocol_id`, `protocol_version`, `protocol_sha256`, `frozen_at`, `dataset_id`, `dataset_role` (historical or confirmation), structural identity, approved evaluator source map, and `cohorts`. Each cohort declares `baseline`, `treatments`, `endpoint_transitions` and `pairs` keyed by pair ID with `training_seed` and `machine_id`. Training seeds are unique within a cohort.
- **Run.** Stable globally unique `run_id`; `study_id`, `cohort_id`, `treatment`, `pair_id` or null, seed, training machine, source commit and resolved config SHA, training runtime and status. Include relevant producer working-tree/source hashes in provenance for dirty research runs. `checkpoint` carries architecture, endpoint, exact transitions, SHA, locator and optional basename. The publisher fills or checks protocol and dataset fingerprints, artifact hashes and game counts. With `--training-manifest`, it derives the config fingerprint, seed, source commit and any recorded source hashes. With `--checkpoint`, it hashes local checkpoint bytes without loading them. Producer input fields are demonstrated in `scripts/ai7_results/test_workflow.py`.
- **Evaluation.** Stable globally unique `evaluation_id`, evaluated checkpoint SHA, protocol and dataset identities, evaluator source hashes and structural identity, evaluation timestamp, machine, runtime (Python/Torch/NumPy/Node/device) and status. Protocol bytes are the authority for deck IDs, seats, score, opponent identity and sampling. Structural fields are Core revision, public observation version, action/mask SHA, terminal rule SHA and sampling SHA. The latter is SHA-256 of the compact sorted-key JSON sampling object plus LF. The proof must record a passing check for the same protocol. Existing Campaign4A preflight and similarly scoped proof records can be supplied as JSON. Runtime claims are compared when fields are present in the proof. Source equality is the MVP's supported path for evaluation, while training commits and runtime versions may differ. An alternate evaluator implementation requires an explicit compatibility review.
- **Games.** One JSONL row per `(opponent, deck_seed, seat)` in a run, with wrapper `opponent`, `opponent_identity_sha256` and the existing game record under `game`. Use the raw result (type, winner where relevant, reason) and focal seat to derive score. Rows include actual game seed, seat, action seed, opponent, zero prefix plies, length and learner return. Results cannot include private replay state or training tensors. The known 21M Historical4023 name is normalized to the frozen manifest opponent ID only after the exact checkpoint digest agrees.
- **Dataset usage.** `dataset_id` is `decks-` plus SHA-256 of the sorted integer deck array in compact JSON with LF, independent of filename or deck ordering. Events carry `dataset_id`, `event_id`, `state`, `at`, `machine_id` and evidence. Events support proposed, reserved, generated, executed, inspected, selected, tuned and retired. Publication writes an execution event when games exist and seeds the registry with the known historical 20M/21M exposure records in `known-dataset-usage.json`. Record inspection, model selection and tuning as separate evidence-backed events with `--dataset-events`. A new confirmation study cannot publish against registered used decks or overlap with known used/historical studies. Original scope and freeze still require a two-host audit, because a results registry cannot see unpublished exposure or semantically equivalent states.

The validator distinguishes data integrity, import shape, a matching protocol and a match to the cohort plan. Complete runs must satisfy the entire frozen opponent/deck/seat grid and final endpoint. Valid partial and unpaired data can be inspected separately. Historical analysis uses the declared study's baseline and reports available pairs and absence or ambiguity, conditional paired-deck bootstrap, and separate training-seed uncertainty. The seed-level 95% interval is t-based for 2–5 independent pairs, and a separate descriptive seed bootstrap is available for larger samples. Only complete, unambiguous matched results enter comparisons. One trained seed has no seed interval. Conformance records are producer evidence bound to the protocol, not a remote re-execution or proof of identical floating point trajectories.

## Commands

Run from a development checkout with the new scripts available. Publishing and syncing use Python 3.9+ and Git with linked worktree support. Analysis uses the existing evaluator's Python environment for its paired-deck kernel.

On the producer, obtain the per-run manifest inputs from the training/evaluation records. The fixture builds such a manifest directly from Intel Campaign4A provenance and reads the already-recorded per-opponent JSONs. Pass one `--report` per opponent to use that format. For a producer already emitting normalized wrappers, supply `--games games.jsonl` instead. No separate checksum, archive or user-side game-table conversion is needed.

```sh
python3 -B -m scripts.ai7_results publish-run \
  --study study.json --protocol shared-evaluation-manifest.json \
  --manifest run-identity.json --conformance preflight-validation.json \
  --training-manifest training/manifest.json --checkpoint training/final.pt \
  --report final-vs-random.json --report final-vs-historical.json \
  --report final-vs-intel-gae.json
```

The first command stages offline and prints its outbox path. For an authorized publication, use the same invocation with `--push` or retry the stored bytes.

```sh
python3 -B -m scripts.ai7_results publish-run --staged "$STAGED_RUN" --push
```

On either machine, sync and generate a report. Use a new report path each time.

```sh
python3 -B -m scripts.ai7_results sync-results
"$AI7_PYTHON" -B -m scripts.ai7_results analyze-study \
  --study-id campaign4-21m \
  --output benchmark-results/ai7-selfplay/reports/campaign4-21m
```

Optional global flags `--repo`, `--worktree`, `--remote` and `--branch` precede the subcommand. Both sides should use the same published branch. The default worktree is a hidden sibling of the development checkout. Add `sync-results --checkpoint-root /path/to/local/model-directory` to check a basename and SHA against the provided root. A missing match is scoped to those roots.

## Cleanup disposition

| Path / responsibility | Current users and history | Disposition and risk |
| --- | --- | --- |
| `scripts/ai7_export_cli.py pack-results` and `compare` | `scripts/ai7_shared.py`, original M1 instructions, archived portable runners, and `ai7_export.py` smoke checks. | Superseded for new Git result exchange only. Retained for old artifact replay and offline delivery. Removing these functions would break frozen documentation and test runners. |
| `scripts/ai7_export.py` and `scripts/ai7_shared.py verify_bundle` | Produces and checks the exact reference runtime/model bundle. | Keep. A result publication contains no executable runtime overlay or model weights. |
| `scripts/ai7_p0/import_bundle.py` | Documented Intel import of earlier M1 tactical and opponent evidence. Archive validation tests exercise its path restrictions. | Keep. Its original input and output schemas differ materially from completed run publication. |
| Campaign-specific report generators and archived M1 path wrappers | Original comparisons, factorial science and historical provenance. | Preserve. New comparison presentation shares the metric kernels. Removing a generator would prevent regenerating that report from its original dataset. |
| Intel/M1 multiple legacy summary formats | Existing 20M/21M artifacts and their reproducibility instructions. | Consolidate only at the new ingestion boundary. Additional adapters require actual representative raw records. |

No source deletions were warranted. Frozen source and result files retain their previously verified hashes. Local acceptance tests cover the new replacement path for supported ingestion, and historical callers keep their existing entrypoints.

## Acceptance and rollout boundary

The local tests use a temporary bare Git remote and two independent clones. They simulate concurrent fast-forward races, repeated content, lost responses, failed fetch/push, conflicts, invalid files, partial runs and missing checkpoints. The real Intel 21M read-only case ingests all 12 results, reconstructs 18,432 games, and checks the A1−A0 and A2−A0 scores and conditional intervals against their archived output. Testing does not run a model, optimizer or evaluation. M1 4B's raw game records were unavailable on Intel. Its producer needs one pass through this workflow to validate the actual raw field layout and runtime conformance. M1's tracked summaries are historical evidence and do not stand in for individual game records.

The shared branch carries the three historical Intel Campaign4A A0 finals as E0 reference results. The Direction A engineering pilot was gated and produced no run. Add the M1 cohort records under the same frozen study after validating their raw results. The tests only commit and push generated fixtures inside their temporary local repos.

The platform changes are confined to five files under `scripts/ai7_results/` and this document plus `known-dataset-usage.json`. `__main__.py` defines the workflows, `records.py` is the one publication validator, `git_store.py` implements Git transport, and `analysis.py` groups the reused metrics. The test module contains the synthetic examples and the optional existing Intel 21M replay through the data workflow.

Reproduce the checks from the development checkout:

```sh
"$AI7_PYTHON" -B -m unittest scripts.ai7_results.test_workflow \
  scripts.ai7.tests.test_shared_entrypoint scripts.ai7.tests.test_shared_protocol \
  scripts.ai7_p0.tests.test_metrics -v
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test --maxWorkers=1 --testTimeout=30000
pnpm build
git diff --check
```

Cross-machine rollout accepts the MVP once both development checkouts have the same result reader, M1's actual 4B raw format passes validation, and one authorized real publication and fetch succeeds. Downstream analysis should keep the two cohorts separate. Existing Intel 21M and P0 files were rechecked against 59 and 148 archived hashes respectively, along with the 159 registered Campaign4A source files.
