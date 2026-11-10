# Task 6 — Verification Evidence

Initial session date: 2026-11-09; Review refinement checked on 2026-11-10. Tasks 5–6 are ready for joint review after the final checks below. Physical-device and hosted-CI acceptance remain pending; Phase 1 completion is not declared.

## Implemented changes

- Relative text sizes and board minimums honor larger text settings; control groups and dialog headings can wrap.
- Hidden-piece text and square boundaries have stronger contrast while retaining the warm neutral/red/dark palette.
- Explicit `tabIndex={0}` preserves native button order in WebKit. Review entry/exit puts focus on the relevant control, and dialogs retain keyboard dismissal/return behavior.
- Production-build browser tests cover gameplay, later-pattern chase rejection, undo, restart, Review, viewport/target geometry, keyboard focus, contrast, larger text, and zoom-equivalent reflow.
- A legal 607-action fixture, opt-in five-sample performance command, and test-only trusted-tap phone procedure support repeatable verification.
- A read-only CI workflow runs install/typecheck/unit tests/build/E2E without deployment or publication. No Game Core rules/contracts, runtime dependencies, snapshots, or backend layers were added.

## Commands and scope

| Command/check                           | Result                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                        | Passed                                                                                            |
| `pnpm test`                             | Passed; 451 tests in 13 files                                                                     |
| `pnpm build`                            | Passed; production bundle served by browser checks                                                |
| `pnpm test:e2e`                         | Passed; 22 checks across Chromium and WebKit, followed by three stable WebKit screenshot rechecks |
| `pnpm verify:performance`               | Passed; two Chromium reference configurations, short and long games, five samples per operation   |
| `git diff --check`                      | Passed                                                                                            |
| ESLint / Prettier                       | Unconfigured; no pass claimed                                                                     |
| Hosted GitHub Actions run               | Not executed; workflow authored/reviewed locally only                                             |
| Physical iPhone Safari / Android Chrome | Not available in this session; manual checks pending                                              |

## Browser layout and accessibility evidence

Chromium 158 and Playwright WebKit on macOS passed the default-size geometry checks below. These are desktop browser engines, not physical phones. Screenshots and raw geometry/contrast JSON are generated under ignored `test-results/` paths.

| CSS viewport | Normal play                               | Progressive Review                                                      | Smallest target |
| ------------ | ----------------------------------------- | ----------------------------------------------------------------------- | --------------- |
| 320×640      | Fits without page overflow/target overlap | Board/controls fit; full history below, vertical page scrolling allowed | 44×44 CSS px    |
| 390×844      | Fits without page overflow/target overlap | Board/controls fit; full history below, vertical page scrolling allowed | 44×44 CSS px    |
| 1280×800     | Fits without page overflow/target overlap | Fits without page overflow/target overlap                               | 44×44 CSS px    |

