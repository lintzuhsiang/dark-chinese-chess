# Dark Chess — Product Specification

**Version:** 0.5 — Task 2 authorization  
**Status:** Tasks 1–2 complete; Tasks 3–6 not authorized  
**Target:** Phase 1 — Functional MVP

The owner has approved Task 2 in `phase-1-plan.md`: movement, capture, and board selection on top of the completed first-flip slice. Chase coverage and the three-completed-cycle threshold in `game-rules.md`, section 10 are approved, with move prohibition and no chase-induced loss. The no-alternative edge case remains open for Task 3. Outcomes, no-progress counter policy, and chase enforcement remain later work; do not silently count this increment as the completed MVP.

## 1. Product Vision

Build a modern, minimalist Chinese Dark Chess (台灣暗棋) web application.

The product should be simple to use, visually refined, and focused on the game itself rather than unnecessary visual effects.

The initial version supports two people playing on the same device. Future versions will introduce AI opponents and online multiplayer.

### Product Principles

1. **Simple but polished:** Minimal features, deliberate visual design.
2. **Game-first:** Prioritize rule correctness and usability.
3. **No unnecessary distractions:** Avoid animations, sounds, effects, and gameplay hints.
4. **Reviewable gameplay:** Support undo, move history, and post-game replay.
5. **Extensible:** Future AI and online players should reuse the same game rules.

## 2. Target Users and Platforms

### Primary Users

- Casual Chinese Dark Chess players
- Friends playing together on one device
- Mobile-first users

### Platforms

- Mobile web: iPhone and Android
- Desktop web
- Responsive browser interface

Initial language: Traditional Chinese.

Native mobile apps are not required.

## 3. MVP User Journey

### Start Game

1. User opens the application.
2. User selects "本機雙人".
3. A randomized board of 8 rows × 4 columns appears with all 32 pieces face-down.
4. Player 1 starts the game by flipping a piece.
5. The first revealed piece determines Player 1's color.

### During Game

Players alternate turns.

Each turn allows exactly one action:

- Flip a hidden piece.
- Move a revealed piece.
- Capture an opponent's revealed piece.

The interface displays:

- Current player and assigned color
- Game board
- Selected piece, if any
- Undo button
- Move history
- Restart option

The UI must not display suggested moves, threatened pieces, or strategy recommendations.

### End Game

When the game ends:

1. Display the winner or draw result and its reason from `GameResult`. Do not infer the winner from `currentPlayer`.
2. Provide "重新開始".
3. Provide "覆盤".
4. Allow players to review the completed game step by step.

## 4. MVP Functional Requirements

### FR-01: Game Initialization

- Generate a valid randomized set of 32 pieces.
- Place all pieces face-down.
- Initialize Player 1 as the starting player.
- Ensure a new game is independent of the previous game.
- Validate the initial deck before starting: exactly 32 uniquely identified pieces, valid colors/ranks, and the documented distribution for each color. Invalid initialization must return a typed failure and must not replace an existing session.
- Generate the shuffled deck outside deterministic state transitions. A newly shuffled deck may coincidentally have the same ordering; tests must not require inequality with the previous board.

### FR-02: Board Interaction

- Tapping a hidden piece flips it when permitted.
- Tapping an eligible revealed piece selects it.
- Tapping a destination attempts a move or capture.
- Tapping the selected piece again deselects it.
- Tapping another revealed friendly piece switches selection. Tapping a hidden piece always attempts FLIP, even when another piece is selected; a successful flip clears selection and advances the turn. With a piece selected, empty squares and revealed enemies are MOVE/capture attempts. Selection itself consumes no turn and exposes no legal-move hints.
- Invalid actions must not change the game state.
- Board positions use row-major indices 0–31: `index = row * 4 + column`, with rows 0–7 and columns 0–3. Reject non-integer or out-of-range positions; adjacent indices across a row boundary are not adjacent squares.
- Use tap/click or keyboard activation; dragging and gesture controls are not required. One activation submits at most one game action.
- Clear selection after an accepted action, undo, restart, or view change. An invalid attempt may retain selection but must preserve the domain state and timeline.
- If an attempted action is rejected, use a brief Traditional Chinese message in the existing status area, without suggesting an alternative move. No additional feedback effects are required.

