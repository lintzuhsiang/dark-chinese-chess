# Task 4 — History, Exact Undo, and Restart

**Status:** Planned; not started or authorized  
**Dependencies:** [Task 3](task-3-outcomes-chase.md) complete, including finalized rule trackers

## Objective

Use the existing initial deck and one accepted-action timeline to display history, reconstruct exact prior states for undo, and start a clean new game with unfinished-game confirmation.

Read [AGENTS.md](../../AGENTS.md), [product FR-04/05/07](../product-spec.md), [rules](../game-rules.md), and [architecture sections 7–9](../architecture.md). Inspect the [session reducer](../../apps/web/src/game/session.ts), [interaction reducer](../../apps/web/src/game/interaction.ts), [public hook](../../apps/web/src/hooks/useLocalGame.ts), and [Core events/transitions](../../packages/game-core/src/index.ts).

## Responsibilities and implementation sequence

1. Add a small deterministic reconstruction operation: initialize from the original deck and fold accepted actor/action entries through Core. Regenerate public events in that same pass. Unexpected failure of a canonical entry must remain observable, not silently dropped.
2. Derive displayed history and captured-piece data from those events. Keep the existing timeline authoritative; events/display rows are projections, not a second manually synchronized log.
3. Add undo at the session boundary, then expose it through the hook/UI. Truncate one accepted action and reconstruct from the remaining prefix. Keep incremental state advancement for normal play.
4. Add restart confirmation and fresh initialization. Validate the replacement before discarding the current session; reset temporary UI state only after successful replacement.

## Acceptance criteria

- [ ] History shows accepted actions in order with action number, actor, action type, revealed piece for FLIP, MOVE coordinates, and captured piece where applicable. Invalid attempts and selection-only clicks never create rows.
- [ ] History is read-only during active play, without navigation, hints, strategic overlays, or annotations. Captured data comes from the same prefix; no separate authoritative captured list is introduced.
- [ ] Undo FLIP/MOVE/capture restores the exact prior board, piece identities/reveal flags, next player, assignments, ply/no-progress counts, status/result, captures, and all approved chase tracking.
- [ ] Repeated undo may reach zero actions: original hidden deck, P1, null assignments, zero counts, and initial tracker state. Undo does not reshuffle.
- [ ] A new action after undo continues from the truncated timeline; abandoned actions do not reappear in history or future Review. No redo or alternate-branch library is added.
- [ ] Undo is unavailable with zero actions and after completion, enforced in both session operations and UI controls. Completed games remain read-only except for restart and later Review.
- [ ] Restart asks for confirmation before discarding an active game. Cancel preserves the session/selection; successful confirmation creates a fresh valid shuffled deck and clears timeline, result, counters/trackers, selection, errors, and review-related UI state.
- [ ] Restart from a completed screen needs no unfinished-game confirmation. Invalid initialization preserves the old game. A new shuffle need not differ from the previous permutation by assertion.
- [ ] Hidden data is redacted after undo, including undoing a reveal. The accepted casual fairness policy still acknowledges that undo cannot erase players' memory.
- [ ] History/controls remain usable without unnecessarily displacing the board; detailed final viewport checks belong to Task 6.

## Verification

- Compare reconstructed domain state and regenerated events with original gameplay at every prefix of deterministic legal fixtures.
- Undo first flip, subsequent flips, ordinary moves, normal/Cannon captures, and actions around chase cycle/reset boundaries. Assert original deck and earlier immutable states are unchanged.
- Test repeated undo, zero-action guard, completed-game guard, undo then different continuation, invalid submissions, and tracker preservation after truncation.
- Test restart cancellation/confirmation, finished restart, invalid replacement deck, and all domain/UI resets. Confirm hidden-piece FLIP still works with a selection afterward.
- Integration-test history text/order/capture data against accepted events; verify no hidden IDs or removed actions are rendered.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm build`. Browser-smoke flip/move/capture → undo and restart cancel/confirm. Record actual results.

## Scope and approval boundaries

Do not add persistence, saved-game libraries, redo, active-play replay, inverse undo logic, snapshot caches, AI, or networking. Small session/UI command additions are internal implementation choices; changes to approved Core public contracts or replay semantics require approval. After the completion report, stop for review before [Task 5](task-5-progressive-review.md).
