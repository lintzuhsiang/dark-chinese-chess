# Task 3 — Outcomes, No-Progress Rule, and Chase Prohibition

**Status:** Complete; committed as `c1a9916`; owner authorized Task 4\
**Dependencies:** [Task 2](task-2-movement-capture.md) complete  
**Authorization:** Owner authorized Task 3, narrow chase interpretation, and minimal additive state/type changes on 2026-11-09.

## Objective

Complete deterministic rule counters and terminal results, then enforce the approved perpetual-chase prohibition without introducing a repetition draw or a chase-induced loss.

Read [AGENTS.md](../../AGENTS.md), [product specification](../product-spec.md), [game rules sections 9–10](../game-rules.md), and [architecture](../architecture.md). Start from the existing [validator](../../packages/game-core/src/validation.ts), [transitions](../../packages/game-core/src/index.ts), [domain types](../../packages/game-core/src/types.ts), and [session](../../apps/web/src/game/session.ts).

## Decisions already approved

- Always advance `currentPlayer` after an accepted action, including a terminal one. Identify the winner through GameResult, not the current player.
- Evaluate elimination, absence of ordinary legal actions, then no-progress draw, in that order. Count hidden pieces when determining elimination; any hidden piece permits a flip.
- Ordinary movement increments `noProgressCount`; flips/captures reset it. Sixty consecutive quiet individual actions cause a draw unless a win takes precedence.
- No general board-repetition draw, counter, hash, or replacement heuristic is allowed.
- Chase coverage is the same revealed attacker/target, renewed non-reciprocal threats, immediate target evasions, and the approved single-target exclusions/reset rules. See the rules for the exact predicate and example sequence.
- Each qualifying threat position starts at zero completed returns. Accept two returns to it; prohibit its third return/fourth appearance within the continuous chase, including a later pattern on other squares after an earlier warning.
- A prohibited renewal is rejected without changing state, turn, counters, or timeline. The player must choose another action. Chase filtering itself must not cause a loss.

## Task 3 interpretation and contract

1. **No alternative:** Under the owner's instruction to choose a narrow interpretation and record limits, preserve ACTIVE with no result if ordinary actions exist but all are chase-prohibited. Do not invent loss/pass/draw/exemption. A permanent Cannon-cycle regression verifies this potentially stalled position; broader adjudication still needs a future owner decision.
2. **Tracker contract:** Authorized additive `GameState.chase` is null or a Core-owned `ChaseState` with attacker player/ID, target ID, ESCAPE/RENEW phase, and chase-local logical `positionCounts`. After the owner's report of missing later warnings, these counts replace the single anchor/return count so a later loop on different squares is also checked. Logical equality excludes arbitrary IDs/hidden values/counters; physical IDs preserve pair continuity. `PERPETUAL_CHASE` leaves action/result/event shapes unchanged.

These choices are implemented under the latest Task 3 authorization and documented in the rules/architecture. They do not authorize Task 4 or a comprehensive chase adjudication system.

## Implementation sequence

1. Record the approved edge-case decision and tracker contract in the rules/architecture.
2. Extend accepted transitions with quiet-move/capture counter updates. Keep invalid attempts fully non-mutating.
3. Evaluate the candidate next-player state before marking it finished. Use ordinary legality, before chase filtering, for the existing `NO_LEGAL_ACTION` loss check.
4. Add chase tracking/filtering to the shared submission/enumeration path. Determine threats from ordinary capture geometry/ranks/occupancy, independent of turn and chase filtering; avoid recursive legality/outcome evaluation.
5. Expose approved result/rejection data through existing public projections. Show a minimal Traditional Chinese result/reason or rejection message; finished play must not invite another move.

## Acceptance criteria

- [x] Counter values and outcomes are deterministic for a supplied initial deck and accepted timeline. Task 2's temporary unchanged-MOVE-counter behavior is replaced with the full rule.
- [x] Results use `WIN` with `NO_PIECES` or `NO_LEGAL_ACTION`, or `DRAW` with `NO_PROGRESS`. Elimination takes precedence over immobilization, and wins precede the 60-ply draw.
- [x] ACTIVE has null result; FINISHED has a result. Terminal `currentPlayer` is the next player; finished submission rejects and enumeration returns no actions. `getGameResult` reads the stored result without independently re-evaluating it.
- [x] Hidden pieces count toward survival and flipping, and capturing General alone is not an automatic win.
- [x] Chase classification, logical position counting, alternate qualifying routes/later patterns, resets/fresh chains, and invalid-attempt preservation match the clarified rules. Hidden screen identities do not affect threats or public output.
- [x] Submission/enumeration consistently exclude the prohibited renewal with `PERPETUAL_CHASE` feedback, without chase-induced loss.
- [x] The no-alternative position preserves ACTIVE and is explicitly documented/tested as a minimal-rule limitation.
- [x] Every required tracker is in immutable, reconstructible Core state. Public observations/events reveal no hidden information or private tracker data.
- [x] First-flip assignment, movement/capture, and hidden-piece FLIP priority from Tasks 1–2 remain correct.

## Executed verification

`pnpm typecheck`, `pnpm test` (396 tests across eight files), and `pnpm build` passed. Read-only QA separately matched 145,728 candidate submissions against enumeration, played 20 seeded valid-deck games totaling 4,902 accepted actions, and reconstructed every accepted prefix exactly. Result text and disabled finished cells have Node/SSR coverage. Browser/E2E checks were not run for this domain-focused task; ESLint/Prettier remain unconfigured. No commits, pushes, deployments, or Task 4 implementation were performed.

Owner follow-up: reproduced a missing later prohibition after the same pair moved to other squares and repeated a new chase pattern. The new regression failed with the single-anchor tracker and passes with chase-local position counts. `pnpm typecheck`, `pnpm test` (399 tests across eight files), and `pnpm build` passed after the fix. New UI/session regressions verify the second rejection, enumeration agreement, unchanged rejected state/timeline, fresh chains after flips, and deterministic reconstruction. Earlier independent QA figures above are historical and were not rerun for this follow-up; no new browser verification is claimed.

## Verification

- Unit fixtures: elimination including hidden pieces, immobilization with/without flips, terminal actor/next-player fields, and all result-priority collisions.
- Counter boundaries: 59 versus 60 quiet plies, FLIP/capture reset, rejected attempts unchanged, and deterministic replay of counters/results.
- Chase fixtures: direct versus reciprocal/ambiguous threats, all rank exceptions, Cannon/hidden screens, physical-piece IDs, first appearance/zero returns, allowed returns one/two, prohibited return three, later loops on different squares after a warning, resets, non-closing pursuit, and no general repetition draw.
- Compare every candidate's submission result with enumeration, including the documented no-alternative limitation. Check hidden-identity permutation invariance.
- Update old fixtures that intentionally omitted opposing pieces or expected Task 2 counter deferral; replace those assumptions with explicit outcome/counter assertions rather than disabling tests or forcing ACTIVE.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm build`. Smoke-test result display, disabled finished play, and rejection feedback. Record actual results and unavailable checks.

## Scope boundary and handoff

Do not implement undo, history display, restart, Review, AI, multiplayer, persistence, extra rulesets, clocks, resignation, or draw agreements. Add no speculative services or snapshots. On completion, summarize decisions, changed contracts, tests, and limitations, then stop for owner review before [Task 4](task-4-history-undo-restart.md).
