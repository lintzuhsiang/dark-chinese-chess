# Phase 1 — Instrumentation validation

This is a short diagnostic experiment, not a strength comparison. No reward, PPO hyperparameter, architecture, or rule was changed.

| Seed | State     |  Steps | Updates with diagnostics | Sampled gradient minibatches | Actor/critic opposing-gradient fraction |
| ---- | --------- | -----: | -----------------------: | ---------------------------: | --------------------------------------: |
| 1011 | completed | 500000 |                      117 |                           80 |                                  0.4625 |
| 2027 | completed | 500000 |                      121 |                           84 |                      0.4523809523809524 |
| 3037 | completed | 500000 |                      119 |                           80 |                                   0.575 |

Full update diagnostics (advantage distributions, game/decision outcome proportions, probe before/after probabilities and KL, gradients) are committed inside each metrics.jsonl at the same rollback boundary as existing training records. No historical gradients were reconstructed.

Gradient samples use the first minibatch of each epoch for updates1–10, then every10th update. Critic/entropy gradients include actual objective coefficients; outcome Actor contributions retain the full minibatch denominator and globally normalized advantages. Gradient directions are pre-Adam/pre-clipping diagnostics, not a causal decomposition of Adam parameter changes.

All three fresh MLP runs retain gamma=lambda=1, lr3e-4, epochs4, clip.2, entropy.01, and original opponent probabilities. The overnight historical snapshot cadence910k is retained:500k ends before the first new historical snapshot. Thus this cannot rule out failures appearing only later or with richer historical opponents. Probe inputs, masks and initial probability references are fixed and checkpointed. Probes do not influence rewards, actions, model selection or stopping.

Gate results and precise versions/source hashes are in config.json/source-provenance.json. Small-run timing is not a robust benchmark: compare only matched ON/OFF gates, not different training seeds.

Negative Actor/Critic cosine and a simultaneous probe decrease are associations, not proof that Critic caused forgetting. Detailed minibatches are predetermined samples rather than all updates; missing samples must not be interpreted as no conflict. A short run without a failure does not falsify a long-horizon failure hypothesis.
