# AI-7 independent tactical and rotation evaluation

Evaluation only, on `experiment/selfplay-zero`; no training, checkpoint selection,
reward or Core changes. Results are under
`benchmark-results/ai7-selfplay/symmetry-audit/20261114-v1/`.

## Protocol

Stage 1 selects 20 distinct seeded games: five early positions with hidden pieces,
five immediate wins, and ten immediate-defense choices. Stage 2 selects 200 wins
and 200 defenses. A reserved split contains 100 wins and 100 defenses and receives
no checkpoint evaluation. Seed ranges start at 11M, 12M and 13M respectively,
disjoint from the previous training, validation and final test ranges.

Each game uses Uniform Random legal play and supplies at most one position.
Selection is deterministic: first qualifying position while its category quota
remains open. Tactical candidates have no hidden pieces and at most six pieces.
A canonical key of public board, acting seat and assigned color rejects duplicates
and 180-degree counterparts across all splits, ignoring history for deduplication.
These are independently seeded games, not 400 rotations of a few templates.
This is a selected Random-play endgame distribution, not representative of all
Banqi positions or proof of general strategy.

Immediate win means a legal action produces a Core terminal win for the actor.
Defense cases have no immediate winning action and contain both safe and unsafe
choices. Unsafe means immediate loss or an opponent legal reply yielding a
terminal win. Safe means no such one-move reply (including terminal draws).
Defense does not imply eventual winning, nor do we label longer forced losses.
Fully revealed boards prevent classification from using private-deck knowledge.
Setup, labels and seeds never enter model features or training.

## Transformation gate

Reverse the initial deck spatially while preserving physical piece IDs, then
replay every rotated action through authoritative Core. At every prefix compare
legal action sets, raw public observations, outcomes, counters, complete public
events, and the entire encoded public input, including public references and the
recent history window. Check every legal action and legal reply from each selected
position for legal correspondence, public observation/event and terminal outcome
including winner/reason. This covers reachable branches of sampled positions,
not an exhaustive proof of all rule cases. Rotation never swaps seats or colors.
One-based position/reference values map as `v -> 33-v`, with zero kept absent.

Stage 1 evaluates the three Exp 2 Baseline seeds before proceeding to Stage 2.
Stage 2 evaluates all three treatments and three seeds at initial, 0.91M, 1.82M,
2.73M and final 3.64M: 45 checkpoints. `latest.pt` is excluded as a duplicate
endpoint. Saved-step names and the checkpoint's actual environment steps are
reported; no missing historical weights are reconstructed.

## Metrics

- Immediate Win/Defense Probability: sum of legal probability over the exact
  winning/safe action set, reported separately for each orientation.
- Symmetry Gap: absolute difference of those two target-set probabilities per
  position; average the absolute differences, not the absolute group-mean gap.
  Signed differences are also retained to show direction.
- Policy Equivariance Error: total variation distance
  `0.5 * sum_a |p(a|s)-p(R(a)|R(s))|` over all legal actions, in [0,1].
  This detects differences even when target-set probability is the same.
- Orientation mean and minimum, and Uniform Random target-set probability, are
  reported to separate useful ability from mere agreement (a uniform policy has
  zero equivariance error without necessarily being strong).
- Initial-to-each-checkpoint differences use paired positions and both
  orientations. Each fixed model has 4,000 position-bootstrap replicates with
  95% percentile intervals. Rotations are paired, never independent samples.
  Training seeds remain separate; these intervals do not measure variability over
  independently trained agents. No multiplicity correction; exploratory results.

The reserve is generated and rule-validated but is not loaded by the checkpoint
analysis tool. It is reserved for a single later confirmation protocol, not
repeated tuning. Its schema and sampling procedure match the main bank, but its
seeded games and canonical positions are disjoint. Generation writes to a new
file only, with SHA-256; evaluation refuses existing result files.

## Reproduction

```sh
node --import ./scripts/ai-eval/register.mjs scripts/ai7/symmetry.ts OUTPUT stage1
node --import ./scripts/ai-eval/register.mjs scripts/ai7/symmetry.ts OUTPUT stage1 --verify
.venv/bin/python -m scripts.ai7.analysis.symmetry --output OUTPUT --phase stage1
# Continue only after the transformation gate passes.
node --import ./scripts/ai-eval/register.mjs scripts/ai7/symmetry.ts OUTPUT stage2
.venv/bin/python -m scripts.ai7.analysis.symmetry --output OUTPUT --phase stage2
node --import ./scripts/ai-eval/register.mjs scripts/ai7/symmetry.ts OUTPUT reserved
```

`OUTPUT` must be a fresh folder under `benchmark-results/ai7-selfplay/`. Bank
generation is capped at 12,000 attempted games / 15 minutes per split, and 50 MB
per bank. Checkpoints are loaded one at a time with CPU2 threads and no gradients.
This task creates small evaluation artifacts independently of older accumulated
campaign budgets; existing experiment artifacts remain untouched.
