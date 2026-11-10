# Dark Chess — Phase 1 Implementation Plan

**Version:** 0.9 — Tasks 5–6 joint verification\
**Status:** Tasks 1–6 implemented; joint review and physical-device/hosted-CI acceptance pending\
**Updated:** 2026-11-09

## Task documents

This file is the navigation overview. Detailed scope, acceptance criteria, verification, and stop conditions live in the individual files under [docs/tasks](tasks/README.md). Do not keep competing per-task checklists here.

| Task | Detailed instructions                                                                      | State                                            |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| 1    | [Workspace and first flip](tasks/task-1-workspace-first-flip.md)                           | Complete                                         |
| 2    | [Movement, capture, and board interaction](tasks/task-2-movement-capture.md)               | Complete; owner confirmed                        |
| 3    | [Outcomes, no-progress rule, and chase prohibition](tasks/task-3-outcomes-chase.md)        | Complete; committed as `c1a9916`                 |
| 4    | [History, exact undo, and restart](tasks/task-4-history-undo-restart.md)                   | Complete; committed as `d73538d`                 |
| 5    | [Progressive post-game Review](tasks/task-5-progressive-review.md)                         | Implemented; owner review pending                |
| 6    | [Usability, visual finish, and final verification](tasks/task-6-usability-verification.md) | Implemented; device/hosted-CI acceptance pending |

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

Task 3 implements outcomes/chase (`c1a9916`); Task 4 implements exact undo, history/captures, and restart (`d73538d`). Task 5 adds Progressive Review; Task 6 adds accessibility fixes, production-browser verification, CI configuration, and legal long-game measurement tooling. Typecheck, 451 tests in 13 files, production build, and 22 Chromium/WebKit checks pass. Five-sample host baselines cover short and 607-action completed games. See the Task 6 evidence report for exact results and remaining acceptance gaps.

The latest Task 3 authorization allows minimal additive tracking types and narrow interpretation of ambiguous chase cases. If all ordinary actions are chase-prohibited, preserve ACTIVE without inventing adjudication; this documented stalemate limitation remains for future owner policy review.

The repository has typecheck/test/build scripts, production `test:e2e`, and opt-in `verify:performance`. ESLint/Prettier remain unconfigured. Actual iPhone Safari/Android Chrome, native device zoom/timing, hosted CI execution, and owner acceptance remain pending; Phase 1 completion is not declared.

## Authorization and handoff

The owner authorized Task 6 so Tasks 5–6 can be tested together. Stop for joint review and the physical-device checklist. Rule/public contract changes, significant dependencies/layers beyond approved verification tooling, commits, pushes, deployment, destructive operations, and Phase 2 work remain approval boundaries.
