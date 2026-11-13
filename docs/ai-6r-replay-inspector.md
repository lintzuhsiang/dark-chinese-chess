# AI-6R — Tournament Replay Inspector

Run `pnpm dev` from the repository root, then open
`http://127.0.0.1:5173/replay` (use the port printed by Vite if different).
Choose a local schemaVersion 1 `ai-eval-v2` tournament JSON file. Nothing is uploaded
or saved in browser storage. Refreshing requires choosing the file again.

For an incident, open `/replay?seed=70000&leg=0&ply=6`, then import its tournament.
Legs are numbered 0 and 1. Ply 0 is the opening; ply K is the position after K
accepted actions. The selector lists both agents, seed, leg, length and recorded
outcome. A transcript can be completed, failed, truncated, or unavailable.
The recorded match outcome is distinct from the historical position result.

Use Start/Previous/Next/End, Play/Pause, speed, the slider, move rows, or either
jump form. URLs track the selected incident and can be copied to another developer;
the recipient must import the same file. Browser back/forward incident navigation
is supported; playback replaces the current URL rather than filling browser history.

The board, move details, inventory, material, counters and interval markers follow
the reached prefix. Future rows reveal only their ply numbers. Seeking backward
hides future identities again. Standard per-color/rank inventory is public; hidden
counts subtract reached FLIPs, and remaining counts subtract reached captures.
Weighted balances use each imported agent's complete positive `pieceValues` table
and include remaining hidden inventory. Different agent tables are labeled
separately; missing tables show **Not recorded.** This arithmetic is not an EV score.

Reversal markers compare a player's consecutive turns. Repeating patterns detect
consecutive matching blocks of 2–8 quiet MOVE actions. Long no-progress intervals
start at 20 plies. Last capture/FLIP markers refer to the reached prefix. These are
navigation aids and do not modify or adjudicate Core chase/repetition rules.

## Replay boundary and compatibility

The development entry point mounts the inspector separately from `App` and
`useLocalGame`. Its module and worker are removed from the production build.
The live-game board gains only an optional last-action highlight; omitted props
preserve its existing rendering. No AI policy or AI worker runs in the inspector.

The worker owns the imported original deck and private states. It initializes
with Core's `createInitialState`, submits every accepted actor/action to Core's
`applyAction`, checks generated events against recorded `publicHistory`, and
compares the final full state, outcome and length. Like the existing reconstruction
facility, it uses Core transitions exclusively; its separate coordination retains
the last valid prefix and reports import failures without throwing away that prefix.
Only `getObservation` output, reached events, public counters, and selected metadata
cross into rendering components. Raw decks, private piece IDs, final private boards,
and future events never enter the rendered view.

Both recorded Core revision fields must match the runner's existing pinned
`CORE_REVISION`. Recorded Core source/rules hashes must match the actual sources
captured by Vite. Core/rules edits restart the dev server to refresh this identity.
Missing/incompatible identities stop at ply 0. Bad actions/events stop at the exact
1-based ply; later actions are never skipped. A final-state mismatch reports the
terminal ply. Users can still seek within the validated prefix. Unstable-source
reports retain a visible provenance warning; successfully replaying recorded actions
does not establish reproducible AI execution for those reports.

`DecisionDiagnostics.tsx` is the optional per-ply display boundary for future
recorded diagnostic adapters. Existing reports supply only accepted decision time
(decision ply K−1 corresponds to accepted action K). EV scores, candidate rankings
and search traces explicitly show **Not recorded.** No analysis is recomputed.

## Performance and validation

Files up to 128 MiB are read and parsed inside a dedicated worker. Parsing still
requires memory proportional to the whole JSON; this is not a streaming importer.
Only selector metadata is examined across all matches. Core validation and state
storage are limited to the selected match, replaced on selection. Immutable selected
states make backward/forward seeking direct; memory is proportional to selected
plies × board/rule-state size. Each response contains only the reached public prefix.
Move rows are paginated to at most 80 DOM rows. This avoids replaying or rendering
every action in every match. Extremely long individual transcripts still require
proportional validation/memory; the import cap is not a constant-memory guarantee.

- `pnpm test` includes the replay model/public-render tests and existing Core/web tests.
- `pnpm test:replay` runs the development inspector in Chromium and WebKit, including
  the real 100-game benchmark, hidden information, captures, transport controls,
  incident URLs, malformed transcripts, and desktop/mobile board geometry.
- `pnpm test:e2e` exercises existing production gameplay/review and inspector exclusion.
- `pnpm verify:release` rejects inspector modules in production artifacts.
- Also run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm build`.

No new dependency, search/evaluation change, Core rule change, tournament result
change, commit, push, or deployment is part of this task.

### Executed verification — 2026-11-13

- `pnpm test`: 825 tests passed in 45 files, including 14 inspector tests.
- `pnpm test:replay`: all 6 browser checks passed in Chromium and WebKit, including
  the real 100-game `tactical-6a-vs-progress-6b-20261112-221918.json` import and
  seeking to its ply-349 NO_PROGRESS draw. Desktop 1280×900 and mobile 390×844
  screenshots were reviewed; assertions verify four columns, eight rows, minimum
  44-pixel board cells, and no horizontal overflow.
- Existing production E2E run: 53/56 passed initially. Two failures were trace
  cleanup collisions from concurrently using the same output directory, now
  prevented by the inspector's separate output directory. One WebKit automated
  phone-procedure check timed out while observing a short-lived live state. An
  isolated rerun of these cases plus the new production-exclusion check passed
  all 8 checks across both browsers. No gameplay changes were needed.
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, and
  `pnpm verify:release` passed. `git diff --check` passed. Core, AI-agent, runner,
  and benchmark-result files have no task changes.

Browser artifacts use `test-results-replay/`; existing production checks continue
to use `test-results/`. Automated mobile viewports do not constitute physical-device
testing. Import/seek benchmark observations are attached to the real-file browser
checks without timing-sensitive pass thresholds.

## Changed files

- `apps/web/src/replay/model.ts`: import validation, Core replay, public projection,
  inventory/balance, interval detection and incident parsing.
- `apps/web/src/replay/replay.worker.ts` and `protocol.ts`: local file/replay worker
  and typed messages; only selected-match public views leave the worker.
- `apps/web/src/replay/ReplayInspector.tsx`, `ReplayPosition.tsx`, `replay.css`:
  inspector controls, match/incident navigation, board, paginated move list and summaries.
- `apps/web/src/replay/DecisionDiagnostics.tsx` and `env.d.ts`: optional recorded
  diagnostics display boundary and development Core identity declaration.
- `apps/web/src/main.tsx`, `apps/web/src/components/Board.tsx`,
  `apps/web/vite.config.ts`: development-only entry, optional last-action marking,
  and actual Core source fingerprinting.
- `apps/web/tests/replay-fixtures.ts`, `replay-inspector.test.ts`,
  `e2e-replay/inspector.spec.ts`, `e2e/replay-exclusion.spec.ts`: fixtures, model/render
  tests, development browser checks and production exclusion checks.
- `playwright.replay.config.ts`, `package.json`, `tsconfig.json`, `.gitignore`,
  `.prettierignore`, `eslint.config.mjs`: dedicated browser-test command, type checks,
  and a separate ignored artifact directory to prevent cross-suite cleanup collisions.
- `verification/release-artifact.mjs`: asserts inspector code is absent from release artifacts.
- `docs/ai-6r-replay-inspector.md`: operation, implementation and validation notes.
