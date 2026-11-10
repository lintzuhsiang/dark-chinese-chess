# Phase 1 Tasks

**Updated:** 2026-11-10\
**Current state:** Tasks 1–6 implemented; Tasks 5–6 joint review and physical-device/hosted-CI acceptance pending.

These files are the detailed task instructions. The [Phase 1 overview](../phase-1-plan.md) provides navigation and shared decisions. Preparing these documents does not authorize implementation of the remaining tasks.

| Task                                                               | Scope                                                           | Status                                           | Depends on              |
| ------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------ | ----------------------- |
| [1 — Workspace and first flip](task-1-workspace-first-flip.md)     | Workspace, initialization, flips, public observations           | Complete                                         | Approved specifications |
| [2 — Movement and capture](task-2-movement-capture.md)             | Rules, enumeration, selection, destination interaction          | Complete; owner accepted                         | Task 1                  |
| [3 — Outcomes and chase](task-3-outcomes-chase.md)                 | Results, no-progress counter, approved chase prohibition        | Complete; committed as `c1a9916`                 | Task 2                  |
| [4 — History, undo, restart](task-4-history-undo-restart.md)       | Canonical timeline projections and exact reconstruction         | Complete; committed as `d73538d`                 | Task 3                  |
| [5 — Progressive Review](task-5-progressive-review.md)             | Read-only historical boards with full selectable public history | Implemented; owner review pending                | Tasks 3–4               |
| [6 — Usability and verification](task-6-usability-verification.md) | Visual finish, accessibility, E2E, device/performance checks    | Implemented; device/hosted-CI acceptance pending | Tasks 1–5               |

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

The repository exposes `pnpm typecheck`, `pnpm test` (453 tests), `pnpm build`, `pnpm test:e2e` (22 Chromium/WebKit checks), and opt-in `pnpm verify:performance`. Task 6's [evidence report](../verification/task-6-results.md) records geometry, contrast, keyboard, and five-sample host baselines. Phase 1.5 provides `pnpm lint`, `pnpm format:check`, `pnpm verify:gates`, and `pnpm verify:release`; its release checklist records the current local evidence.

See the [Task 2 execution report](../task-2-report.md) for actual multi-agent ownership, independent QA, and verification evidence. Its original hidden-target rejection steps are historical; the later UX amendment supersedes them.

## Next gate

The owner authorized joint Tasks 5–6 testing. Implementation and local automation are ready; stop for owner review and [physical-device checks](../verification/manual-checks.md). Hosted CI has been configured but not run. Phase 1.5 applies the 2026-11-10 owner-approved chase-aware NO_LEGAL_ACTION amendment; an accepted ACTIVE state must retain a permitted action. Do not declare Phase 1 complete or start later phases without resolving/accepting the remaining gates.

Phase 1.5 independent preparation is authorized in [the release plan](../phase-1.5-plan.md). Hosted CI and device evidence/gap acceptance still gate publication; commits, pushes, external resources and public deployments require explicit authorization.
