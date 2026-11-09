# Task 5 — Progressive Post-Game Review

**Status:** Implemented; owner review pending\
**Authorization:** Owner authorized Task 5 on 2026-11-09\
**Follow-up:** Owner authorized Task 6 for joint Tasks 5–6 testing; this review remains pending\
**Dependencies:** [Task 3](task-3-outcomes-chase.md) results and [Task 4](task-4-history-undo-restart.md) reconstruction/history

## Objective

Let players review a completed game using its original deck, final active timeline, and one cursor. Reuse reconstruction; do not create another editable game session. The owner amended the history display on 2026-11-10: the full public completed-game list remains visible and selectable while the board/capture summary follow the selected prefix.

Read [AGENTS.md](../../AGENTS.md), [product FR-06](../product-spec.md), [rules](../game-rules.md), and [architecture sections 6–9](../architecture.md). Inspect the session, interaction reducer, public hook, Board, and Task 4 reconstruction/history operations before editing.

## Implementation sequence

1. Add React view/cursor state and a completed-session guard for entering Review.
2. For cursor `k`, reconstruct exactly the first `k` accepted actor/action entries and regenerate that prefix's public events.
3. Project the reconstructed state with Core for board/turn/assignments/result/captures; separately derive the complete public completed timeline for direct navigation.
4. Add first/previous/next/final controls, direct history-row selection, and exit. Keep the completed live session untouched and reconstruct only when deck/timeline/cursor inputs change.

## Implementation decisions

- `BoardUiState.reviewCursor` is null during live play and an integer 0–N during Review. `OPEN_REVIEW` requires a completed canonical session; `REVIEW_TO` ignores out-of-range/non-integer requests; `CLOSE_REVIEW` clears temporary selection/errors. Navigation preserves the exact session reference.
- While Review is open, the interaction controller ignores all gameplay, undo, start, and restart commands. The board is disabled independently of its historical ACTIVE/FINISHED status. Restart remains available after exiting to the completed screen.
- `game/review.ts` projects state, events, and captures together from the same retained prefix using Task 4 reconstruction. The hook memoizes by session reference and cursor; components receive only public data and numeric cursor/total metadata. Core contracts and the canonical session shape are unchanged.
- The completed screen replaces unavailable undo with 「覆盤」. Review offers opening/previous/next/final and exit, plus an always-visible complete public history with direct step selection. The history sits to the right on wider screens and below the board on narrow screens. It starts at cursor zero and does not store an editable historical board or snapshots.
- Added the previously planned `@playwright/test` 1.65.0 development dependency, root `playwright.config.ts`, and `pnpm test:e2e`. The Chromium test uses a test-only no-op shuffle through `addInitScript`, then real clicks/undo/moves to finish a 94-action game. No production seed, fixture route, or completed-state injection is added.

## Acceptance criteria

- [x] Review can open only after game completion. No active-play move navigation is introduced.
- [x] Cursor range is 0–N, where N is the final accepted timeline length. First/previous are disabled at zero; next/final are disabled at N. Invalid cursor requests cannot corrupt the session or crash the interface.
- [x] Cursor zero shows the original fully hidden board, unassigned colors, no captures, and initial public status. The complete public history remains visible at every cursor; cursor N shows the completed position.
- [x] At every `k`, board/turn/assignments/result/capture summary match that prefix. Full completed public events are intentionally visible in the separate history list, and each row selects its resulting state. Private IDs, never-revealed identities, and discarded undone actions remain excluded.
- [x] Corresponding action number, current historical position, and available controls are clear in Traditional Chinese.
- [x] Review is read-only at both controller and UI boundaries. A historical prefix may have ACTIVE domain status; this must not re-enable selection or gameplay submission while the UI is in Review mode.
- [x] Navigation does not mutate the completed state, original deck, canonical timeline, captures, counters, or chase tracker. Exiting returns to the unchanged final game screen and clears any stale selection.
- [x] No separate editable replay board/history, snapshots, AI analysis, annotations, or move recommendations are added. Unrelated UI renders do not reconstruct history again.

## Executed verification

On 2026-11-09, `pnpm typecheck`, `pnpm test` (448 tests in 12 files), `pnpm build`, and `pnpm test:e2e` (one Chromium flow at 1280×800) passed. Frozen completed-game fixtures cover every historical state/event prefix for an undo/different continuation, chase returns/reset, and a draw with 28 pieces still hidden. Separate SSR tests exercise the actual App's public projection and closed history-dialog DOM, guarding against future reveals, result/capture leaks, and private IDs. Controller tests cover completion/cursor guards, read-only actions, and exact session identity on exit.

The browser test completes the real game, verifies zero/early/final prefixes and both navigation boundaries, checks omitted undone information, confirms 32 disabled historical cells, and returns to the identical final board/history. Its screenshot confirms the desktop Review board/controls fit. The test runner starts and stops its own server on 127.0.0.1:5185. Chromium headless was installed with `pnpm exec playwright install chromium --only-shell`.

Only this desktop Chromium flow is claimed. WebKit/Firefox, physical-phone checks, the full viewport/zoom/accessibility matrix, broader E2E coverage, and 500-action phone performance remain Task 6 work. ESLint/Prettier remain unconfigured. No commit, push, deployment, or Task 6 implementation was performed.

## Verification

- Compare every cursor's reconstructed full domain state internally against its original gameplay prefix, including counters and approved chase tracking. Compare public output separately for redaction.
- Assert selected-prefix events/captures match `k`, the selectable list contains all N accepted public events plus opening, and only cursor N has the final result. Test direct jumps from step 1 to 30 and back.
- Cover first/previous/next/final, boundaries, invalid cursor requests, no active-game access, and exit restoration.
- Attempt interaction/submission against an ACTIVE historical prefix while Review mode is on; no action, selection, timeline change, or domain mutation may occur.
- Include a game with undo and a different continuation before completion; abandoned actions must be absent from every Review projection and the full selectable public list.
- Maintain the small deterministic browser completion → Review → prefix navigation → exit flow using `pnpm test:e2e`; keep fixture behavior test-only.
- Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and the relevant browser flow once its script exists. Record actual results and any unavailable browser checks.

## Scope and handoff

The 2026-11-10 owner amendment supersedes the original prefix-only history rendering described in the historical Task 5 verification record above. Equal-width navigation columns also fix the spacing beside 終局. No in-game Review, editing past moves, redo, saved-game library, export, persistence, AI, or multiplayer. Public Core contracts stay unchanged unless the owner approves a necessary change. Tasks 5–6 are ready for joint owner review; do not start a later phase.
