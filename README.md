# Dark Chess · 暗棋

Tasks 1–6 local-play implementation: randomized 8×4 hidden board, color assignment, selection/movement/capture, terminal outcomes, no-progress draw, chase prohibition, exact undo, history/captured pieces, confirmed restart, and read-only Progressive Review. Automated usability/browser verification is complete; physical-device checks, hosted CI, and joint owner review remain pending.

## Run locally

Use Node.js 22.x (at least 22.12), 24.x, or 26+ and pnpm 12.18.0. Verification used Node 26.10.0. Run commands from this directory, which contains `pnpm-workspace.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the Local URL printed by Vite, normally `http://127.0.0.1:5173/`. If pnpm is unavailable, use `npx --yes pnpm@12.18.0` in place of `pnpm`; no global installation is required.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
```

The production output is `apps/web/dist/`. Unit tests run in Node, including public-markup checks and UI/session integration. Browser tests run separately through Playwright. No DOM simulator or test-only production deck endpoint is added. ESLint/Prettier are not configured in this repository; no lint/format pass is claimed.

Playwright checks the production build in Chromium and WebKit. Install the browsers once, then run:

```sh
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

The browser runner builds production output, starts/stops its own local preview server on port 5185, and uses a test-only deterministic shuffle. It does not add a player-facing seed or fixture route. Generated screenshots/traces under `test-results/` and reports are ignored by Git. The read-only GitHub Actions workflow runs the same checks after a separately authorized push; no hosted run is claimed yet.

An optional measurement command records five samples each for action, undo, and Review jumps in short and legal 607-action games:

```sh
pnpm verify:performance
```

It serves a production preview on port 5186 and writes ignored `performance-results/` artifacts. Measurements have no timing-sensitive CI threshold. See [recorded evidence](docs/verification/task-6-results.md) and the [manual/physical-phone checklist](docs/verification/manual-checks.md) for joint Tasks 5–6 testing and the standalone trusted-tap procedure.

## Scope and limitations

- Click 「本機雙人」, then click or keyboard-activate a hidden square. The first flip assigns P1 that color and P2 the opposite color; every accepted flip advances the turn. Either color may be flipped later.
- Click a revealed piece of the current player's color to select it. Click it again to deselect, or another friendly revealed piece to switch selection. Selection uses a static border and consumes no turn.
- With a piece selected, click an empty square or revealed enemy to attempt a move/capture. Game Core validates adjacency, ranks, and Cannon screens. Success clears selection and advances the turn; rejection preserves selection, board, timeline, and turn.
- Tapping a hidden piece flips it immediately, even while another piece is selected. A successful flip clears the selection and advances the turn; no separate deselection is needed. No legal-move indicators or strategy overlays are shown.
- Accepted actions evaluate elimination, ordinary immobilization, then a draw at 60 quiet plies. Flips/captures reset the quiet counter. Finished cells are disabled and the result identifies the winner independently of the next-player field.
- Chase enforcement follows the single-pair house rule in `docs/game-rules.md`: two qualifying logical-position returns are allowed; the third renewal is rejected. If every ordinary action is chase-prohibited, the game stays active without inventing a loss/pass/draw; this documented limitation can stall play.
- 「悔棋」 removes the most recent accepted action while active and reconstructs the exact previous state, including counters/chase tracking. Repeated undo reaches the original hidden deck; the button is disabled at zero actions and after completion. There is no redo.
- 「棋譜」 opens read-only numbered actions, coordinates, and captured pieces derived from the current accepted timeline. Undo removes the corresponding entry/reveal/capture from this projection. Escape or 「返回棋盤」 closes it and restores focus.
- 「重新開始」 asks for confirmation during active play, with Cancel initially focused. Cancel preserves the game/selection; confirmation validates a fresh shuffled deck before replacing the session. Completed-game restart is immediate. History, counters, colors, selection, errors, and chase tracking reset.
- After completion, 「覆盤」 starts at the original hidden board. 「開局／上步／下步／終局」 navigates the retained timeline. The status shows the current action number. The full public history stays beside the board on wider screens (below it on phones); select any action to view its resulting position. The selected step is highlighted, and the captured-piece summary follows that step. Historical boards stay read-only even before the terminal action. 「結束覆盤」 restores the unchanged completed screen, where restart remains available.
- AI and multiplayer remain unimplemented. Refresh returns to the entry screen; there is no persistence or saved-game library.
- The full randomized deck exists in the trusted browser session. Rendered components receive only observations with generic hidden squares; this prevents application-level disclosure, not inspection of local browser memory.

## Review map

