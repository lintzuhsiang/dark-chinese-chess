# Dark Chess — Phase 1 Implementation Plan

**Version:** 0.4 — Task 1 authorization  
**Status:** Task 1 authorized; Tasks 2–6 require later authorization  
**Scope:** Tasks 0–6, local two-player Functional MVP

## Approval and scope gates

- The owner reviewed Task 0 and authorized Task 1. Implement only that vertical slice, then stop for independent review; do not begin Task 2.
- Terminal next-player handling, observation/history ownership, Progressive Review, simple reconstruction, and removal of general threefold-repetition draws are approved decisions incorporated into the specifications.
- Chase coverage, cycle threshold, resets, and exclusions in `game-rules.md`, section 10 are approved. The owner selected prohibition only, with no chase-induced loss. The no-alternative edge case and final tracker contract remain for Task 3; do not implement them during Task 1.
- Intermediate increments are development checkpoints, not completed implementations of the full ruleset. Do not silently ship Phase 1 without the required chase enforcement.
- No backend, AI, online multiplayer, persistence, animations, audio, move hints, snapshot caching, or speculative infrastructure belongs in these tasks. Deployment, pushing, and file deletion require separate authorization.

## Task 0 — Finalize specifications before implementation

Deliver this revision of `product-spec.md`, `game-rules.md`, and `architecture.md`, plus this plan. Keep applied decisions distinct from the unapproved chase proposal. Reconcile document status, task location, responsibilities, public contracts, outcomes, and verification requirements.

Acceptance and verification:

- Cross-document review finds no obsolete general repetition-draw behavior or state fields.
- Terminal player/result semantics and result reasons agree across all documents.
- Observations are state-only; history/captures belong to the session's active timeline.
- The chase proposal explains threat classification, cycle counting, resets, enforcement choices, a concrete sequence, required tests, and approval questions.
- No application source, dependencies, build configuration, or implemented game behavior is added in Task 0.

## Task 1 — Minimal workspace and first-flip vertical slice

**Implementation status:** Completed locally on 2026-11-09; independent owner review pending. Typecheck, 62 tests, production build, and the start/flip/turn/keyboard/rejection browser smoke checks passed. See `../README.md` for commands, results, review entry points, and limitations. Tasks 2–6 have not started.

Use the agreed TypeScript, React/Vite, pnpm workspace, plain CSS/CSS Modules, and Vitest stack. Establish only `apps/web` and `packages/game-core`. Add a simple Traditional Chinese local-game entry, board, and turn display; prioritize a clean neutral baseline without elaborate visual work.

Acceptance criteria:

- The game core imports no React, browser, or network APIs.
- Initialization accepts exactly a valid 32-piece deck and rejects invalid length, distribution, ranks/colors, or duplicate/missing IDs with `INVALID_DECK`.
- A shuffled deck is generated outside transitions; all pieces begin hidden, P1 starts, and assignments/counts/result have the documented initial values.
- First flip reveals one piece, assigns opposite colors, advances to P2, and emits the specified public FLIP event. A later flip of either color is permitted.
- The session retains the initial deck and accepted actor/action timeline from the start. Rendered cells use only the core's public observation; no hidden piece data reaches labels/attributes.
- Malformed flips, out-of-turn actions, and invalid initialization cannot mutate or replace an existing session.

Verification:

- Run core tests in a Node environment for initialization, input isolation, first/later flips, turn progression, immutability, events, and hidden-field redaction.
- Add and run `pnpm typecheck`, `pnpm test`, and `pnpm build` scripts. Smoke-test start → first flip → next-player display in the browser.

## Task 2 — Movement, captures, and board interaction

Add core validation and enumeration for ordinary movement and rank/Cannon captures, and connect selection/destination interactions to the same action-submission boundary. Do not duplicate legality in the UI.

Acceptance criteria:

