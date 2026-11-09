# Task 5 — Progressive Post-Game Review

**Status:** Planned; not started or authorized  
**Dependencies:** [Task 3](task-3-outcomes-chase.md) results and [Task 4](task-4-history-undo-restart.md) reconstruction/history

## Objective

Let players review a completed game using its original deck, final active timeline, and one cursor. Reuse reconstruction; do not create another editable game session or reveal information from future actions.

Read [AGENTS.md](../../AGENTS.md), [product FR-06](../product-spec.md), [rules](../game-rules.md), and [architecture sections 6–9](../architecture.md). Inspect the session, interaction reducer, public hook, Board, and Task 4 reconstruction/history operations before editing.

## Implementation sequence

1. Add React view/cursor state and a completed-session guard for entering Review.
2. For cursor `k`, reconstruct exactly the first `k` accepted actor/action entries and regenerate that prefix's public events.
3. Project the reconstructed state with Core and render only its board/turn/assignments/result and those history entries.
4. Add first/previous/next/final controls and exit. Keep the completed live session untouched and reconstruct only when deck/timeline/cursor inputs change.

## Acceptance criteria

- [ ] Review can open only after game completion. No active-play move navigation is introduced.
- [ ] Cursor range is 0–N, where N is the final accepted timeline length. First/previous are disabled at zero; next/final are disabled at N. Invalid cursor requests cannot corrupt the session or crash the interface.
- [ ] Cursor zero shows the original fully hidden board, unassigned colors, empty history, and initial public status. Cursor N shows the completed position and all N active events.
- [ ] At every `k`, board and history are from the same prefix. Future flips, captures, assignments, result, private IDs, and discarded undone actions never enter the rendered projection, labels, or attributes.
- [ ] Corresponding action number, current historical position, and available controls are clear in Traditional Chinese.
- [ ] Review is read-only at both controller and UI boundaries. A historical prefix may have ACTIVE domain status; this must not re-enable selection or gameplay submission while the UI is in Review mode.
- [ ] Navigation does not mutate the completed state, original deck, canonical timeline, captures, counters, or chase tracker. Exiting returns to the unchanged final game screen and clears any stale selection.
- [ ] No separate editable replay board/history, snapshots, AI analysis, annotations, or move recommendations are added. Unrelated UI renders do not reconstruct history again.

## Verification

- Compare every cursor's reconstructed full domain state internally against its original gameplay prefix, including counters and approved chase tracking. Compare public output separately for redaction.
- Assert history length equals `k`; zero has none; only cursor N has the final result unless an earlier prefix was itself terminal (which cannot precede further accepted actions).
- Cover first/previous/next/final, boundaries, invalid cursor requests, no active-game access, and exit restoration.
- Attempt interaction/submission against an ACTIVE historical prefix while Review mode is on; no action, selection, timeline change, or domain mutation may occur.
- Include a game with undo and a different continuation before completion; abandoned actions must be absent from every Review projection.
- Add a small deterministic browser completion → Review → prefix navigation → exit flow using the approved Playwright stack. If establishing `pnpm test:e2e` here, keep fixtures test-only and record the script/config addition; the command does not currently exist.
- Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and the relevant browser flow once its script exists. Record actual results and any unavailable browser checks.

## Scope and handoff

No in-game Review, editing past moves, redo, saved-game library, export, persistence, AI, or multiplayer. Public Core contracts stay unchanged unless the owner approves a necessary change. Stop for review before [Task 6](task-6-usability-verification.md).
