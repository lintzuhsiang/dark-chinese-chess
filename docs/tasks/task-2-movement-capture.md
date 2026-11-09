# Task 2 — Movement, Capture, and Board Interaction

**Status:** Complete; owner confirmed completion  
**Completed:** 2026-11-09, including the hidden-piece flip UX amendment  
**Dependencies:** [Task 1](task-1-workspace-first-flip.md)

## Objective

Make revealed friendly pieces selectable and route destination attempts through the existing Game Core/session contracts. This is a completed milestone record. It does not authorize Task 3.

## Context and implementation

Read [AGENTS.md](../../AGENTS.md), [product specification](../product-spec.md), [rules](../game-rules.md), and [architecture](../architecture.md).

- [Core validator](../../packages/game-core/src/validation.ts) and [transitions/enumeration](../../packages/game-core/src/index.ts)
- [UI interaction reducer](../../apps/web/src/game/interaction.ts), [session](../../apps/web/src/game/session.ts), and [hook](../../apps/web/src/hooks/useLocalGame.ts)
- [Board](../../apps/web/src/components/Board.tsx), [Core regressions](../../packages/game-core/tests/movement.test.ts), and [UI integration tests](../../apps/web/tests/interaction.test.ts)
- [Original multi-agent execution report](../task-2-report.md)

## Contracts preserved

`MOVE` remains `{ type: 'MOVE', from, to }`. Success returns the new state and a public MOVE event with one-based ply, actor before turn advancement, source/destination, public mover, and public captured piece or null. Failure returns a typed error without mutation. No IDs enter public events.

`getLegalActions(state, playerId)` and `applyAction` share validation. The UI determines ownership for selection but never implements rank, distance, or Cannon legality. Selection belongs to React state, not GameState or LocalGameSession.

## Acceptance criteria

- [x] Every rank moves one orthogonal square to an empty destination, with finite integer coordinates, correct boundaries, and no row wrapping.
- [x] Normal captures follow the rank matrix, including Soldier→General and General-not→Soldier exceptions. Friendly and hidden targets cannot be captured.
- [x] Cannons capture revealed enemies of any rank only on the same row/column over exactly one occupied square. Screens may be any rank/color or hidden; adjacent, zero-screen, multi-screen, diagonal, and empty-target jumps are rejected.
- [x] Hidden/empty/wrong-player sources, malformed actions, illegal captures, and invalid coordinates do not alter state, turn, counters, or timeline.
- [x] Accepted moves clear the source, place the mover at the target, advance turn/ply, and emit accurate redacted events. Enumeration is complete, sound, deterministic, and empty for a non-current player or finished game.
- [x] Friendly revealed clicks select, deselect, or switch selection without consuming a turn. Empty cells are enabled destinations. Success clears selection; rejected moves preserve it and display brief Traditional Chinese feedback with the current turn.
- [x] A hidden-piece tap always attempts FLIP, even with a selection. Success clears selection, records exactly one FLIP, advances the turn, and reveals no other hidden identity. No separate deselection is required.
- [x] Turn display remains available after all pieces are revealed. Selection uses only a static border/accessibility state; no hints, animations, or sounds are added.

## Verification and evidence

Latest recorded executed checks after the UX amendment:

- `pnpm typecheck` — passed.
- `pnpm test` — 340 tests across five files passed.
- `pnpm build` — passed.
- Source whitespace checks — passed during integration.

Coverage includes both-color rank tables, all movement directions, edge/row-wrap cases, Cannon screen variations, malformed inputs, frozen-input immutability, public-event isolation, exhaustive enumeration agreement, P2 capture, hidden-identity permutation, and accepted UI/session move/capture sequences.

Native Safari smoke checks during original Task 2 verified selection, rejection, a legal capture, and P2 movement into the empty source. Its selected-hidden-target rejection step was superseded by the later owner UX amendment. The amended FLIP priority has automated regression coverage; no additional live-browser result was claimed for that follow-up.

Three actual subagents implemented Core/Web concurrently and performed read-only independent QA. The report records their ownership and oracle results. ESLint/Prettier were not configured or run; this remains a recorded verification limitation.

## Deliberately deferred

MOVE currently preserves stored `noProgressCount`; Task 3 must implement quiet-move increments and capture resets together with outcomes/chase. No win/draw detection, chase tracker, undo, history display, replay, restart, AI, or multiplayer was added. A completed Task 2 does not mean Phase 1 is complete.