- `packages/game-core/src/index.ts`: initialization, shared action validation, immutable FLIP/MOVE transitions, public events, `getObservation`, and `getLegalActions`.
- `packages/game-core/src/types.ts`: approved domain contracts, with readonly data throughout.
- `apps/web/src/game/deck.ts`: Fisher–Yates shuffle outside reducers/transitions; injectable random source for tests only, not a player-facing seed.
- `apps/web/src/game/session.ts`: pure reducer retaining the original deck and one accepted actor/action timeline; rejected operations preserve the session reference.
- `apps/web/src/game/reconstruct.ts`: one deterministic fold regenerating domain state and public events; undo truncates and rebuilds from the original deck.
- `apps/web/src/game/review.ts`: public board/history/capture projection of one prefix; the hook separately memoizes completed public history for direct Review seeking.
- `apps/web/src/game/interaction.ts`: React-owned selection reducer; routes destinations through the existing session without implementing game rules.
- `apps/web/src/hooks/useLocalGame.ts`: trusted-state boundary; memoizes public observations and exposes no full session to rendering components.
- `apps/web/src/components/Board.tsx`, `GameControls.tsx`, `ReviewControls.tsx`, `ReviewHistory.tsx`, `History.tsx`, and `App.tsx`: public-only board/history, native buttons/dialogs, turn/result text, undo/restart, and completed-game Review navigation.
- `e2e/`, `playwright.config.ts`, and `.github/workflows/verify.yml`: production-browser gameplay/accessibility checks and CI configuration.
- `verification/`, `playwright.performance.config.ts`, and `docs/verification/`: test-only legal timelines, optional measurements, physical-phone procedure, and acceptance evidence; none are imported by the application.

See [agent instructions](AGENTS.md), [product specification](docs/product-spec.md), [rules](docs/game-rules.md), [architecture](docs/architecture.md), and the [implementation plan](docs/phase-1-plan.md).

## Task 1 verification record

Verified on 2026-11-09 with pnpm installed in a temporary tool directory, without changing the global Node setup:

| Check | Actual result |
|---|---|
| `pnpm install --store-dir /private/tmp/dark-chess-pnpm-store` | Passed; all three workspace projects linked, lockfile generated |
| `pnpm typecheck` | Passed; root tooling, Game Core, and web application/tests |
| `pnpm test` | Passed; 62 tests in three files, Node environment |
| `pnpm build` | Passed; production output in `apps/web/dist/` |
| Local Chrome smoke test | Passed; entry → 32 hidden cells → first flip → opposite color assignments → next-player label |
| Keyboard and rejection smoke test | Passed; Tab/Enter flips one additional piece; repeating Enter on that piece preserves the turn and shows rejection text |
| Desktop screenshot review | All 32 cells visible after correcting the viewport sizing |

This is the historical Task 1 record; the repeat-revealed-click expectation above is superseded by Task 2 selection behavior. Physical iPhone/Android checks, the full Phase 1 E2E suite, and long-timeline performance measurements remain Task 6 work and are not claimed by this slice. No deployment or remote push is performed.

## Task 2 verification record

On 2026-11-09, final `pnpm typecheck`, `pnpm test` (338 tests in five files), `pnpm build`, and source whitespace checks passed. Native Safari verified selection/deselection, hidden-target rejection, a rejected General/Soldier capture, a legal capture, and P2 movement into the emptied source. No legal-move hints were introduced.

Three actual subagents implemented Core and Web in parallel and independently reviewed the integrated result. See the [Task 2 report](docs/task-2-report.md) for their ownership, independent oracle checks, measured timing, files to review, and verification limitations. ESLint/Prettier are not configured and were not executed. The owned verification server is stopped after testing; restart the dev command and refresh your browser to try the new behavior. Task 3 has not started.

Subsequent owner UX amendment: a hidden-piece tap flips directly even with another piece selected, clears selection on success, and consumes exactly one turn. Typecheck, 340 tests across five files, and the production build passed after this change. The original selected-hidden-target rejection smoke steps above are historical; no additional browser smoke is claimed for this amendment.

## Task 3 verification record

`pnpm typecheck`, `pnpm test` (396 tests in eight files), and `pnpm build` passed on 2026-11-09. Three actual subagents delivered outcomes, isolated chase tracking, and read-only QA; Main integrated shared submission/enumeration enforcement, result display, and deterministic session tests. QA independently matched 145,728 candidate submissions and reconstructed all prefixes of 20 seeded games totaling 4,902 accepted actions.

Browser/E2E checks were not run for this domain-focused task. Result labels and disabled finished cells have Node/SSR coverage. ESLint/Prettier remain unconfigured. No commit, push, deployment, or Task 4 implementation was performed.

