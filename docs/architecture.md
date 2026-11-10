# Dark Chess — Architecture

**Version:** 0.12 — Phase 1.5 shared legality/outcome correction\
**Status:** Tasks 1–6 implemented; joint review and physical-device/hosted-CI acceptance pending\
**Scope:** Phase 1 implementation with future AI and multiplayer compatibility

Task 5 adds read-only Progressive Review; Task 6 adds relative text sizing, contrast/keyboard fixes, production-browser verification, CI configuration, and test-only long-game/tap measurement tooling. Game Core, GameAction, ActionResult, public events, observations, and the canonical session shape are unchanged. The owner-approved 2026-11-10 correction now applies NO_LEGAL_ACTION to chase-only immobilization; rejected attempts remain immutable. Physical-device/hosted-CI acceptance and joint owner review are pending.

## 1. Architecture Goals

The application should:

1. Separate game rules from rendering.
2. Keep game transitions deterministic and testable.
3. Support undo, history, and replay from a consistent action timeline.
4. Prevent hidden game information from leaking through player-facing contracts.
5. Allow AI players and remote players to reuse the same rules.
6. Avoid backend infrastructure and unnecessary abstractions in Phase 1.

## 2. Technology Stack

### Phase 1

| Layer           | Technology                       |
| --------------- | -------------------------------- |
| Language        | TypeScript                       |
| Frontend        | React + Vite                     |
| Styling         | Plain CSS / CSS Modules          |
| Game Engine     | Framework-independent TypeScript |
| Local State     | React reducer and custom hooks   |
| Unit Testing    | Vitest                           |
| E2E Testing     | Playwright                       |
| Package Manager | pnpm                             |
| CI              | GitHub Actions                   |
| Hosting         | Static web hosting               |

No backend, database, authentication, or external game service is required.

## 3. Repository Structure

```text
dark-chinese-chess/
├── AGENTS.md
├── README.md
├── docs/
│   ├── product-spec.md
│   ├── game-rules.md
│   ├── architecture.md
│   ├── phase-1-plan.md
│   ├── task-2-report.md
│   └── tasks/
│       ├── README.md
│       ├── task-1-workspace-first-flip.md
│       ├── task-2-movement-capture.md
│       ├── task-3-outcomes-chase.md
│       ├── task-4-history-undo-restart.md
│       ├── task-5-progressive-review.md
│       └── task-6-usability-verification.md
├── apps/
│   └── web/
│       ├── src/
│       │   ├── components/
│       │   ├── hooks/
│       │   └── styles/
│       └── package.json
├── packages/
│   └── game-core/
│       ├── src/
│       ├── tests/
│       └── package.json
├── package.json
├── e2e/
├── verification/
├── playwright.config.ts
├── playwright.performance.config.ts
├── .github/workflows/verify.yml
└── pnpm-workspace.yaml
```

Future modules should be created only when needed:

- `packages/ai-agents` in Phase 2
- `apps/server` in Phase 3

The tree includes the intended implementation layout and the owner's requested task documents. Use `phase-1-plan.md` as the overview and `tasks/README.md` as the task index; each task file owns its detailed acceptance criteria. Do not create further empty hierarchies, package-publishing infrastructure, or workspace orchestration.

## 4. Component Responsibilities

### 4.1 Game Core

Owns:

- Complete game state
- Game rules
- Legal action validation
- Deterministic state transitions
- Turn progression
- Game outcome evaluation
- Public player observations

Must not depend on:

- React
- Browser APIs
- UI components
- Network requests
- Database clients

### 4.2 Game Session / Controller

Owns:

- Current local game session
- Action submission
- Active action timeline
- Undo and restart
- Replay navigation
- Connecting UI events to Game Core

Game Session must not independently implement game rules. “Controller” describes this session coordination responsibility, not an additional required service or class. Small pure session operations and a React reducer/hook are sufficient.

The session combines the core observation with timeline-derived public history and captures. Only this projected session view is passed to rendering components. Core observations do not reconstruct history from a board.

### 4.3 React UI

Owns:

- Board rendering
- Piece rendering
- User interactions
- Selected-piece UI state
- History display
- Review controls
- Responsive layout and styling

UI must use the session's player-facing derived state as its source of truth. The trusted session holds full state, but rendering components receive no hidden identities or initial deck.

It must not independently determine move legality.

## 5. Domain Types

