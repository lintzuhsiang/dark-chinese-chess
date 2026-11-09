# Task 3 — Outcomes, No-Progress Rule, and Chase Prohibition

**Status:** Planned; not started or authorized  
**Dependencies:** [Task 2](task-2-movement-capture.md) complete  
**Approval gate:** Resolve the all-actions-chase-prohibited case and final tracker contract before implementing the complete task.

## Objective

Complete deterministic rule counters and terminal results, then enforce the approved perpetual-chase prohibition without introducing a repetition draw or a chase-induced loss.

Read [AGENTS.md](../../AGENTS.md), [product specification](../product-spec.md), [game rules sections 9–10](../game-rules.md), and [architecture](../architecture.md). Start from the existing [validator](../../packages/game-core/src/validation.ts), [transitions](../../packages/game-core/src/index.ts), [domain types](../../packages/game-core/src/types.ts), and [session](../../apps/web/src/game/session.ts).

## Decisions already approved

- Always advance `currentPlayer` after an accepted action, including a terminal one. Identify the winner through GameResult, not the current player.
- Evaluate elimination, absence of ordinary legal actions, then no-progress draw, in that order. Count hidden pieces when determining elimination; any hidden piece permits a flip.
- Ordinary movement increments `noProgressCount`; flips/captures reset it. Sixty consecutive quiet individual actions cause a draw unless a win takes precedence.
- No general board-repetition draw, counter, hash, or replacement heuristic is allowed.
- Chase coverage is the same revealed attacker/target, renewed non-reciprocal threats, immediate target evasions, and the approved single-target exclusions/reset rules. See the rules for the exact predicate and example sequence.
- The first anchored threat starts at zero completed cycles. Accept two qualifying returns; prohibit the renewal completing the third return, which would be the fourth anchored-threat appearance.
- A prohibited renewal is rejected without changing state, turn, counters, or timeline. The player must choose another action. Chase filtering itself must not cause a loss.

## Decisions still requiring owner approval

1. **No alternative:** Ordinary legal actions may exist while every one is chase-prohibited. The owner has rejected chase-induced losses. Do not invent a pass, draw, loss, exemption, or permission to play the forbidden move. Obtain the intended behavior and add its acceptance test.
2. **Tracker contract:** Finalize the reconstructible Core-owned tracker and any public GameState/type changes before implementation. The existing proposal needs attacker player/ID, target ID, anchor squares, escape/renewal phase, and cycle count, or an inactive/null state. No tracker belongs in the UI or as a second session authority.

Writing this task file does not resolve either decision or authorize code. If the owner authorizes baseline outcomes separately while the chase gate remains open, report partial progress and do not declare Task 3 complete.

## Implementation sequence

1. Record the approved edge-case decision and tracker contract in the rules/architecture.
2. Extend accepted transitions with quiet-move/capture counter updates. Keep invalid attempts fully non-mutating.
3. Evaluate the candidate next-player state before marking it finished. Use ordinary legality, before chase filtering, for the existing `NO_LEGAL_ACTION` loss check.
4. Add chase tracking/filtering to the shared submission/enumeration path. Determine threats from ordinary capture geometry/ranks/occupancy, independent of turn and chase filtering; avoid recursive legality/outcome evaluation.
5. Expose approved result/rejection data through existing public projections. Show a minimal Traditional Chinese result/reason or rejection message; finished play must not invite another move.

## Acceptance criteria

- [ ] Counter values and outcomes are deterministic for a supplied initial deck and accepted timeline. Task 2's temporary unchanged-MOVE-counter behavior is replaced with the full rule.
- [ ] Results use `WIN` with `NO_PIECES` or `NO_LEGAL_ACTION`, or `DRAW` with `NO_PROGRESS`. Elimination takes precedence over immobilization, and wins precede the 60-ply draw.
- [ ] ACTIVE has null result; FINISHED has a result. Terminal `currentPlayer` is the next player; finished submission rejects and enumeration returns no actions. `getGameResult` reads the stored result without independently re-evaluating it.
- [ ] Hidden pieces count toward survival and flipping, and capturing General alone is not an automatic win.
- [ ] Chase classification, anchor counting, alternate qualifying routes, resets/fresh chains, and invalid-attempt preservation match rules section 10 exactly. Hidden screen identities do not affect threats or public output.
- [ ] Submission/enumeration consistently exclude the prohibited renewal, with approved `PERPETUAL_CHASE` feedback and no loss from either rejection or chase filtering.
- [ ] The no-alternative case follows the owner's explicit decision; the task cannot be complete while that case is unresolved.
- [ ] Every required tracker is in immutable, reconstructible Core state. Public observations/events reveal no hidden information or private tracker data.
- [ ] First-flip assignment, movement/capture, and hidden-piece FLIP priority from Tasks 1–2 remain correct.

## Verification

- Unit fixtures: elimination including hidden pieces, immobilization with/without flips, terminal actor/next-player fields, and all result-priority collisions.
- Counter boundaries: 59 versus 60 quiet plies, FLIP/capture reset, rejected attempts unchanged, and deterministic replay of counters/results.
- Chase fixtures: direct versus reciprocal/ambiguous threats, all rank exceptions, Cannon/hidden screens, physical-piece IDs, anchor zero, allowed returns one/two, prohibited return three, resets, non-closing pursuit, and no general repetition draw.
- Compare every candidate's submission result with enumeration, including the separately approved no-alternative behavior. Check hidden-identity permutation invariance.
- Update old fixtures that intentionally omitted opposing pieces or expected Task 2 counter deferral; replace those assumptions with explicit outcome/counter assertions rather than disabling tests or forcing ACTIVE.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm build`. Smoke-test result display, disabled finished play, and rejection feedback. Record actual results and unavailable checks.

## Scope boundary and handoff

Do not implement undo, history display, restart, Review, AI, multiplayer, persistence, extra rulesets, clocks, resignation, or draw agreements. Add no speculative services or snapshots. On completion, summarize decisions, changed contracts, tests, and limitations, then stop for owner review before [Task 4](task-4-history-undo-restart.md).