Owner chase follow-up: fixed a later repeated chase pattern on different squares escaping the original single-anchor check. Chase-local position counts now reject the third return to any qualifying threat position in the same continuous chase. Typecheck, 399 tests across eight files, and production build passed, including repeat-warning, rejection immutability, enumeration, reset, and deterministic reconstruction regressions. No additional browser verification was performed.

## Task 4 verification record

On 2026-11-09, `pnpm typecheck`, `pnpm test` (420 tests across 10 files), and `pnpm build` passed. New frozen valid-deck fixtures verify every prefix and repeated undo through ordinary/Cannon captures, chase returns/later patterns, and resets. Tests also cover initial/terminal guards, undo followed by different play, invalid replacement, completed restart, history order/captures, and hidden-data redaction after undo.

Chrome native controls verified first-flip undo to the original hidden board, a legal capture/history entry, ordinary-move undo, capture undo, history Escape dismissal/focus return, and restart Cancel/confirm while a piece was selected. History uses a separate scrollable dialog so it does not displace the board. The browser extension API failed; no E2E pass is claimed. Completed restart/Cannon/chase undo have automated coverage rather than separate live browser play-throughs. Phone viewport/zoom/performance verification remains Task 6, and ESLint/Prettier remain unconfigured.

Task 4 is implemented for owner review. No push, deployment, new dependencies, Core contract change, or Task 5 implementation was performed.

## Task 5 verification record

On 2026-11-09, `pnpm typecheck`, `pnpm test` (448 tests across 12 files), `pnpm build`, and `pnpm test:e2e` (one Chromium flow at 1280×800) passed. Three completed fixtures verify every prefix, including private chase/counter reconstruction, an undone reveal followed by different play, and a draw with 28 hidden pieces. Controller/SSR tests verify read-only guards, cursor bounds, hidden IDs/future-event redaction, prefix capture data, and unchanged completed state on exit.

The browser flow uses the real UI to undo a reveal, continue differently, complete a 94-action draw, enter Review, check zero/early/final boards and history, navigate both boundaries, and exit to the identical final board. Playwright 1.65.0 is a development dependency; its fixtures are test-only. The runner cleans up its own server/browser. WebKit/Firefox, physical devices, the full viewport/zoom/accessibility matrix, broader E2E coverage, and long-timeline phone performance remain Task 6 work. ESLint/Prettier remain unconfigured.

Task 5 changes are uncommitted for owner review. No Core rule/contract change, push, deployment, or Task 6 implementation was performed.

## Task 6 verification record

On 2026-11-09, `pnpm typecheck`, `pnpm test` (451 tests across 13 files), `pnpm build`, and `pnpm test:e2e` (22 checks across Chromium/WebKit) passed. Three additional WebKit viewport screenshot rechecks passed after waiting for focus/layout paint to settle. Tests cover 320×640, 390×844, and 1280×800 play/Review layouts, 44-pixel targets, keyboard/focus, contrast, 200% text size, zoom-equivalent reflow, gameplay, and the phone procedure itself.

`pnpm verify:performance` passed both reference configurations. Five-sample action/undo/Review medians were approximately 31–32 ms on Apple M1/macOS 27.2/Chromium 158 for short and 607-action games. The touch configuration is desktop emulation, not a physical phone. [Raw samples and results](docs/verification/task-6-results.md) record the exact environment and limitations.

Tasks 5–6 are ready for joint owner review; the owner authorized committing this work with the Review refinement on 2026-11-10. Actual iPhone Safari/Android Chrome checks, native browser zoom, physical-phone timing, hosted CI execution, and owner acceptance of the documented no-alternative chase limitation remain pending. Phase 1 completion is not declared. No Core rules/contracts, runtime dependencies, push, deployment, or later-phase implementation were added. Unrelated roadmap drafts remain untouched.

## Review refinement — 2026-11-10

The owner requested a complete selectable history during completed-game Review. It is now an always-visible, independently scrollable sidebar on wider screens and a bounded list below the board on phones. Select any row, including step 1 then step 30, to render that action's resulting position. The current step is marked visually and with `aria-current="step"`; navigation scrolls the list to it without moving the page. Board/turn/result/capture summary remain selected-prefix projections, and no private IDs or never-revealed identities enter the list. Four equal navigation columns remove extra spacing beside 終局.

Typecheck, 451 unit tests, production build, and all 22 Chromium/WebKit browser checks passed after the refinement, including direct row selection and sidebar/mobile geometry. Physical-phone and hosted-CI acceptance remain pending. The owner authorized a local commit; no push, deployment, or Phase 1.5/2 implementation is authorized by that commit request.