Do not display legal-move indicators or animated transitions.

### FR-03: Turn and Game Status

- Advance `currentPlayer` to the next player after every accepted action, including a terminal action.
- Show whose turn it is.
- Display player colors after the first flip.
- Detect win, loss, and draw according to `game-rules.md`.
- Evaluate elimination, then absence of the next player's ordinary legal actions, then the 60-ply no-progress draw. Results identify the winner explicitly. Chase prohibitions do not themselves trigger a loss; the no-alternative edge case remains open for Task 3.
- Repeated board positions alone never cause a draw. Perpetual chasing uses the approved coverage/threshold and prohibition-only policy in `game-rules.md`, section 10; its implementation belongs to Task 3.
- On completion, display the result rather than inviting the next player to act.

### FR-04: Undo

- Support undoing the most recent accepted action during local play.
- Undo must restore the exact previous board, turn, captured pieces, counters, player assignments, and all approved rule-tracking state, including perpetual-chase tracking once its semantics are approved.
- Undo may reverse a flip, move, or capture.
- Undo must be deterministic.
- Undo is disabled when no previous action exists.
- Undo is not available after game completion; use Review instead.
- Repeated undo is allowed until no accepted actions remain. There is no redo feature. A new action after undo continues from the truncated timeline.

**Fairness note:** Undoing a flip does not erase knowledge of the revealed piece. This is accepted in the local casual MVP. Online multiplayer will have a separate undo policy.

### FR-05: Move History

- Record every accepted action in chronological order.
- Show the acting player and action type.
- For flip actions, show the revealed piece.
- For moves, record source and destination.
- For captures, show the captured piece.
- Keep move history synchronized with the current game.
- If an action is undone, remove it from the active move timeline.
- Game Session owns the canonical timeline. Derive displayed events and captures from accepted actions; do not independently maintain a second history or require the current-board observation to reconstruct it.

History is read-only during gameplay. It does not provide move navigation or suggestions.

### FR-06: Post-game Review

After a completed game, players can:

- Open a replay of the completed game.
- Start at the initial hidden board.
- Move forward one action.
- Move backward one action.
- Jump to the first or final position.
- View the corresponding action number and history prefix.
- Exit Review and return to the completed game screen.

Use **Progressive Review**. At cursor `k`, render the board after the first `k` accepted actions and display only those `k` history entries. Cursor 0 has the initial hidden board and empty history. Cursor `N` has the completed position and all `N` active entries. Exclude undone actions at every cursor.

The replayed board must match the actual board at every historical step, including which pieces were hidden at that time. Future flips, captures, assignments, and the final result must not leak into an earlier replay projection. Hidden piece identities must be absent from rendered data, accessibility labels, and attributes, not merely concealed visually.

Review is unavailable during active play. Review controls cannot submit game actions or mutate the completed session. Exiting Review returns to the unchanged completed position.

AI analysis, annotations, and move recommendations are out of scope.

### FR-07: Restart

- Start a new game with a newly randomized board.
- Reset the current game state and its active history.
- Ask for confirmation before discarding an unfinished game.
- Previous games do not need to be saved in Phase 1.
- Canceling confirmation preserves the current session. Confirming restart clears history, selection, review cursor, result, and all rule trackers, and returns to Player 1 with unassigned colors. Starting from the completed game screen does not require an unfinished-game confirmation.

## 5. Visual Design Requirements

### Design Direction

**Minimalist, modern, restrained, and visually polished.**

Suggested visual identity:

- Warm neutral background
- Subtle board boundaries
- Distinct red and dark chess pieces
- Consistent spacing and typography
- Clear information hierarchy
- Clean, simple controls
- No decorative game effects

Avoid:

- Gradients used only for decoration
- Glowing pieces
- Complex backgrounds
- Bouncing or sliding animations
- Sound effects
- Confetti or celebration effects
- Move hints or strategic overlays

A selected piece may use a simple static border or contrast change to make selection state clear.

### Responsive Layout