Both engines measured minimum text contrast **4.862:1**, essential control-boundary contrast **3.893:1**, and keyboard-focus contrast **4.808:1** against the tested backgrounds. The calculation uses [W3C relative luminance](https://www.w3.org/WAI/WCAG21/Understanding/relative-luminance.html). Inactive controls/decorative separators are not treated as interactive boundaries. Filled controls may distinguish their boundary through their fill; outlined controls use their border.

Screenshots were visually inspected at all three sizes. An immediate WebKit capture after focus/layout transition contained a transient title-paint artifact; after two animation frames, the title and layout rendered correctly with stable geometry. The screenshot check now waits for that intervening paint. Production bundle inspection found none of the verification fixture or measurement-hook markers.

Automated 200% root text size doubles actual text and preserves reachability of all cells/controls/dialogs. A separate 640×400 CSS viewport at double pixel density checks reflow equivalent to 200% zoom on a 1280×800 display. This does not claim that native Safari/Chrome zoom or physical phone accessibility settings were tested; those remain on the manual checklist.

## Initial performance baseline — 2026-11-09, physical phones still pending

Reference host: **Apple M1, macOS 27.2, arm64, Node 26.10.0, Chromium 158.0.8127.18**. Production build, other browser checks idle. The touch configuration is a **390×844 emulated viewport on this Mac**, not an Android/iPhone result. Raw samples are retained in `performance-baseline.json`.

| Configuration / game           | Active / completed actions | Ordinary action median | Undo median | Review jump median |
| ------------------------------ | -------------------------: | ---------------------: | ----------: | -----------------: |
| Desktop 1280×800 / short       |                     7 / 66 |                30.8 ms |     31.6 ms |            31.6 ms |
| Desktop 1280×800 / long        |                  547 / 607 |                31.7 ms |     31.6 ms |            31.4 ms |
| Touch viewport 390×844 / short |                     7 / 66 |                31.3 ms |     31.2 ms |            31.0 ms |
| Touch viewport 390×844 / long  |                  547 / 607 |                31.8 ms |     31.9 ms |            31.6 ms |

Each median uses five click-activation → two-animation-frame samples, allowing an intervening paint and excluding automation RPC time. Setup uses real accepted actions. Twenty progress flips keep the long fixture below the no-progress limit until its final 60 quiet plies. Unit tests check every action, piece conservation, and selected reconstruction prefixes. Measurements are informative and do not impose timing-sensitive CI assertions. No snapshot optimization was justified by these host baselines.

## Acceptance audit

| Requirement area                                                                  | Evidence / remaining limit                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initialization, first flip, movement/capture, expected invalid actions            | Core/session tests and real-UI gameplay scenarios                                                                                                                                                                 |
| Terminal next-player/result priority, hidden-piece survival, 59/60 quiet boundary | Core outcome tests; real-UI completed draws                                                                                                                                                                       |
| Chase versus ordinary repetition; later patterns; reset/rejection invariants      | Core chase tests and browser later-pattern/undo-reset scenario; approved no-alternative ACTIVE limitation remains unchanged                                                                                       |
| Canonical history, exact undo, restart validation                                 | Session/reconstruction tests and browser undo/restart cancellation/confirmation                                                                                                                                   |
| Progressive Review accuracy/read-only/redaction                                   | Every-prefix tests for completed fixtures, actual-App SSR checks, production browser completion/direct row selection/navigation/exit; full public history is intentionally visible after the 2026-11-10 amendment |
| Hidden data isolated from rendered observations/events/attributes                 | Core/SSR/browser checks; verification code excluded from production imports/bundle                                                                                                                                |
| Layout, text, targets, keyboard, focus, contrast                                  | Geometry/contrast/keyboard/larger-text browser tests and screenshot inspection; native zoom/physical device checks pending                                                                                        |
| Incremental play, deterministic reconstruction, no duplicate authority            | Existing session/cache; one memoized public prefix projection; 607-action fixture and host measurements                                                                                                           |
| CI typecheck/test/build/E2E                                                       | Local command results and `.github/workflows/verify.yml`; hosted execution pending owner-authorized push                                                                                                          |
| Full Phase 1 acceptance                                                           | Pending physical-phone results, hosted CI, and owner review, including the existing no-alternative chase limitation                                                                                               |

Use [manual-checks.md](manual-checks.md) for the remaining device steps, timing procedure, and result table. The unrelated Phase 1.5/Phase 2 roadmap drafts were preserved. The owner authorized a local commit on 2026-11-10 after the Review refinement. No push, deployment, or Phase 1.5/2 implementation was performed.

## Owner-authorized Review amendment — 2026-11-10

Review now keeps the full completed public history visible and selectable, with opening and all accepted actions. The board/assignments/result/capture summary still follow only the selected prefix. The hook memoizes the completed public projection by session identity and does not rebuild the full list's source events on every cursor change. This is derived public data, not another editable session or rule tracker.

Desktop uses a bounded right sidebar; narrow screens place the bounded list below the board and permit vertical page scrolling. The current row is marked and scrolled within its own list without scrolling the page. Four equal-width navigation buttons align 終局 with the board's right edge. Browser checks reproduce actual step-1 and step-30 boards through direct list selection, keyboard activation, current-row highlighting, completed-state restoration, and all three viewport layouts. Existing private-data and read-only guards remain covered. The added 200% text-size check at 320×640 caught a 13-pixel history list caused by a fixed-height panel; the panel height now scales with text size, preserving room for selectable rows. This case remains in the browser regression suite.

Typecheck, 451 unit tests, production build, and the full 22-test Chromium/WebKit suite pass. The earlier prefix-only history requirement is superseded by this explicit owner amendment; public future entries in the completed list are intentional, while identities of still-hidden pieces remain absent.

The expanded sidebar contrast check passes in both engines. The opt-in performance rerun also passes both host configurations with the full completed history rendered: short-game action/undo/Review medians are 31.5/31.6/31.4 ms on desktop and 31.4/31.2/31.6 ms in the touch viewport; long-game medians are 31.7/32.1/31.7 ms and 31.8/31.6/31.7 ms respectively. [Raw five-sample results](review-performance-baseline.json) retain the measurement environment. These remain Mac host measurements, not physical-phone acceptance.