Task 3 preserves existing action/result shapes and adds the tracker below to authoritative state, plus the typed `PERPETUAL_CHASE` rejection code. Quiet MOVE now increments `noProgressCount`; FLIP/capture reset it. Public observations and action events deliberately omit the tracker.

```ts
type PlayerId = 'P1' | 'P2';
type PieceColor = 'RED' | 'BLACK';

type PieceRank = 'GENERAL' | 'ADVISOR' | 'ELEPHANT' | 'CHARIOT' | 'HORSE' | 'CANNON' | 'SOLDIER';

interface Piece {
  id: string;
  color: PieceColor;
  rank: PieceRank;
}

interface OccupiedSquare {
  piece: Piece;
  revealed: boolean;
}

type Square = OccupiedSquare | null;
type Board = readonly Square[]; // exactly 32 entries, validated at initialization
```

Each piece has a unique identifier, even when multiple pieces share the same color and rank.

Indexing is row-major: `row * 4 + column`, eight rows and four columns. Validate finite integer indices in 0–31. Calculate adjacency from row/column coordinates, not index difference alone. Copy input deck data so caller mutation cannot alter the session; transitions and observations must not expose writable aliases to authoritative state.

### GameAction

```ts
type GameAction =
  | {
      type: 'FLIP';
      position: number;
    }
  | {
      type: 'MOVE';
      from: number;
      to: number;
    };
```

Captures are represented by a MOVE into a legal occupied target.

### GameState

```ts
interface GameState {
  board: Board;
  currentPlayer: PlayerId;

  playerColors: Record<PlayerId, PieceColor | null>;

  status: 'ACTIVE' | 'FINISHED';
  result: GameResult | null;

  plyCount: number;
  noProgressCount: number;
  chase: ChaseState | null;
}

interface ChaseState {
  attackerPlayer: PlayerId;
  attackerId: string;
  targetId: string;
  phase: 'ESCAPE' | 'RENEW';
  positionCounts: Readonly<Record<string, number>>;
}
```

```ts
type GameResult =
  | {
      type: 'WIN';
      winner: PlayerId;
      reason: 'NO_PIECES' | 'NO_LEGAL_ACTION';
    }
  | {
      type: 'DRAW';
      reason: 'NO_PROGRESS';
    };
```

State invariants:

- Initially: `currentPlayer` is P1, both assignments are null, counts are zero, status is ACTIVE, and result is null. After the first flip, assignments are opposite and non-null.
- `plyCount` is the accepted action count. Every accepted action advances `currentPlayer`, even when terminal. Read the winner from `result`, never from the current player.
- ACTIVE implies a null result; FINISHED implies a non-null result. Only `applyAction` assigns outcomes. `getGameResult` only reads the stored result.
- Ordinary movement increments `noProgressCount`; a flip or capture resets it. Elimination, next-player lack of permitted actions including chase filtering, and no-progress are evaluated in that order after advancing the turn. An accepted ACTIVE state must have a permitted action.
- No general position-repetition state, hash, counter, or draw reason exists.

**Chase state:** Initialize `chase` to null. A pure `getChaseUpdate(before, tentativeAfter, action)` returns `{ prohibited, chase }`. Logical position keys use EMPTY/HIDDEN/revealed color-rank squares, next player, and assignments; physical IDs are used only for pair continuity. `positionCounts` counts the first threat and qualifying renewals within the current continuous chase. A fourth appearance of any key is prohibited, including later loops elsewhere after an initial rejection. This replaces the original single-anchor tracker following the owner's UI bug report. The map resets on a broken chain/flip/capture, is bounded by 60 quiet plies, and never counts general repetition. Include this private state in deterministic reconstruction/equality for future undo/Review, never public projections or an independent session/UI tracker.

Ordinary validation and the pure capture-threat helper are shared by chase and outcomes without calling the chase-aware engine recursively. One private permitted-transition path validates, tentatively moves/updates counters/turn, and rejects or records the chase update for both submission and enumeration. Only accepted `applyAction` then evaluates elimination, chase-aware immobilization, and no-progress in priority order and stores the result atomically. A rejected tentative transition creates no event/timeline entry and mutates no state.

No UI-specific state belongs inside GameState.

## 6. Full State vs Player Observation

### Full GameState

Includes all piece identities, including unrevealed pieces.

Access is restricted to the authoritative game engine and trusted game session.

### PlayerObservation — core projection

Exposes:

- Public board layout
- Revealed piece identities
- Face-down piece locations without identities
- Current player
- Player color assignments
- Game status and result