- All seven ranks move one orthogonal square into empty space. Normal captures, General/Soldier exceptions, and Cannon screens follow the specification.
- Position validation rejects malformed/non-integer/out-of-range coordinates and row wrapping.
- Hidden sources/targets, friendly captures, wrong-player moves, diagonals, and illegal jumps are rejected with no change to board, turn, counters, or timeline.
- Legal-action enumeration and submission share validation. MOVE events identify the actor, source/destination, public mover, and captured public piece or null.
- Tap/click supports selection/deselection and submits at most one game action per activation. Accepted actions clear selection; invalid attempts show a brief status message without hints.

Verification:

- Table-driven tests cover all rank pairings, both colors, each board edge, Cannon row/column alignment, zero/one/multiple screens, hidden screens, hidden targets, and occupied destinations.
- Check enumeration/submission agreement on representative states. Integration-test selection/deselection and rejected interaction state preservation.
- Run typecheck, core/integration tests, and production build.

## Task 3 — Outcomes, no-progress rule, and approved chase prohibition

Complete terminal evaluation and counters and implement the approved chase definition/prohibition after Task 3 is authorized and its no-alternative edge case and tracker contract are resolved. Keep this as one task, not another project phase.

Approved baseline acceptance criteria:

- Every accepted action advances to the next player, even when it finishes the game. Results explicitly identify the winner/reason.
- Evaluate `NO_PIECES`, then absence of ordinary legal actions for `NO_LEGAL_ACTION`, then `NO_PROGRESS`; hidden pieces count toward survival and permit flipping. Chase filtering must not itself create a loss.
- Quiet movement increments the counter; flips/captures reset it; 60 consecutive quiet plies cause a draw unless a win takes priority.
- Repeated positions alone never produce a draw. Finished games accept no actions and enumerate no legal actions.

Approved chase acceptance criteria for Task 3:

- Track only qualifying renewed threats/escapes of the same revealed attacker/target with the approved non-reciprocal and single-target exclusions.
- Anchor starts at zero; two completed returns are accepted; the candidate third return is rejected without mutation. No general position counter substitutes for this predicate.
- Apply every approved reset and fresh-chain rule. Rejected attempts do not reset or increment the tracker or no-progress counter.
- Enumeration and submission consistently exclude the prohibited renewal, without a chase-induced loss. Add explicit acceptance criteria for the all-actions-prohibited case once the owner specifies it; do not silently substitute a loss, pass, draw, or exception.
- The approved tracker lives in core state and is deterministic/reconstructible. It is not maintained by the UI or independently by the session.

Verification:

- Test elimination including hidden pieces, immobilization with/without flips, terminal next-player fields, result priority, 59/60 quiet plies, and progress resets.
- Test repeated positions without chase: continue unless another documented end condition applies.
- Execute every chase case in `game-rules.md`, section 10: classification, concrete cycle sequence and boundary, routes, mutual/ambiguous threats, physical piece identity, resets, rejection, and absence of chase-induced losses. Test the eventual approved no-alternative behavior as well.
- Run seeded legal sequences checking invariants. Keep tests aligned with the owner's prohibition-only policy.
- Task 3 cannot be declared complete while the no-alternative case remains unresolved or chase enforcement is missing.

## Task 4 — History, exact undo, and restart

Finish session projections and controls around the single canonical timeline. Maintain incremental current state during play; reconstruct for undo without inverse operations or snapshots.

Acceptance criteria:

- Regenerate chronological public events and captures from the active accepted timeline. Do not store independently editable history/capture lists.
- Undo FLIP/MOVE/capture restores the exact prior board, turn, assignments, counts, status/result, captures, and every approved tracker, including chase state.
- Undo to zero restores P1, unassigned colors, zero counts, and the same original hidden deck. Undo followed by a new action discards the abandoned continuation; no redo exists.
- Guard undo at the session boundary: unavailable with no prior action or after completion.
- Restart cancellation preserves the current game. Confirmation creates a fresh valid session and clears all domain/UI state. Invalid initialization preserves the old session. No history needs to survive restart or refresh.

Verification:

- Reconstruct and compare complete domain state and public events at every prefix of legal fixtures, including immediately before/after chase cycle boundaries.
- Test repeated undo, first-flip undo, restored captures, invalid submissions, branching after undo, and tracker resets after branch/restart.
- Integration-test restart cancel/confirm, invalid initialization preservation, and post-completion undo guard. Run typecheck, tests, and build.

