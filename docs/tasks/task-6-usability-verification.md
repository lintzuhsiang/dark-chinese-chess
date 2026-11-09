# Task 6 — Usability, Visual Finish, and Final Verification

**Status:** Implemented; automated checks passed; physical-device/hosted-CI acceptance pending\
**Authorization:** Owner authorized Task 6 and joint Tasks 5–6 testing on 2026-11-09\
**Dependencies:** Tasks 1–5 implemented; owner elected joint review of Tasks 5–6. Approved Task 3 house-rule limitation remains unchanged.

## Objective

Finish the existing restrained Traditional Chinese interface and verify the complete local MVP. This is final polish and integration verification, not a product redesign or an opportunity to add features.

Read [AGENTS.md](../../AGENTS.md), the [product specification's visual/non-functional/acceptance requirements](../product-spec.md), [rules](../game-rules.md), [architecture](../architecture.md), and [Tasks 1–5](README.md). Inspect the current UI/styles and all recorded verification gaps before choosing changes.

## Visual and interaction acceptance criteria

- [x] Preserve warm neutral surfaces, clear boundaries, red/dark pieces, deliberate typography/spacing, and simple controls. No decorative gradients, animation, sound, celebration effects, strategy overlays, or legal-move hints.
- [x] At default zoom in 320×640 and 390×844 portrait and 1280×800 desktop CSS viewports, the normal play screen shows all 32 cells and essential turn/action controls without page scrolling, overlap, or horizontal overflow. Review is also checked at these sizes; after the 2026-11-10 amendment its full selectable history is a bounded sidebar on wider screens and below the board on phones. Narrow Review pages may scroll vertically; normal play remains unchanged.
- [x] Every board cell and primary control provides at least a 44×44 CSS-pixel target. Empty destinations remain interactive. Larger screens do not excessively stretch the board.
- [x] Automated 200% text-size and zoom-equivalent reflow checks preserve reachability. Actual phone/browser-native zoom remains part of the unchecked physical-device acceptance below.
- [x] Tab/Shift+Tab and Enter/Space operate board/control buttons with visible focus and no trap. Explicit zero tab indices address WebKit's native button skipping; no custom arrow-key grid is added.
- [x] Traditional Chinese labels contain coordinates and public piece information only; hidden labels disclose no piece identity. Turn, result, and rejection messages use the existing live status area. Important state is not conveyed by color alone.
- [x] Measured normal text contrast is at least 4.5:1 and essential control boundaries/focus at least 3:1 in the tested rendered states. See the evidence report for actual minima and method.
- [x] First-flip assignment, selection/switching, direct hidden-piece FLIP from a selection, destination attempts, undo, history, restart, and Progressive Review remain consistent after layout/accessibility changes.

## Correctness and browser acceptance criteria

- [x] Existing Core/session/UI tests pass without weakening rules or bypassing validation. Completed games enforce results and the approved chase rule, not a generic repetition draw or chase-induced loss.
- [x] The Playwright suite covers start, first/subsequent flip, legal move/capture, invalid action, repeated/later-pattern chase rejection, undo, restart cancel/confirm, terminal draw, and Progressive Review/exit in Chromium and WebKit.
- [x] Deterministic decks/timelines remain test-only. Production bundle/DOM inspection finds no test endpoints, exposed seed/deck, hidden identities, or verification hooks.
- [ ] Manually check actual iPhone Safari and Android Chrome, recording devices/browser versions and observations. Desktop/emulated viewport success is not a substitute for claiming physical-device verification.
- [ ] CI runs the established typecheck, tests, build, and small E2E checks without deployment or publication. Creating a local workflow file does not authorize committing/pushing it.

The CI workflow is authored in `.github/workflows/verify.yml` with read-only repository permission, and its corresponding commands pass locally. The checkbox remains open until an owner-authorized hosted run is recorded. Physical devices were not connected; use [the manual checklist](../verification/manual-checks.md), including the tested trusted-tap console procedure, to close that acceptance item.

## Implementation and executed evidence

Relative fonts/board minima support text enlargement; darker hidden text and square boundaries meet measured contrast; explicit zero tab indices and view focus improve WebKit keyboard access. The browser runner now builds and serves production output. No Game Core rule/contract or runtime dependency changed.

`pnpm typecheck`, `pnpm test` (**451 tests in 13 files**), `pnpm build`, and `pnpm test:e2e` (**22 Chromium/WebKit checks**) pass. A separate three-case WebKit screenshot recheck confirms stable painted titles/layout. `pnpm verify:performance` passes its functional checks and records five samples per operation for 7/66-action and 547/607-action games in two Chromium host configurations; it has no timing threshold assertion and is excluded from CI.

Apple M1/macOS 27.2/Chromium 158 host medians are approximately **31–32 ms** for action, undo, and Review jump in both games. The touch-viewport baseline is browser emulation, not a physical-phone result. All 607 fixture actions pass production validation with progress resets, conservation, and selected-prefix reconstruction checks.

See [the evidence/acceptance audit](../verification/task-6-results.md), [raw five-sample baselines](../verification/performance-baseline.json), and [physical-device steps](../verification/manual-checks.md). Native phone zoom/taps/performance and hosted CI remain pending. ESLint/Prettier remain unconfigured. Phase 1 completion is not declared, and the owner authorized a local commit after the 2026-11-10 Review refinement; no push, deployment, or Phase 1.5/2 work is performed.

## Lightweight performance verification

- Use a short game and a deterministic legal timeline of at least 500 accepted actions. Include progress actions to avoid the 60-ply limit until the intended ending and respect the approved chase rule; do not bypass legality to construct the fixture.
- Use an active prefix for ordinary action/undo measurements and a completed version for Review jumps. Do not enable Review during active play for benchmarking.
- On a recorded reference phone/browser, measure activation-to-visible-update for an ordinary action, undo, and Review jump. Take five attempts each and record the median; the target is at most 100 ms for each interaction.
- Keep game transitions free of time/random/network calls. Measurements belong to verification tooling, not domain logic. Do not add a timing-sensitive CI benchmark.
- Maintain incremental live state and reconstruct only when undo/Review inputs change. If measurements fail, identify the cause and propose the smallest change. Snapshot caches, workers, event-sourcing infrastructure, or other architecture changes require review rather than speculative implementation.

## Verification steps

1. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` after that script exists. Run lint/format checks only if configured by then; otherwise explicitly record their absence rather than claiming success.
2. Inspect screenshots/layout at the three CSS viewports. Measure target dimensions and contrast; exercise keyboard order/focus and 200% zoom.
3. Perform the physical-device and five-sample performance checks above. Record actual values and device/browser details.
4. Verify initial/prefix hidden-data redaction, rejection non-mutation, terminal priorities, undo reconstruction, and Review immutability across the integrated flows.
5. Cross-check the final implementation against every product/rule/architecture acceptance item and the latest task decisions.

## Completion evidence and scope boundary

Deliver changed files, commands with actual outcomes, test counts, browser/device/viewport evidence, performance medians, remaining defects, and verification gaps. An unavailable required device or unresolved chase case is a gap, not a passing result; do not declare Phase 1 complete without resolving it or obtaining an explicit owner-approved requirement change.

Do not add themes, persistence, saved-game libraries, AI, networking, auth, databases, rankings, native apps, hints, animation, or audio. Stop after the completion report for owner review. Phase 1 completion does not authorize deployment, commits, remote pushes, or Phase 2 work.
