# AI-6B / AI-6C implementation and evaluation

Owner authorization: 2026-11-12. Commit the completed AI-6A/Chase v4 work,
then implement AI-6B followed by AI-6C. Pin new evaluations to v4; retain old
Core revisions, transcripts and benchmark results unchanged. No push/deployment.

## Fixed baseline and scope

Baseline: `973bafe42f66e3414878afb3284e1f54216cbe4d`, Chase v4. AI-6A retains
six plies, 8,192 projections, widths 8/4, exact positive FLIP outcomes, the
original root EV/fallback and terminal scores +2/-2/0. The ordinary EV and browser
default do not change. Keep one full-prefix reconstruction per decision, parent
contexts for children and no cross-turn delta or private information.

Use the existing bounded leaf hook for optional features. Supply its already
computed base evaluation to avoid duplicate evaluation. This does not change
AI-6A's scores, ordering, fallback or budget. Feature policies are separate opt-in
agents; do not claim selective search proves a win against omitted actions.

## AI-6B: progress awareness

Derive quiet suffix and remaining plies from accepted public history. Discount
only the material component linearly during quiet plies 40–60: the pressure is
`clamp((quiet - 40) / 20, 0, 1)`. Leading sides therefore value preserving static
material less as an automatic draw approaches; losing sides value reaching the
draw. Threat/safety remains in the base score. FLIPs/captures reset the quiet
suffix through their ordinary public events; there is no unconditional FLIP
bonus or invented terminal result. Terminal scores always come from Core.

Report public-position returns as diagnostics, not as an extra rule or score.
Verify quiet58→59→60, both perspectives, dangerous FLIPs, terminal wins/draws,
public-information invariance, deterministic decisions and feature-off parity.

## AI-6C: independent strategic candidates

Verified 6B is frozen at `8189576`. Evaluate these separately:

- Conversion proximity: small material-advantage-weighted proximity to revealed
  enemies, using Manhattan distance. It is an approach/retreat preference, not a
  capture-rank or forced-win assertion; equal material gives no preference.
- Blocker accessibility: difference in distinct empty squares reachable through
  public empty cells from each side. Hidden and occupied squares block paths.
  This measures multi-step access; ordinary mobility counts immediate moves.
- Cannon setup: unique revealed victims a Cannon could newly threaten after one
  ordinary quiet Cannon move, excluding victims the side already attacks. Use Core
  ordinary move/capture queries; never infer hidden identities or duplicate
  screen/rank legality. Count a victim once per side, not once per route.

Normalize each candidate to [-1,1], weight it by 0.03 and clamp the final active
leaf score to [-1,1]. Keep separate on/off controls. Audit overlap with existing
material, threat and mobility; retain experimental status unless evidence supports
promotion. No new general feature framework, rule API, evaluator tuning sweep,
search engine or dependency is needed.

## Predeclared evaluation

All new outputs use `benchmark-results/ai6bc-v4/`; refuse to overwrite reports.
Reuse the existing paired tournament, source manifests and exact replay verifier.
The agent root is 20261112 and the administrative cap is 512 accepted plies.
Keep failures and truncations visible, with no invented draw scores.

1. 6B runtime pilot: seed 62000 (one pair), feature on vs frozen 6A.
2. 6B held-out: seeds 62100–62103 (four pairs), same comparison/configuration.
3. After freezing 6B, independent 6C ablations: seeds 62200–62201 (two pairs per
   candidate), each candidate on vs verified 6B, with other 6C features off.
4. Reserve seeds 62300–62303 (four fresh pairs) for a final candidate/composite
   chosen only from the ablation evidence. Retain a candidate for this fresh
   check only if its ablation mean exceeds0.5, with no errors/truncations and
   candidate p95 no more than1.5× control p95. Choose one best qualifying feature
   rather than tuning a composite after observing the data. If no candidate merits retention,
   report that outcome instead of manufacturing an improvement.

These are deliberately small local experiments, not broad strength estimates.
Report W/D/L, paired confidence interval, completed/attempted denominators,
errors/illegal actions/truncations, exact replays, decision p50/p95/p99, completed
depths/projections, capture/FLIP progress, quiet-limit draws and hidden survivors,
and wins among games where the agent held at least a Soldier's material lead.
Use a concrete local decision to explain any claimed progress improvement.

## Results

The repinned v4 baseline passes all 784 existing tests. The previous 32
pin-dependent failures and unhandled rejection no longer occur.

6B pilot: two completed/exactly replayed games, 1/0/1 W/D/L, 130 decisions,
zero illegal actions/errors/truncations and stable source hashes. No decision
reached quiet40, so this pilot establishes runtime/reliability only; it contains
no evidence of progress-feature strength. Candidate/control decision p95 was
336.79/342.36 ms on this local machine.

Concrete progress example: from an accepted quiet48 prefix with Red Advisor0,
Red Soldier4, Black Horse31 and one public-inventory-known Black Soldier hidden
at16, frozen 6A selects Soldier4→8 (seed3). 6B flips16. Both complete depth6.
6A values the quiet action 0.0302419355 vs FLIP 0.0292338710; 6B discounts the
late quiet leaf to 0.0105846774 and retains the FLIP value 0.0292338710. The FLIP
resets the draw counter, keeps the material lead of3 and offers no immediate
opponent capture. This demonstrates safe progress while ahead, not a forced win.

