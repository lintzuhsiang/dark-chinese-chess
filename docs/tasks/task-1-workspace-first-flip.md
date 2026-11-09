# Task 1 — Minimal Workspace and First-Flip Vertical Slice

**Status:** Complete; accepted before Task 2  
**Completed:** 2026-11-09  
**Dependencies:** Approved product, rules, and architecture specifications

## Objective

Provide a working local-game entry and first-flip flow using a framework-independent TypeScript core and a small React frontend. This task is a completed milestone record, not an instruction to rebuild the existing workspace.

## Context and implementation

Read [AGENTS.md](../../AGENTS.md), [product specification](../product-spec.md), [rules](../game-rules.md), [architecture](../architecture.md), and the [task index](README.md).

- [Workspace manifest](../../package.json) and [workspace configuration](../../pnpm-workspace.yaml)
- [Core initialization/transitions](../../packages/game-core/src/index.ts) and [types](../../packages/game-core/src/types.ts)
- [Deck generation](../../apps/web/src/game/deck.ts), [session](../../apps/web/src/game/session.ts), and [public UI hook](../../apps/web/src/hooks/useLocalGame.ts)
- [App](../../apps/web/src/App.tsx), [Board](../../apps/web/src/components/Board.tsx), and [tests](../../packages/game-core/tests/game-core.test.ts)

## Scope delivered

- Minimal pnpm workspace: `apps/web` and `packages/game-core` only.
- Strict TypeScript, React/Vite, plain CSS, Vitest, and root typecheck/test/build scripts.
- Traditional Chinese local two-player entry, randomized 8-row × 4-column hidden board, color assignment, subsequent flips, and turn display.
- Typed initialization/action results, immutable transitions, accepted actor/action timeline, and public-only rendering data.

## Acceptance criteria

- [x] A valid deck contains 32 unique nonempty piece IDs and the exact documented per-color distribution. Reject malformed size, rank, color, composition, or IDs with `INVALID_DECK`.
- [x] Initialization copies input data. All pieces start hidden, P1 starts, colors are null, counts are zero, status is ACTIVE, and result is null.
- [x] Shuffle outside rendering, reducers, and deterministic transitions. Identical supplied decks/actions reproduce identical states.
- [x] First FLIP assigns P1 the revealed color and P2 the opposite color. Each accepted flip reveals one square, emits the public event, and advances the turn. Later turns may flip either color.
- [x] Runtime-invalid positions, out-of-turn actions, revealed-square FLIP commands, and finished-game commands are rejected without mutation or timeline entries.
- [x] The session retains the original deck and one canonical accepted timeline. Invalid initialization cannot replace an existing session.
- [x] Rendering receives generic hidden squares, public revealed pieces, turn, assignments, and status/result; no hidden IDs, deck, or seed is exposed.
- [x] Core source requires no React, browser, network, database, or UI APIs.

## Verification and evidence

The historical completion run passed `pnpm typecheck`, `pnpm test` (62 tests in three files), and `pnpm build`. Chrome smoke checks verified entry, 32 hidden cells, first-flip assignments, subsequent turns, keyboard activation, and rejection feedback. Details are in the [README verification record](../../README.md).

Tests cover input isolation, frozen inputs, malformed initialization/actions, deterministic 32-flip sequences, event projection, observation redaction, and session preservation.

## Later changes and boundaries

Task 2 intentionally replaced the original flip-only revealed-click behavior with selection/movement/capture and added `getLegalActions`. The owner's follow-up further allows hidden-piece FLIP while another piece is selected. Do not restore obsolete Task 1 interaction behavior or its temporary MOVE-unavailable assertion.

Task 1 did not implement movement, outcomes, undo, history display, restart, Review, AI, or multiplayer. Current functionality is described by [Task 2](task-2-movement-capture.md); pending work remains in Tasks 3–6.
