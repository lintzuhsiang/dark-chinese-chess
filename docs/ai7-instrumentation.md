# AI-7 phase-one instrumentation

Passive diagnostics are opt-in with `--instrumentation off|basic|detailed`.
Off is the backward-compatible default. Basic records per-update probe and
advantage diagnostics; detailed also samples gradients on updates1–10, then every
`--gradient-sample-every-updates` updates, the first minibatch of each PPO epoch.
No learning hyperparameters, rewards, rules or action selection are changed.

Diagnostics use `autograd.grad(..., retain_graph=True)` without populating `.grad`.
The original `loss.backward`, clipping and Adam path remains authoritative.
Policy, coefficient-weighted value, and coefficient-weighted entropy gradients are
reported separately. Cosine applies only to genuinely shared baseline body
parameters; absent or zero-norm comparisons are null. Win/draw/loss policy-gradient
components use the full minibatch denominator and original global advantage
normalization. Their sum is numerically checked against the total Actor gradient.
No gradient tensors are retained on disk.

Eight existing Core-derived evaluation probes are used only for observation.
Their fixed public inputs/masks are fingerprinted; initial probabilities are saved
in exact-resume state. KL(before||after) is calculated over legal probability
support; single-action masks are safe. Probability underflow is floored at float64
tiny for finite numerical diagnostics, and tiny negative round-off KL is clamped.
These KLs describe the probes only, not the rollout distribution. Probes cannot
trigger early stopping, selection, policy actions or rewards.

Per-update diagnostics are embedded in metrics.jsonl. Existing checkpoint byte
offsets therefore cover them, and interrupted optimizer passes publish no diagnostic
record. Resume checks probe fingerprints and restores the initial KL reference.
Exact ON/OFF and split/resume tests compare model, optimizer, RNGs, pool and games.
Step bounds, rather than wall-time stops, define equality tests: extra observation
cost can otherwise change when a time-limited run stops.

Run the gated short experiment with:

```sh
.venv/bin/python -m unittest scripts.ai7.tests.test_instrumentation.InstrumentationTests -v
.venv/bin/python -m scripts.ai7.instrumentation_run
```

The runner uses three fresh seeds,500k transitions each, CPU2 threads, sequential
jobs, a30-minute overall wall bound and a1GB artifact target. It retains the
previous overnight historical snapshot interval910k, so these runs stop before
first new historical snapshot. This is diagnostic validation rather than a new
strength benchmark or a test of long-run forgetting.