It deliberately does not include historical actions or a captured-piece list. Those belong to the session projection derived from the canonical timeline. In Phase 1 both players have identical public information, so no player ID is needed to generate the observation.

Proposed public square representation:

```ts
type PublicPiece = Pick<Piece, 'color' | 'rank'>;

type PublicSquare =
  | { kind: 'EMPTY' }
  | { kind: 'HIDDEN' }
  | {
      kind: 'REVEALED';
      piece: PublicPiece;
    };

interface PlayerObservation {
  board: readonly PublicSquare[];
  currentPlayer: PlayerId;
  playerColors: Record<PlayerId, PieceColor | null>;
  status: 'ACTIVE' | 'FINISHED';
  result: GameResult | null;
}
```

The observation projection must exclude hidden identities, not merely hide them visually.

Internal piece IDs are unnecessary in the player-facing model, even for revealed pieces. Hidden squares contain only `kind: "HIDDEN"`. Do not pass initial decks, shuffle seeds, full state, internal trackers, or concealed identities through component props, DOM attributes, accessibility labels, or public events. During active play, expose only accepted public events so far; completed Review intentionally exposes its complete public timeline alongside a separately projected historical board. Use square positions for board rendering keys. This is an application data boundary, not protection against a person inspecting full local browser memory.

In Phase 1, both players use the same device and the browser holds the full local state.

In Phase 3, the authoritative server must retain hidden identities and send only observations to remote clients.

## 7. Game Engine Contract

Baseline core operations:

```ts
createInitialState(deck: readonly Piece[]): InitialStateResult

getLegalActions(
  state: GameState,
  playerId: PlayerId
): GameAction[]

applyAction(
  state: GameState,
  playerId: PlayerId,
  action: GameAction
): ActionResult

getObservation(state: GameState): PlayerObservation

getGameResult(
  state: GameState
): GameResult | null
```

`ActionResult` is a discriminated result type:

- `{ ok: true, state: GameState, event: ActionEvent }`
- `{ ok: false, error: ActionError }`, with the caller retaining the previous state and timeline

`InitialStateResult` is `{ ok: true, state: GameState }` or `{ ok: false, error: { code: "INVALID_DECK" } }`. Initialization validates exact per-color composition, recognized colors/ranks, 32 entries, and unique nonempty IDs before producing a state. An invalid deck must not replace an existing session.

`getLegalActions` uses the same permitted-transition path as submission and returns an empty list for a non-current player or finished game. Outcome evaluation receives a lazy callback to the same chase-aware `getLegalActions` for NO_LEGAL_ACTION. Enumeration calls only permitted transitions, never outcome evaluation, so the dependency does not recurse. This is an internal helper change; GameAction, ActionResult, GameState, events, and observation contracts remain unchanged. Evaluate the accepted next-player candidate before marking it finished; do not use an already-finished state's empty list to infer the original outcome.

### Minimum public action event

```ts
type ActionEvent =
  | {
      ply: number;
      playerId: PlayerId;
      type: 'FLIP';
      position: number;
      piece: PublicPiece;
    }
  | {
      ply: number;
      playerId: PlayerId;
      type: 'MOVE';
      from: number;
      to: number;
      piece: PublicPiece;
      captured: PublicPiece | null;
    };
```

The event is produced only on success, with a one-based accepted-action number and the actor from before the turn advance. A FLIP exposes only the piece just revealed; a MOVE exposes its already revealed mover and, if captured, its already revealed target. Use `captured: null` for ordinary movement. No time, unique event ID, hidden identity, or initial deck is needed.

Events support display, but are not a second canonical log. Undo and replay need only the initial deck and accepted actor/action entries; replaying those entries through the core regenerates exactly the same public events. Captured-piece data is derived from capture events in the relevant prefix, not maintained independently.

The engine must validate actions independently. The UI must not be trusted to submit only valid actions.

### Determinism

- Randomly generate the initial deck outside the state-transition function.
- Validate deck composition before starting.
- Given the same initial deck and accepted action sequence, the engine must reproduce the same states.
- `applyAction` must not use time, network access, or uncontrolled randomness.
- State changes should be immutable.
- Do not run random initialization or rule transitions as side effects of rendering. A start/restart command creates a deck once for that command; reducer transitions remain deterministic.

## 8. History, Undo and Replay Architecture

### Key Decision

**Use one canonical action timeline for gameplay history, undo, and post-game replay.**

Avoid implementing three independent representations of historical state.

### LocalGameSession

Conceptual model:

