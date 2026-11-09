# Task 6 — Usability, Visual Finish, and Final Verification

**Status:** Planned; not started or authorized  
**Dependencies:** Tasks 1–5 implemented and reviewed; all Task 3 decisions resolved

## Objective

Finish the existing restrained Traditional Chinese interface and verify the complete local MVP. This is final polish and integration verification, not a product redesign or an opportunity to add features.

Read [AGENTS.md](../../AGENTS.md), the [product specification's visual/non-functional/acceptance requirements](../product-spec.md), [rules](../game-rules.md), [architecture](../architecture.md), and [Tasks 1–5](README.md). Inspect the current UI/styles and all recorded verification gaps before choosing changes.

## Visual and interaction acceptance criteria

- [ ] Preserve warm neutral surfaces, clear boundaries, red/dark pieces, deliberate typography/spacing, and simple controls. No decorative gradients, animation, sound, celebration effects, strategy overlays, or legal-move hints.
- [ ] At default zoom in 320×640 and 390×844 portrait and 1280×800 desktop CSS viewports, the normal play screen shows all 32 cells and essential turn/action controls without page scrolling, overlap, or horizontal overflow. History may use its own bounded area/panel.
- [ ] Every board cell and primary control provides at least a 44×44 CSS-pixel target. Empty destinations remain interactive. Larger screens do not excessively stretch the board.
- [ ] At 200% zoom/increased text size, vertical scrolling is acceptable; all squares, text, and controls remain readable and reachable without clipping important content.
- [ ] Tab/Shift+Tab and Enter/Space operate board/control buttons with visible focus and no trap. A custom arrow-key grid is not required.
- [ ] Traditional Chinese labels contain coordinates and public piece information only; hidden labels disclose no piece identity. Turn, result, and rejection messages are announced through the existing status area. Important state is not conveyed by color alone.
- [ ] Normal text contrast is at least 4.5:1; essential control boundaries/focus indicators are at least 3:1 against adjacent colors.
- [ ] First-flip assignment, selection/switching, direct hidden-piece FLIP from a selection, destination attempts, undo, history, restart, and Progressive Review remain consistent after layout/accessibility changes.

## Correctness and browser acceptance criteria

- [ ] Existing Core/session/UI tests pass without weakening rules or bypassing validation. Completed games enforce results and the approved chase rule, not a generic repetition draw or chase-induced loss.
- [ ] A small Playwright suite covers start, first/subsequent flip, legal move/capture, invalid action, chase rejection, undo, restart cancel/confirm, terminal result, and Progressive Review/exit. Reuse the approved test tooling; add `pnpm test:e2e` if Task 5 has not established it.
- [ ] Deterministic decks/timelines remain test-only. Production bundles/DOM have no test endpoints, exposed seed/deck, hidden identities, or validation bypass hooks.
- [ ] Manually check actual iPhone Safari and Android Chrome, recording devices/browser versions and observations. Desktop/emulated viewport success is not a substitute for claiming physical-device verification.
- [ ] CI runs the established typecheck, tests, build, and small E2E checks without deployment or publication. Creating a local workflow file does not authorize committing/pushing it.

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