- Prioritize portrait-mode mobile layout.
- Keep all 32 cells visible and usable.
- Avoid accidental touches on adjacent cells.
- Provide a clean desktop layout without excessively stretching the board.
- Ensure the board fits common phone screen widths.
- Verify CSS viewports of 320×640 and 390×844 in portrait, and 1280×800 on desktop. At these default-zoom sizes, all 32 cells and essential turn/action controls must fit without page scrolling or overlap. History may use a bounded scroll area or a separate panel.
- No horizontal page scrolling at these sizes. Each board cell and primary control must offer a touch target of at least 44×44 CSS pixels.
- At increased text size or 200% zoom, vertical scrolling is acceptable; preserve readable content, usable controls, and access to every square.

### Accessibility

- Maintain readable contrast and text sizes.
- Use clear labels for actions.
- Support Tab/Shift+Tab focus and Enter/Space activation for all board cells and controls, with visible focus and no keyboard trap. A custom arrow-key grid is not required.
- Do not communicate important state through color alone.
- Provide Traditional Chinese labels identifying coordinates and public piece information; a hidden square's label must not disclose its piece. Announce turn, result, and rejection messages through the existing status area.
- Use a minimum contrast ratio of 4.5:1 for normal text and 3:1 for essential control boundaries and focus indicators against adjacent colors.

## 6. Non-functional Requirements

### Correctness

- All accepted actions must satisfy game rules.
- Game state must remain consistent after undo and replay.
- Invalid interactions cannot corrupt the game.
- No automatic draw may be triggered by general board repetition. Perpetual-chase behavior must match the approved definition and prohibition-only policy, not an inferred repetition substitute or a chase-induced loss.

### Performance

- Normal board interactions should feel immediate on modern phones.
- Game rules must not require network calls.
- Replay navigation should not noticeably freeze the interface.
- Avoid unnecessary dependencies and expensive rendering.
- Maintain incremental current state while playing; reconstruct for undo and Review navigation. Do not recompute history or reconstructed positions on unrelated UI renders.
- Check a short game and a deterministic legal timeline of at least 500 accepted actions, containing progress actions that avoid the no-progress limit. On a recorded reference phone/browser, target a median of at most 100 ms from activation to visible update over five attempts each for an ordinary action, undo, and a Review jump. Record measurements; do not introduce a timing-sensitive CI benchmark.
- Use active prefixes for action/undo measurements and a completed version of the fixture for Review; do not enable Review on an active game for benchmarking.
- Start without snapshot caching or advanced event-sourcing infrastructure. Investigate and measure a failure before proposing optimization.

### Reliability

- Local games run without a backend.
- Board state and history share one authoritative local game session.
- A page refresh may reset the game in MVP.
- Persistence across sessions is deferred.

## 7. Out of Scope

The following are explicitly excluded from Phase 1:

- AI opponent
- Online multiplayer
- Authentication and profiles
- Matchmaking or ranking
- Saved game library
- Cloud synchronization
- AI move analysis
- Move hints
- Animations and audio
- Custom game themes
- Native mobile applications
- Redo and in-game replay navigation
- General threefold-repetition draws

## 8. Acceptance Criteria

Phase 1 is complete when:

- Two people can finish an entire valid local game.
- The board is usable on mobile and desktop.
- All moves and captures follow the documented rules.
- Undo correctly restores the previous state.
- History displays the accepted action sequence.
- After-game Review reproduces every historical position.
- Restart produces a clean new game.
- Invalid actions cannot corrupt game state.
- The interface follows the minimalist design direction.
- Automated rule tests and basic E2E tests pass.
- Terminal turn/result behavior and removal of general repetition draws are verified.
- The remaining no-alternative chase decision is resolved and all chase acceptance tests pass; an approved specification alone is not implemented behavior.
- Progressive Review exposes only the selected history prefix and corresponding public state.
- The viewport, touch, keyboard, hidden-data, and lightweight performance checks above are recorded.

## 9. Future Roadmap

### Phase 2 — AI Opponent

- Multiple AI strategies and difficulties
- Measurable AI performance
- AI vs AI evaluation

### Phase 3 — Online Multiplayer

- Private rooms
- Invite links
- Real-time synchronization
- Reconnection and authoritative server state

### Phase 4 — Advanced Features

- Saved games
- AI-powered review
- Player statistics
- Rankings and matchmaking

Future features must not delay the functional MVP.
