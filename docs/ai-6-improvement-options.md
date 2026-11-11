# AI-6 — Improvement options after the playable baseline

**Scope:** Options review requested by the owner after AI-5. No strategy changes,
search, sampling, weight tuning, or learning are implemented by this review.

## Evidence to address

- AI-4 EV versus Heuristic: 63/111/26 W/D/L, score 0.5925, 100 paired observations,
  conservative 95% interval [0.456690, 0.728310]. The interval includes 0.5; a reliable
  advantage over Heuristic has not been established. Random is already too weak to
  distinguish small improvements: EV won 200/200 games on that comparison set.
- Of 111 Heuristic draws, 83 retained hidden pieces and 47 had positive EV material
  difference. Material lead alone does not prove a winning position; conversion and
  progress under the quiet counter need investigation.
- A concrete failure is deck 20005 / leg 0 / ply 177: equal static scores let EV
  choose an immediately capturable last Advisor despite an equally scored safe move.
  The evaluator adds net threat value without examining the opponent's next reply.
- AI-5 verifies Worker isolation and recovery. Its four EV opening timing samples
  across Chromium/WebKit are only a smoke check. Node p95 reached 13.74 ms versus
  Heuristic; deeper computation still needs representative browser/phone measurements.

These observations and artifacts are recorded in the [Phase 2 plan](phase-2-ai-plan.md).
The recommendations below are inferences from these examples, not measured gains.

## Candidate experiments

| Priority | Option                                          | Why try it                                                                                                                                                                                                             | Implementation / runtime cost                                                                                                                                                                                                       | How to evaluate                                                                                                                                                                                                   |
| -------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Terminal-safety tie-break                       | Among equal scores in ACTIVE successors, avoid exposing the last remaining friendly piece to an immediate legal capture when an equally scored alternative avoids it. Directly addresses the recorded ply-177 failure. | Small; public survivor counts and shared Core capture queries already exist. Preserve configured scores and seed ties among equally safe choices.                                                                                   | Add the recorded position as a tactical regression; compare against frozen EV on fresh paired decks. Check that immediate winning actions remain dominant.                                                        |
| 2        | Limited opponent-reply evaluation               | A short reply layer can recognize recaptures and a draw on the opponent's next turn, which one-step V misses. Start with a named, explicitly selective capture/terminal-reply variant before considering all replies.  | Medium to high. Deterministic depth/node caps; full public FLIP chance expansion can grow quickly. Always use Core projection, fixed perspective, and updated public inventory. Selective results must not be labeled full minimax. | Tactical recapture/draw fixtures, fixed-seed reproducibility and budget accounting; paired scores plus browser latency/timeouts. Compare the selective and full-reply variants separately if both are authorized. |
| 3        | Advantage conversion / relative position        | Add a small, explainable measure of access to future captures or closing distance, to distinguish quiet moves with identical immediate material/threat/mobility. Investigate progress near the draw boundary.          | Medium feature work; low to medium runtime. Count hidden blockers through public occupancy. Draw while behind can be useful; avoid an unconditional FLIP/progress bonus.                                                            | Separate ahead/behind endgames and stalled fixtures; report W/D/L and draw changes without treating all draws as failures. One feature at a time, with ablations.                                                 |
| 4        | Board geometry and Cannon structures            | Evaluate latent screen/support structure and blocker effects beyond currently available captures. This preserves the approved geometry research roadmap.                                                               | Medium. Reuse shared rules for actual capture/move validity; do not build another geometry/rank engine.                                                                                                                             | Cannon/hidden-blocker fixtures, symmetry and hidden-permutation tests; ablate against the same held-out pairs. Define feature ownership to avoid duplicating immediate threat or mobility.                        |
| 5        | Calibrate safety/opportunity scales and weights | Examine friendly exposure and enemy opportunity separately, especially when the opponent moves next. The current net difference can hide a severe friendly risk behind an equal-valued attack.                         | Small code changes, meaningful experimental cost. Weight tuning alone cannot separate candidates with identical aggregate feature vectors.                                                                                          | Freeze definitions first, tune only on development seeds, then one held-out evaluation. Retain all configurations/results and keep terminal scores dominant.                                                      |
| Later    | Bounded information-set MCTS                    | Explore longer plans under hidden-piece uncertainty if smaller improvements remain inadequate. It is a research extension, not the next prerequisite for play.                                                         | High: public-consistent sampling, rollout policies, deterministic iteration bounds, provenance, and browser cost. No actual hidden identities/deck seeds may enter search.                                                          | Compare with bounded reply search at recorded compute budgets; retain failures and test leakage/strategy-fusion risks. Requires separate algorithm approval.                                                      |

**Recommended first scope:** option 1, followed by a separate experiment for option 2. This is the most direct path from an observed failure to a reviewable change.
Options 3–5 should remain separate feature/configuration experiments so we can
attribute changes. Keep the current EV selectable as a frozen baseline.

## Research boundaries

After all pieces are revealed, ordinary bounded minimax/alpha-beta is a possible
later search variant. The classic [Knuth–Moore analysis](https://www.sciencedirect.com/science/article/pii/0004370275900193)
studies alpha-beta game-tree search; it does not justify treating unrevealed pieces
as known. With hidden pieces, preserve chance weighting/public constraints rather
than applying perfect-information search to the real board.

[Cowling, Powley and Whitehouse's IS-MCTS paper](https://pure.york.ac.uk/portal/en/publications/information-set-monte-carlo-tree-search/)
studies search over information sets for hidden-information games. It supplies a
research direction, not evidence that it improves this implementation. In this
repository, public chance branching and shallow reply evaluation are simpler first
experiments. Any eventual sampled policy must see only simulated public information,
never the sampled full state's concealed identities. No backend is needed for these
experiments; shared Core changes still require their existing approval gate.

## Experiment discipline

1. Freeze the AI-4 implementation/configuration and record the precise AI-6 source,
   Core pin, Agent config, deterministic node/iteration limits, seeds and environment.
2. Reserve new development and held-out deck ranges before tuning; do not reuse
   the AI-4 10000/20000/30000 comparison ranges as tuning-and-confirmation data.
   Choose the evaluation sample budget up front, rather than adding games until a
   confidence bound becomes favorable. For example, predeclare 400 fresh pairs if
   the compute cost permits; this is a proposal, not an executed experiment.
3. Compare each candidate against frozen EV, then Heuristic/Random as useful probes.
   Keep paired seat swaps, independent deck/decision randomness, exact replay, and
   failed/timed-out/truncated records. Repeats do not add independent samples.
4. Report score difference/paired uncertainty, W/D/L, completed denominators, latency
   p50/p95 and maxima, node counts, failures/timeouts, and tactical/feature ablations.
   Treat seed representativeness and incomplete-case inference as assumptions.
5. Measure complete browser games on actual iPhone Safari/Android Chrome before
   selecting difficulty labels or changing the default. Opening emulation samples
   and the 10-second host recovery guard are not device performance guarantees.

No improvement experiment has been started. The owner can select an option and
budget without replacing the playable AI-5 baseline.