```ts
interface LocalGameSession {
  initialDeck: Piece[];

  actions: Array<{
    playerId: PlayerId;
    action: GameAction;
  }>;

  currentState: GameState;
}
```

`initialDeck` and `actions` are the canonical replay inputs.

`currentState` is a cached result of applying the active timeline, not an independent source of truth.

During play, apply only the next accepted action to `currentState`. Reconstruct from the original deck for undo and Review navigation. A no-progress limit does not cap total game length because progress resets it; do not assume every timeline is short.

Derive a history prefix in a single pass, without reconstructing every earlier prefix separately. Avoid repeating this work on unrelated renders by using the session/timeline and cursor as dependencies. Do not implement snapshot caching, inverse undo operations, advanced event sourcing, workers, or speculative optimization. Revisit performance only after the lightweight measurements in `product-spec.md` identify a problem.

**Task 4 implementation:** `apps/web/src/game/reconstruct.ts` exports `reconstructGame(initialDeck, actions)`, returning `{ state, events }` from one fold. Invalid trusted replay input throws with the failing action number and Core error code rather than skipping it. Normal accepted play advances `currentState` incrementally. Undo reconstructs the retained prefix; public history is derived rather than retained as a second event log or snapshot cache. Task 5's combined projection below memoizes by the canonical session reference and Review cursor; selection/errors preserve that reference and do not trigger another fold.

### Normal Gameplay

1. User submits an action.
2. Controller calls Game Core.
3. Game Core validates and applies the action.
4. If successful, append to the active timeline.
5. Update current state and UI.
6. If invalid, retain the previous state and timeline.

In Task 3, a chase rejection is an invalid attempt at this boundary, not an accepted timeline entry or a loss. Apply domain state and its successful timeline append atomically; never leave one updated without the other.

### Undo

1. Remove the most recent accepted action from the active timeline.
2. Reconstruct the game state from the initial deck and remaining actions.
3. Restore turn, color assignments, counters, status/result, and all approved rule trackers, including the eventual chase tracker. Regenerate public history and captures from the remaining prefix.
4. Update the UI and history.

Undo does not randomize pieces again.

The undone action is no longer part of the active timeline.

After game completion, the session is read-only and undo is unavailable.

Undo is enforced at the session boundary as well as in the button state. Multiple undos may truncate the timeline to zero; a subsequent action starts a new continuation without preserving discarded actions. There is no redo or alternate-branch history.

### Restart

Request confirmation before replacing an active session. Canceling retains it unchanged; confirming creates a newly shuffled valid initial deck and clears all action/domain/UI state for that game. Completed-game restart may replace the session directly. An invalid initialization must preserve the old session. Refresh may reset the game; persistence is out of scope.

Task 4 adds internal `UNDO` and `RESTART { deck, confirmed }` session/interaction commands. The session rejects undo at zero actions or after completion and refuses an unconfirmed active restart. The hook generates the replacement deck once outside the reducer. Native HTML dialogs provide restart confirmation and read-only history, including Escape dismissal/focus restoration; Cancel performs no session command. Successful session replacement/undo clears selection and errors. Task 5 requires exiting Review before restart; its cursor is then null.

### History

History is a derived representation of accepted actions.

The display includes:

- Action number
- Acting player
- Flip or move
- Revealed piece
- Captured piece
- Source and destination for MOVE entries

Do not maintain a separate manually synchronized history state.

### Post-game Replay — Progressive Review

Replay uses:

- The original initial deck
- The final active action timeline
- A replay cursor ranging from 0 through the action count

Cursor 0 represents the initial face-down board.

Each subsequent cursor position represents one additional applied action.

Replay is read-only and must not mutate the completed game session.

At cursor `k`, reconstruct from exactly the first `k` accepted actor/action entries and project that state and its captured-piece summary. Per the owner's 2026-11-10 amendment, a separate read-only list displays the complete completed-game public events and selects any cursor. Cursor zero has the hidden initial board and no captures; later public events in the list do not affect its board, assignments, or result. Unrevealed piece identities never enter either projection. Boundary controls are disabled at 0 and N. The completed live session remains unchanged; exiting returns to its final projection.

Review is available only for a completed session. Review navigation never submits game actions. Clear selected-square UI state on accepted actions, undo, restart, and view changes.

