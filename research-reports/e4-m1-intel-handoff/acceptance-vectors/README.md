# Intel acceptance supplement

Use with AI7-E4-M1-Intel-handoff-public-v1.tar.gz, SHA-256
9b0ccc1575f5dd19f874701b53af9bb5aae2e595d4b6b8596e7d2ce83c297013.
Verify the original package, apply its patch at f4ccb0d, and overlay
its extracted files following its README. From that worktree root:

```sh
(cd /path/to/acceptance-vectors && shasum -a 256 -c SHA256SUMS)
cmp pnpm-lock.yaml /path/to/acceptance-vectors/pnpm-lock.yaml
python -B /path/to/acceptance-vectors/verify_vectors.py > /tmp/e4-intel-vector-receipt.json
python -B benchmark-results/ai7-selfplay/e4-ray-routing-v1/intel-handoff/verify-branch-replay.py /tmp/e4-intel-branch-receipt.json
```

Twenty public-v1 observations cover both acting seats, positions with MOVE
only, positions with mixed choices, and P2 positions with FLIP only.
They were taken from the already exposed supervised development benchmark.
The verifier compares action order and Boolean masks exactly, and compares
legal policy probabilities and scalar value within absolute tolerance 1e-5.
The M1 receipt covers all 15 requested checkpoints. The Intel receipt is
a separate result.

## S2 sampler and resume

The original ordered label bank is overlay/benchmark-results/ai7-selfplay/e4-ray-routing-v1/tactical-learning-pilot/train-labels.json.
Do not reorder that file. Its producer and verifier are screening-fixtures.ts
and screening-verify-labels.ts under the same E4 directory. Preserve the
original settings, trainer and optimizer fingerprints adjacent to each S2
final. The archived policy payload config identifies the base PPO config.

The S2 sampler uses NumPy SeedSequence([training_seed, pre_update_rollouts,
epoch_index, minibatch_index, 0x52]), then choice(bank_size, 32, replace=False).
Epoch and minibatch indices are zero based. This forms independent
deterministic batches from the same finite bank. Labels are reused across
batches, so there is no exhaustion counter. At a saved rollout boundary,
restore training_state.rollouts and optimizer/RNG/pool state from the parent.
No independent auxiliary iterator or cursor needs to be restored.
The historical trainer stops at 1.7M. Any extension needs its own explicit
run ID, common full parent, treatment and budget binding. A comparison
against B0/B2 3.64M finals alone does not prove the causal effect of S2.

Original B2 standard-path logs and 1.5M parent snapshots for the three
pilot seeds are in the handoff. The archived M1 branch receipt validates
the historical 1.5M fork; Intel needs its own cross-runtime receipt. K0–K4
factory code and metrics are included. No K2 trained weights were saved.
