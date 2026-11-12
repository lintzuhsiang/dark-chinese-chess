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

Freeze verified 6B before evaluating these separately:

- Conversion proximity: small material-advantage-weighted proximity to revealed
  enemies, using Manhattan distance. It is an approach/retreat preference, not a
  capture-rank or forced-win assertion; equal material gives no preference.
- Blocker accessibility: difference in distinct empty squares reachable through
  public empty cells from each side. Hidden and occupied squares block paths.
  This measures multi-step access; ordinary mobility counts immediate moves.
- Cannon setup: unique revealed victims a Cannon could newly threaten after one
  ordinary quiet Cannon move, excluding victims it already attacks. Use Core
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
   chosen only from the ablation evidence. If no candidate merits retention,
   report that outcome instead of manufacturing an improvement.

These are deliberately small local experiments, not broad strength estimates.
Report W/D/L, paired confidence interval, completed/attempted denominators,
errors/illegal actions/truncations, exact replays, decision p50/p95/p99, completed
depths/projections, capture/FLIP progress, quiet-limit draws and hidden survivors,
and wins among games where the agent held at least a Soldier's material lead.
Use a concrete local decision to explain any claimed progress improvement.

## Results

Pending implementation and verification. Historical AI-6A results use the old
Core and are not evidence about this v4 environment.