**Task 5 implementation:** `BoardUiState.reviewCursor` is null for live play or an integer 0–N for Review. `OPEN_REVIEW` requires completion and starts at zero. `REVIEW_TO { cursor }` ignores invalid requests; `CLOSE_REVIEW` restores live view with selection/errors cleared. While the cursor is non-null, the interaction controller ignores all gameplay/undo/start/restart commands, independently of a historical observation's ACTIVE status. The canonical completed session reference never changes during navigation.

`game/review.ts` exports `projectSession(session, reviewCursor)`. It reconstructs only the selected action prefix and returns its public observation, public events, and captures together. In live mode, the observation uses incremental `currentState`; the event projection still uses the canonical timeline. `useLocalGame` memoizes the live public projection by session reference and the historical projection by session/cursor. Its `reviewHistory` is the completed live projection's public events, stable during seeking, rather than a second authoritative log. `ReviewHistory` displays those events in a bounded scrollable sidebar (below the board on narrow screens), highlights the cursor, and routes clicks through existing `REVIEW_TO`; the board/capture summary still use only the selected prefix. All exposed values remain public. `ReviewControls` and disabled Board cells enforce read-only UI behavior; the completed screen alone offers the Review entry. Invalid internal projection inputs remain observable programming errors; user navigation is validated before reaching projection.

## 9. State Ownership

### Authoritative Domain State

Owned by Game Core and local session.

Contains board positions, piece identities, turn, result, counters, and chase tracking sufficient for state-only submission/enumeration. The session retains this state and its one accepted timeline; it does not independently track chase history.

### UI State

Owned by React.

Examples:

- Selected square
- Current view (game or replay)
- Replay cursor
- History panel visibility
- Restart confirmation visibility

UI state must not modify domain state directly.

### Avoid Duplicate State

Do not independently store:

- A second board in React
- A manually maintained captured-piece list
- A separate history timeline
- A separate replay board

Prefer derived data and deterministic reconstruction. A temporary reconstructed state for a selected Review cursor is derived data, not a second editable game session. The session view combines a core observation, derived public action events, derived captures, and cursor/action-count information; it is not stored as an independent authority.

## 10. Error Handling

Examples of domain errors:

- `NOT_YOUR_TURN`
- `INVALID_SOURCE`
- `INVALID_DESTINATION`
- `ILLEGAL_MOVE`
- `INVALID_FLIP`
- `INVALID_ACTION`
- `GAME_FINISHED`

`ActionError` has a typed code from the list above plus `PERPETUAL_CHASE`. `INVALID_DECK` belongs to initialization. Ordinary validation errors take precedence over chase feedback; prohibited candidates are rejected before any outcome or counter commit. No chase loss reason exists.

Validate game status and actor, action shape and finite integer coordinates, movement/capture rules, then the approved chase restriction before committing changes. An error leaves the board, turn, counters, trackers, and timeline unchanged. Map errors to brief Traditional Chinese status text without hints or complex feedback UI.

Expected invalid user actions must not crash the application.

Domain validation errors should not be represented as unhandled exceptions.

Unexpected programming errors should remain observable during development rather than being silently ignored.

## 11. Testing Strategy

### Unit Tests — Game Core

Test the approved rules within the authorized task. Section 10's approved chase tests belong to Task 3; do not implement later behavior to expand Task 1 coverage.

Use table-driven cases for:

- Piece movement
- Capture ranking
- Cannon jumps
- Turn transitions
- Win/draw conditions
- Initial deck validation and input boundaries
- Terminal next-player convention and result-reason priority
- Repeated positions continuing without an automatic repetition draw

In Task 3, add the explicit chase classification, cycle threshold, reset, prohibition-only enforcement, and the eventual no-alternative case from `game-rules.md`, section 10. No general repetition draw/counter should be introduced. The owner approved chase-aware NO_LEGAL_ACTION on 2026-11-10.

### Property-based Tests

Verify:

- Piece count never increases during normal play.
- Board invariants remain valid.
- Invalid actions do not mutate state.
- Replay is deterministic.
- Undo correctly reconstructs the previous state.
- PlayerObservation never reveals hidden identities.
- Player assignments, rule counters, and all approved trackers agree at every reconstructed prefix.

A small seeded legal-action generator is sufficient initially; a large property-testing dependency or benchmark framework is not required. Check piece conservation including captures, not just a non-increasing board count.

### UI / Integration Tests

Verify:

- User interactions call the expected controller actions.
- UI matches the current game state.
- Selection does not alter domain state.
- History matches accepted actions.
- Undo and review display the correct positions.
- Invalid initialization/restart preserves the current session.
- Review shows the complete public completed timeline; board/result/captures match the selected prefix, and navigation cannot modify the final session.
- Session-level guards prevent undo after completion and Review before completion.

