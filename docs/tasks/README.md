# Phase 1 Tasks

**Updated:** 2026-11-09  
**Current state:** Tasks 1–4 implemented; Task 4 review pending; Tasks 5–6 not authorized.

These files are the detailed task instructions. The [Phase 1 overview](../phase-1-plan.md) provides navigation and shared decisions. Preparing these documents does not authorize implementation of the remaining tasks.

| Task | Scope | Status | Depends on |
|---|---|---|---|
| [1 — Workspace and first flip](task-1-workspace-first-flip.md) | Workspace, initialization, flips, public observations | Complete | Approved specifications |
| [2 — Movement and capture](task-2-movement-capture.md) | Rules, enumeration, selection, destination interaction | Complete; owner accepted | Task 1 |
| [3 — Outcomes and chase](task-3-outcomes-chase.md) | Results, no-progress counter, approved chase prohibition | Complete; committed as `c1a9916` | Task 2 |
| [4 — History, undo, restart](task-4-history-undo-restart.md) | Canonical timeline projections and exact reconstruction | Implemented; owner review pending | Task 3 |
| [5 — Progressive Review](task-5-progressive-review.md) | Read-only, post-game historical prefixes | Planned; not authorized | Tasks 3–4 |
| [6 — Usability and verification](task-6-usability-verification.md) | Visual finish, accessibility, E2E, device/performance checks | Planned; not authorized | Tasks 1–5 |

## Read before implementation

- [AGENTS.md](../../AGENTS.md)
- [Product specification](../product-spec.md)
- [Game rules](../game-rules.md)
- [Architecture](../architecture.md)
- The selected task file and its dependencies

Product requirements, game rules, and public architecture contracts remain authoritative. A task file must not silently override them. Record any newly approved decision in the relevant specification before implementation.

## Shared boundaries

- Implement only the task the owner authorizes; completion of one task does not authorize the next.
- Keep Game Core independent of React/browser/network APIs. The session owns the initial deck, one accepted-action timeline, and incremental current state. React owns selection and other temporary UI state.
- Exclude hidden identities from public observations, events, component props, DOM attributes, and labels. A hidden-piece tap submits FLIP even with a selection; successful actions clear selection.
- Keep the local MVP free of AI, multiplayer, persistence, hints, animation, audio, and speculative infrastructure. Use reconstruction for undo/Review; do not add snapshots before measurement justifies a separately reviewed change.
- Rule/public contract changes, major dependencies/layers, and deployments, commits, pushes, or destructive operations require owner approval under the working agreement. Routine internal implementation choices within an authorized task may proceed autonomously.

## Verification records

Task 1 recorded 62 passing tests at its completion. Task 2 and its owner-requested flip UX amendment recorded typecheck, 340 tests across five files, and production build passing. These are historical executed results, not new checks performed while organizing documentation.

The repository currently exposes `pnpm typecheck`, `pnpm test`, and `pnpm build`. ESLint/Prettier are not configured. A Playwright `pnpm test:e2e` script is planned for browser verification; do not claim it exists or passes before it is added and run.

See the [Task 2 execution report](../task-2-report.md) for actual multi-agent ownership, independent QA, and verification evidence. Its original hidden-target rejection steps are historical; the later UX amendment supersedes them.

## Next gate

Task 4 is implemented under the owner's authorization, with 420 passing tests, typecheck/build, and Chrome smoke verification. Stop for owner review; Task 5 requires separate authorization. Task 3's documented ACTIVE/no-alternative chase limitation is unchanged; do not introduce a loss, pass, draw, or exception without a later policy decision.
