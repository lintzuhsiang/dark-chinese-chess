# Dark Chess — Phase 1 Implementation Plan

**Version:** 0.7 — Task 4 implementation\
**Status:** Tasks 1–4 implemented; Task 4 review pending; Tasks 5–6 not authorized\
**Updated:** 2026-11-09

## Task documents

This file is the navigation overview. Detailed scope, acceptance criteria, verification, and stop conditions live in the individual files under [docs/tasks](tasks/README.md). Do not keep competing per-task checklists here.

| Task | Detailed instructions | State |
|---|---|---|
| 1 | [Workspace and first flip](tasks/task-1-workspace-first-flip.md) | Complete |
| 2 | [Movement, capture, and board interaction](tasks/task-2-movement-capture.md) | Complete; owner confirmed |
| 3 | [Outcomes, no-progress rule, and chase prohibition](tasks/task-3-outcomes-chase.md) | Complete; committed as `c1a9916` |
| 4 | [History, exact undo, and restart](tasks/task-4-history-undo-restart.md) | Implemented; owner review pending |
| 5 | [Progressive post-game Review](tasks/task-5-progressive-review.md) | Planned; not authorized |
| 6 | [Usability, visual finish, and final verification](tasks/task-6-usability-verification.md) | Planned; not authorized |

## Authoritative context

Read [AGENTS.md](../AGENTS.md), [product specification](product-spec.md), [game rules](game-rules.md), [architecture](architecture.md), and the relevant task before implementation. Task documents organize delivery; they do not silently change approved requirements or public contracts.

## Applied decisions

- Game Core owns rules, immutable deterministic transitions, validation, outcomes, and public observations. The session owns the original deck, one accepted timeline, and incremental current state; React owns selection/view state.
- An accepted action always advances currentPlayer, even when terminal. GameResult identifies the winner. Elimination, absence of ordinary legal actions, and no-progress draw have that priority.
- General threefold-repetition draws are removed. The approved narrow chase definition prohibits a third return to any qualifying threat position within the continuous same-pair chase, including later loops on other squares, without a chase-induced loss.
- A hidden-piece tap submits FLIP even with another piece selected. Success clears selection and advances the turn. Revealed friendly pieces select/deselect/switch; empty/revealed destinations attempt MOVE/capture.
- Undo and Progressive Review use reconstruction from the original deck and active timeline. At Review cursor k, both board and history expose exactly that prefix, without future information or undone entries.
- Keep the local Functional MVP free of AI, multiplayer, auth, persistence, saved-game libraries, hints, animation, sound, snapshot infrastructure, and speculative layers.

## Current evidence and remaining work

Task 1 recorded 62 passing tests at its completion. Task 2 used actual Core/Frontend/QA subagents and, after the owner's UX amendment, recorded typecheck, 340 tests across five files, and production build passing. The [Task 2 report](task-2-report.md) distinguishes original browser/QA evidence from its later UX amendment. These are historical verification results; the current task-file organization adds no application code and does not rerun those checks.

Task 3 implements counters, outcomes, and the narrow chase prohibition, including the owner's later-pattern chase regression, and is committed as `c1a9916`. Task 4 adds exact undo, derived history/captures, and confirmed restart. Typecheck, 420 tests in 10 files, and build pass; Chrome smoke checks cover undo/history and restart cancellation/confirmation. See the Task 4 record for verification limits. Tasks 5–6 remain plans and are not authorized.

The latest Task 3 authorization allows minimal additive tracking types and narrow interpretation of ambiguous chase cases. If all ordinary actions are chase-prohibited, preserve ACTIVE without inventing adjudication; this documented stalemate limitation remains for future owner policy review.

The repository currently has typecheck/test/build scripts, no ESLint/Prettier setup, and no test:e2e script. Each task must distinguish existing commands from planned tooling and report unavailable checks honestly.

## Authorization and handoff

The owner authorized Task 4 and requires a review handoff before Task 5. Rule/public contract changes, significant dependencies/layers, commits, pushes, deployment, and destructive operations remain approval boundaries.