### E2E Tests

Use Playwright for a small number of important flows:

- Start a game.
- Flip a piece.
- Move or capture a piece.
- Undo an action.
- Restart.
- Complete a game and enter Review.
- Navigate forward and backward through history.

Use deterministic test-only decks and legal timelines for reliable coverage. Test plumbing must not expose a deck/seed or bypass validation in the production build. Run core tests in a non-browser environment, typecheck, build, and execute the small E2E suite in CI. Timing checks are recorded manually on the reference device, not enforced as flaky CI wall-clock tests.

Use the exact viewport, target-size, keyboard, contrast, and performance criteria in `product-spec.md`; do not maintain competing thresholds here. Manually check iPhone Safari and Android Chrome before Phase 1 acceptance, recording device/browser details. Failure to access a reference device is a reported verification gap, not a passing result.

**Task 6 execution:** `pnpm test:e2e` builds production output and runs 22 Chromium/WebKit checks against a self-managed preview server. `.github/workflows/verify.yml` configures install/typecheck/unit/build/E2E with read-only permission; hosted execution awaits an owner-authorized push. `verification/fixtures.ts` supplies legal 547/607-action inputs used only by tests. `pnpm verify:performance` records five samples per operation outside CI, using a production preview and browser click-to-two-frame timing. `verification/phone-check.js` is a standalone, test-only console procedure: normal UI clicks prepare the fixtures, then trusted user taps collect physical-device samples. None of this tooling is imported into production. See `docs/verification/` for host baselines, the acceptance audit, and pending physical-phone checks. No timing calls enter Game Core, and no snapshot cache or runtime dependency was added.

## 12. Future AI Integration

In Phase 2, introduce an agent interface when needed. The AI must receive player-visible information only, combining the core observation and public session history if needed. Do not implement agent classes, adapters, or model-serving contracts in Phase 1.

AI algorithms must not change the core rules or UI contracts.

More advanced agents may use simulations, heuristics, or separate model-serving systems.

The initial engine should not require such services.

## 13. Future Multiplayer Integration

In Phase 3:

- Introduce an authoritative game server.
- Keep complete hidden state on the server.
- Validate actions server-side.
- Send player observations to clients.
- Add sequencing, action IDs, and version checks.
- Support reconnect and state recovery.

Do not implement network abstractions in Phase 1 solely for hypothetical multiplayer needs.

## 14. Architecture Decision Principles

When making implementation decisions:

1. Prefer correctness over cleverness.
2. Prefer simple, testable modules.
3. Avoid speculative extensibility.
4. Use explicit contracts at module boundaries.
5. Add abstractions only when a concrete use case justifies them.
6. Document decisions that materially affect future work.

### Decisions Requiring Approval

- Changing game rules
- Changing public Game Core contracts
- Adding backend infrastructure
- Introducing large dependencies
- Replacing the chosen frontend framework
- Changing core persistence or replay semantics
- Changing the documented no-alternative chase policy or tracker contract beyond authorized additive Task 3 changes
- Deploying, pushing, or deleting files, as required by `AGENTS.md`

Small internal implementation decisions may be made within the authorized task. The owner authorized Task 6 for joint Tasks 5–6 testing. Core contracts and approved chase rules remain unchanged. Remaining physical-device/hosted-CI acceptance does not authorize publishing, committing/pushing, or later-phase implementation.

## 15. Phase 1 Architecture Acceptance

The architecture is acceptable when:

- [ ] Game Core runs without React or browser APIs.
- [ ] Game actions are validated consistently.
- [ ] Hidden information is redacted in observations.
- [ ] Undo reconstructs correct historical state.
- [ ] Replay reproduces the original game.
- [ ] UI has no duplicated game rules.
- [ ] Unit and E2E tests cover critical flows.
- [ ] No backend is required for the local MVP.
- [ ] No general repetition-draw state or behavior exists.
- [ ] Task 3 prohibition-only enforcement and tracker pass verification, including terminal resolution of the formerly ACTIVE/no-alternative position.
- [ ] Terminal next-player semantics and result priorities agree with `game-rules.md`.
- [ ] Core observations exclude history; the session derives history/captures from its one active timeline.
- [ ] Progressive Review projects the selected board/result/assignments/captures while its full public history supports direct step selection.
- [ ] No snapshot infrastructure or speculative network/agent abstractions are introduced.