## Task 5 — Progressive post-game Review

Use the final active timeline and original deck with one cursor, not a second editable session.

Acceptance criteria:

- Review opens only after completion. Cursor range is 0–N; first/previous/next/final controls respect boundaries.
- At cursor `k`, render only the public state after the first `k` accepted actions and only those `k` history events. Cursor zero is fully hidden with empty history.
- No undone events or later reveals, captures, assignments, or result enter an earlier rendered projection, labels, or attributes.
- Review cannot submit actions or change the completed session. Exiting restores the final screen. Reconstruct only when its inputs change, not on unrelated UI renders.

Verification:

- Compare every replay prefix, including approved tracker state internally, with the corresponding original gameplay state.
- Test cursor boundaries, hidden-data redaction, absent future history, no active-game access, no gameplay actions in Review, and unchanged final session on exit.
- Add a deterministic browser completion → Review → navigation → exit flow. Run typecheck, tests, build, and the relevant Playwright flow.

## Task 6 — Usability, visual finish, and final verification

Finish the restrained neutral visual design, Traditional Chinese labels/status, and objective usability checks from `product-spec.md`. Keep the suite and measurements small.

Acceptance criteria:

- At 320×640, 390×844, and 1280×800 CSS viewports, all 32 cells and essential controls are visible without page scrolling or overlap; no horizontal scrolling. History may have its own bounded area or panel.
- Board cells and primary controls have at least 44×44 CSS-pixel targets. At 200% zoom, scrolling is allowed without loss of access or readable content.
- Tab/Shift+Tab and Enter/Space work for the board/controls, with visible focus, no keyboard trap, public-only labels, and state not conveyed through color alone. Meet the documented 4.5:1 text and 3:1 essential control/focus contrast thresholds.
- No animations, audio, move hints, strategic overlays, or complex rejection UI.
- Record the short/500-action reference-phone checks specified in `product-spec.md`: five attempts per interaction, median target ≤100 ms for action, undo, and Review jump. Measure before proposing any optimization; do not add snapshot infrastructure speculatively.
- Core, session, and small E2E suites pass. CI runs checks without deployment. Test-only deck plumbing is absent from production player-facing data.

Verification:

- Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` (scripts established in the relevant tasks).
- Playwright covers start, flip, movement/capture, invalid action, undo, restart cancel/confirm, terminal result, and Progressive Review at the listed viewport sizes.
- Inspect screenshots, target dimensions, keyboard/focus, labels, and contrast. Manually check actual iPhone Safari and Android Chrome; record the reference devices/browser versions and timing results. Report unavailable-device checks as verification gaps.
- Review all specifications against the approved chase rule and resolved no-alternative case. Phase 1 acceptance requires the chase tests to pass; an unresolved edge case or unmeasured required check is not a passing result.

## Task 0 consistency review and remaining decisions

- Resolved: terminal turn ambiguity, observation/history ownership, minimum public events and typed initialization failures, general repetition-draw removal, Progressive Review prefixes, undo reconstruction, state ownership, and replay recomputation policy.
- Resolved: one planning-document location, matching revision labels, objective viewport/accessibility/performance criteria, and explicit test-only fixture boundaries.
- Subsequent approval applied: the owner accepted chase coverage/exclusions and the three-completed-cycle threshold, and selected prohibition without any chase-induced loss. The remaining gameplay decision is the all-actions-prohibited edge case in `game-rules.md`, section 10; the private tracker contract remains for Task 3.
- Remaining verification setup, not a gameplay decision: select and record available reference phone/browser versions when Task 6 is run. The performance target is not a claim that measurements have already passed.
- No other cross-document conflict is known after this revision. No application checks have run during documentation-only Task 0 because application code/tooling does not yet exist.

## Next recommended task

Task 1 is the current authorized implementation: minimal workspace and start → first-flip → next-player slice. On completion, stop for the owner's independent review. Task 2 is not authorized. Task 3's open no-alternative decision does not block this flip-only slice.