6B held-out: all8 games complete and replay exactly, W/D/L1/6/1, paired mean0.5
and95% interval[0,1], no errors/illegal actions/truncations, source stable. The
candidate/control made111/111 FLIPs,88/88 captures,632/633 quiet moves and2/2
late FLIPs. Both converted1 of6 games in which they held a material lead; six
quiet-limit draws retained0,0,12,12,5,5 hidden pieces. Candidate/control p50/p95/p99
was199.35/291.55/352.21 vs196.43/291.83/363.26 ms. This cohort shows no aggregate
strength or conversion gain. Keep6B experimental/opt-in for the verified local
progress behavior; do not promote it over6A or EV by default.

The dangerous-reveal control at quiet48 places a hidden Black Chariot at8.6B
moves Red Soldier4→5 before revealing, avoiding the immediate4-square exposure.
6C follows after the verified6B source/configuration is frozen. Historical AI-6A
results use the old Core and are not evidence about this v4 environment.

Verification after6C implementation: lint, formatting, typecheck, build and all
806 tests pass. All four experimental CLI policies produce legal public proposals
through the real runner (one-ply smoke limits intentionally return TRUNCATED).
No Core file or game rule changed after the v4 pin.

## Independent6C ablation results

All12 games completed with exact replays, stable source manifests and zero
illegal actions/errors/truncations. Each row compares one feature against frozen
6B on the same two seed pairs; all95% paired intervals are[0,1].

| Candidate             | W/D/L | Mean score | Candidate/control p95(ms) | Decision                                               |
| --------------------- | ----- | ---------- | ------------------------- | ------------------------------------------------------ |
| Proximity             | 2/0/2 | 0.50       | 401.20/349.93             | No score gain; not selected                            |
| Blocker accessibility | 3/0/1 | 0.75       | 337.27/298.74             | Only qualifying candidate; fresh final cohort reserved |
| Cannon setup          | 1/2/1 | 0.50       | 817.19/401.82             | No score gain and2.03× latency; not selected           |

Lead conversion (candidate/control) was2/3 vs2/3 for proximity,3/3 vs1/2
for blockers, and1/3 vs1/3 for Cannon. Candidate/control capture counts were
56/56,60/49 and52/55; FLIPs were62/66,62/66 and67/61 respectively. Cannon's
two quiet-limit draws had no hidden survivors. Full reports include p50/p99,
completed-depth distributions, projections, returns and retained transcripts.

Weights/configurations were not changed after seeing these results. Keep
proximity and Cannon available only as independent experiments; they do not
qualify for promotion. The blocker result is a selection signal from four games,
not a general strength conclusion. Its final test uses untouched seeds62300–62303.

Feature ownership/overlap: proximity is a small material-dependent approach
interaction; blockers count distinct multi-step empty access instead of immediate
move count; Cannon counts only new potential victims not already in the ordinary
threat feature. None add a capture reward or change material conservation. Leaf
features cannot rescue omitted actions, and incomplete iterations still fall back
to the original EV; these limitations remain visible in coverage reports.

## Fresh final cohort and retention decision

Blocker-only6C vs frozen6B on the four untouched seed pairs completed8/8 games
and8 exact replays, with W/D/L3/2/3, mean0.5, paired95% interval[0,1], stable
sources and zero errors/illegal actions/truncations. Lead conversion was3/5
for both sides; captures93/93, FLIPs103/117, late FLIPs1/0 and quiet moves529/515.
The two quiet-limit draws each retained18 hidden pieces. Candidate/control
p50/p95/p99 was233.54/344.92/392.72 vs194.81/314.82/353.89 ms.

The ablation gain did not reproduce. None of the three6C candidates is promoted
into the default policy or combined evaluator.6B remains an optional local
progress experiment; ordinary EV and frozen6A retain their existing behavior.
The independent6C switches/CLI strategies remain available for explicit research
reproduction, with their negative evidence documented. No further tuning or
optimization is included in this task.30 evaluation games across all phases
completed and replayed exactly; no historical benchmark was overwritten.

The features use leaf scores only: they do not change root EV ordering, candidate
widths, incomplete-iteration fallback or the selective tree's omitted replies.
These small cohorts do not establish general strength. Latency is local Node
measurement, not physical-phone evidence for the experimental policies.

## Reproduction and raw report checksums

All reports are in `benchmark-results/ai6bc-v4/`. Each includes complete
transcripts, the v4 Core pin, exact feature configuration, seeds, environment and
source archive. The preexisting AI-6A reports and old Core revisions remain intact.

| Raw report               | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `6b-pilot.json`          | `12c5f73bcf67479b8597e05034cd4b62f458094daa388a2f6b7e3858511e844d` |
| `6b-heldout.json`        | `4109bd3aa1f6a93ecef865b8639e1f71ed52b888048630460c7355ac8fd7680c` |
| `6c-proximity.json`      | `664303c005341069ab086e841dface26aa6f9ae7cba8a0e0f158b59faa85a615` |
| `6c-blockers.json`       | `1bef1e27cae1bd2480137f03d6e626e6ad6c00014c155a617e75e0019d24dd8f` |
| `6c-cannon.json`         | `d5db4675ba73fb0977ff697462603355075fa35a24e6608657c06ee1ef56e554` |
| `6c-final-blockers.json` | `86fe2339fad6b69a3aa6ea78113029d2aa6b9bfaea00ed4f783b21421c23fb5c` |

## Final verification

All806 tests pass, along with lint, format checking, workspace typecheck, build
and release-artifact validation. The affected real Tactical Worker check passes
in both Chromium and WebKit (two tests, opening/middlegame/endgame with live
animation frames). Experimental6B/6C latency evidence above is from the Node
runner; these policies are CLI/library opt-ins and are not exposed as browser
strategies. Browser defaults, Core rules, search limits and context architecture
remain unchanged. No push, deployment, new dependency or cross-turn delta.
