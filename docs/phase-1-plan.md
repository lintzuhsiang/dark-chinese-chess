# Dark Chess — Phase 1 Implementation Plan

**Version:** 0.6 — Individual task documents  
**Status:** Tasks 1–2 complete and accepted; Tasks 3–6 not started or authorized  
**Updated:** 2026-11-09

## Task documents

This file is the navigation overview. Detailed scope, acceptance criteria, verification, and stop conditions live in the individual files under [docs/tasks](tasks/README.md). Do not keep competing per-task checklists here.

| Task | Detailed instructions | State |
|---|---|---|
| 1 | [Workspace and first flip](tasks/task-1-workspace-first-flip.md) | Complete |
| 2 | [Movement, capture, and board interaction](tasks/task-2-movement-capture.md) | Complete; owner confirmed |
| 3 | [Outcomes, no-progress rule, and chase prohibition](tasks/task-3-outcomes-chase.md) | Planned; authorization and open decision required |
| 4 | [History, exact undo, and restart](tasks/task-4-history-undo-restart.md) | Planned; not authorized |
| 5 | [Progressive post-game Review](tasks/task-5-progressive-review.md) | Planned; not authorized |
| 6 | [Usability, visual finish, and final verification](tasks/task-6-usability-verification.md) | Planned; not authorized |

## Authoritative context

Read [AGENTS.md](../AGENTS.md), [product specification](product-spec.md), [game rules](game-rules.md), [architecture](architecture.md), and the relevant task before implementation. Task documents organize delivery; they do not silently change approved requirements or public contracts.

## Applied decisions

- Game Core owns rules, immutable deterministic transitions, validation, outcomes, and public observations. The session owns the original deck, one accepted timeline, and incremental current state; React owns selection/view state.
- An accepted action always advances currentPlayer, even when terminal. GameResult identifies the winner. Elimination, absence of ordinary legal actions, and no-progress draw have that priority.
- General threefold-repetition draws are removed. The approved narrow chase definition uses three completed anchor-return cycles and move prohibition, without a chase-induced loss.
- A hidden-piece tap submits FLIP even with another piece selected. Success clears selection and advances the turn. Revealed friendly pieces select/deselect/switch; empty/revealed destinations attempt MOVE/capture.
- Undo and Progressive Review use reconstruction from the original deck and active timeline. At Review cursor k, both board and history expose exactly that prefix, without future information or undone entries.
- Keep the local Functional MVP free of AI, multiplayer, auth, persistence, saved-game libraries, hints, animation, sound, snapshot infrastructure, and speculative layers.

## Current evidence and remaining work

Task 1 recorded 62 passing tests at its completion. Task 2 used actual Core/Frontend/QA subagents and, after the owner's UX amendment, recorded typecheck, 340 tests across five files, and production build passing. The [Task 2 report](task-2-report.md) distinguishes original browser/QA evidence from its later UX amendment. These are historical verification results; the current task-file organization adds no application code and does not rerun those checks.

Tasks 3–6 are plans, not implemented features or approval to start them. In particular, Task 2 preserves noProgressCount on MOVE; Task 3 still needs to implement the full counter/outcome/chase policy.

Before Task 3, the owner must resolve the all-actions-chase-prohibited case and finalize the tracker contract. No automatic loss, pass, draw, or exception is authorized for that open case. Task 3 cannot be complete while it remains unresolved.

The repository currently has typecheck/test/build scripts, no ESLint/Prettier setup, and no test:e2e script. Each task must distinguish existing commands from planned tooling and report unavailable checks honestly.

## Authorization and handoff

The owner has confirmed Task 2 is done. Preparing these Markdown files does not authorize Task 3. Implement only a separately authorized task, run its relevant checks, report actual results and limitations, and stop for review before the next task. Rule/public contract changes, significant dependencies/layers, commits, pushes, deployment, and destructive operations remain approval boundaries.
