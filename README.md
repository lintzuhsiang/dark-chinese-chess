# Dark Chess · 暗棋

Task 3 local-play slice: randomized 8×4 hidden board, color assignment, selection/movement/capture, terminal outcomes, no-progress draw, and a narrow perpetual-chase prohibition. Undo, history display, restart, and Review remain later tasks.

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

The production output is `apps/web/dist/`. Tests run in Node, including public-markup checks and UI/session integration. No DOM simulator, test-only production deck endpoint, or browser automation dependency is added. Browser smoke verification is performed separately. ESLint/Prettier are not configured in this repository; no lint/format pass is claimed.

## Scope and limitations

- Click 「本機雙人」, then click or keyboard-activate a hidden square. The first flip assigns P1 that color and P2 the opposite color; every accepted flip advances the turn. Either color may be flipped later.
- Click a revealed piece of the current player's color to select it. Click it again to deselect, or another friendly revealed piece to switch selection. Selection uses a static border and consumes no turn.
- With a piece selected, click an empty square or revealed enemy to attempt a move/capture. Game Core validates adjacency, ranks, and Cannon screens. Success clears selection and advances the turn; rejection preserves selection, board, timeline, and turn.
- Tapping a hidden piece flips it immediately, even while another piece is selected. A successful flip clears the selection and advances the turn; no separate deselection is needed. No legal-move indicators or strategy overlays are shown.
- Accepted actions evaluate elimination, ordinary immobilization, then a draw at 60 quiet plies. Flips/captures reset the quiet counter. Finished cells are disabled and the result identifies the winner independently of the next-player field.
- Chase enforcement follows the single-pair house rule in `docs/game-rules.md`: two qualifying logical-position returns are allowed; the third renewal is rejected. If every ordinary action is chase-prohibited, the game stays active without inventing a loss/pass/draw; this documented limitation can stall play.
- Undo, history display, restart, Review, AI, and multiplayer remain unimplemented. Refresh returns to the entry screen; there is no post-game restart control until Task 4.
- The full randomized deck exists in the trusted browser session. Rendered components receive only observations with generic hidden squares; this prevents application-level disclosure, not inspection of local browser memory.

## Review map

- `packages/game-core/src/index.ts`: initialization, shared action validation, immutable FLIP/MOVE transitions, public events, `getObservation`, and `getLegalActions`.
- `packages/game-core/src/types.ts`: approved domain contracts, with readonly data throughout.
- `apps/web/src/game/deck.ts`: Fisher–Yates shuffle outside reducers/transitions; injectable random source for tests only, not a player-facing seed.
- `apps/web/src/game/session.ts`: pure reducer retaining the original deck and one accepted actor/action timeline; rejected operations preserve the session reference.
- `apps/web/src/game/interaction.ts`: React-owned selection reducer; routes destinations through the existing session without implementing game rules.
- `apps/web/src/hooks/useLocalGame.ts`: trusted-state boundary; memoizes public observations and exposes no full session to rendering components.
- `apps/web/src/components/Board.tsx` and `App.tsx`: public-only cells, coordinate labels, native buttons, color/turn labels, and minimal status feedback.

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
