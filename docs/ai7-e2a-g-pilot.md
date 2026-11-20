# E2a-G engineering pilot handoff

The completed M1 engineering pilot used seed 91001 and stopped at 100,000 environment transitions. The original run manifest records parent revision `346cc1f` and source SHA-256 values for the then-uncommitted implementation. Commit `10275a68cfffd3f943acda028a4d0ca4ffbb0a10` preserves those exact source bytes. Use that commit for a frozen-runtime reproduction, and use `experiment/selfplay-zero` for future experiment integration. The pilot record lives in `engineering-pilots/e2a-g-m1-seed-91001-100k` on `experiment/shared-evaluation`.

## Verify the M1 pilot on a second device

Obtain the verification ZIP from the producer through the team's artifact transfer channel, then compare its SHA-256 to `pilot.json` in the shared record. The verifier reads the original checkpoint as bytes for its SHA check and loads typed NumPy arrays exported from the original final state dict for inference. This avoids coupling inference validation to the producer's optimizer pickle or NumPy version.

Use a Python environment with Torch and NumPy. Run the following from the common code checkout, with the shared record already fetched. The bundle contains everything needed for the fixed-vector checks, so the second machine does not need a local Stage2 bank.

```sh
git fetch origin experiment/selfplay-zero experiment/shared-evaluation
git worktree add --detach /path/to/e2a-frozen-source 10275a68cfffd3f943acda028a4d0ca4ffbb0a10
python -B scripts/ai7/engineering_pilot.py verify \
  --source-worktree /path/to/e2a-frozen-source \
  --bundle /path/to/e2a-g-intel-fixtures-v1.zip \
  --bundle-sha256 "$(git show origin/experiment/shared-evaluation:engineering-pilots/e2a-g-m1-seed-91001-100k/pilot.json | python -c 'import json,sys; print(json.load(sys.stdin)["bundle_sha256"])')" \
  --machine-id intel --output intel-verification.json
```

The verifier checks the pinned source, bundle members, public encoding, legal masks, values and masked probabilities for both scoring paths. Append the resulting JSON under `engineering-pilots/e2a-g-m1-seed-91001-100k/peer-verifications/` on the shared branch with a unique filename and a regular fast-forward push. The M1 verification is a producer-side check. Intel completion requires an actual Intel verification JSON. This engineering pilot uses a separate record format from the per-game campaign ingestion and is discoverable through Git.

## Reproduction settings

The command below documents the original run from the frozen source. The first invocation stopped at update two. The second kept the same arguments and replaced `--stop-after-updates 2` with `--resume "$RUN/latest.pt"`. The reproduced training run would require separate authorization and a fresh output directory.

```sh
RUN="$PWD/benchmark-results/ai7-selfplay/e2a-g-reproduction"
AI7_ARTIFACT_ROOT="$RUN" python -B -m scripts.ai7.train \
  --output "$RUN" --architecture e2a_g --seed 91001 \
  --learning-method gae_lambda_095 --until-step-target --max-env-steps 100000 \
  --checkpoint-every-steps 25000 --batch-games 16 --threads 2 --device cpu \
  --validation-pairs 0 --max-replays 0 --stop-after-updates 2
```
