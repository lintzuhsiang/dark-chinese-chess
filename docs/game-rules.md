# Dark Chess — Game Rules

**Version:** 0.8 — Approved chase-aware immobilization correction\
**Ruleset:** Taiwanese Banqi — Project Ruleset  
**Status:** Task 3 implemented; owner review pending

Task 3 implements outcomes, counters, and the simplified chase house rule under the owner's 2026-11-09 authorization to choose a narrow deterministic interpretation. General repetition never causes a draw. Chase prohibits a third qualifying return. On 2026-11-10 the owner approved treating zero chase-permitted actions as NO_LEGAL_ACTION, superseding the earlier prohibition-only/no-alternative limitation. Tasks 4–5 add session-level undo, history, restart, and read-only Progressive Review without changing these rules. This is a project-specific ruleset, not a universal tournament standard.

## 1. Board and Pieces

### Board

- 8 rows × 4 columns
- 32 squares
- Each square contains zero or one piece.
- Pieces occupy squares, not intersections.
- No diagonal adjacency.
- Coordinates are zero-based: rows 0–7 and columns 0–3. A square index is `row * 4 + column`, from 0 through 31. Indices must be finite integers; reject missing, fractional, negative, or out-of-range positions rather than coercing them.
- Orthogonal adjacency means a Manhattan distance of exactly one in row/column coordinates. For example, indices 3 and 4 are not adjacent.

### Piece Distribution

Each color has 16 pieces.

| Rank     | Red | Black | Count per Color |
| -------- | --- | ----- | --------------- |
| General  | 帥  | 將    | 1               |
| Advisor  | 仕  | 士    | 2               |
| Elephant | 相  | 象    | 2               |
| Chariot  | 俥  | 車    | 2               |
| Horse    | 傌  | 馬    | 2               |
| Cannon   | 炮  | 包    | 2               |
| Soldier  | 兵  | 卒    | 5               |

Total: 32 pieces.

### Starting Position

- Randomly shuffle all 32 pieces.
- Place one piece face-down on each square.
- No pieces start captured.
- Player 1 takes the first turn.
- Colors are initially unassigned.
- The supplied deck must contain exactly the distribution above, valid ranks/colors, and a unique nonempty identifier for every piece. Invalid decks fail initialization without creating or replacing a game.
- The no-progress counter and accepted-action count start at zero. There is no general board-repetition counter.

## 2. Color Assignment

- The first action must flip a hidden piece.
- Player 1 receives the color of that piece.
- Player 2 receives the opposite color.
- Color assignments remain fixed for the game.
- Flipping a piece of either color is permitted on later turns.

## 3. Turn Rules

Each player performs exactly one action per turn.

Allowed actions:

1. `FLIP`
2. `MOVE` (to an empty square)
3. `MOVE` (capturing an opponent's piece)

Rules:

- After every accepted action, including one that ends the game, advance `currentPlayer` to the other player.
- `currentPlayer` records who would act next, not who won. Only `GameResult` identifies the winner.
- Passing is not allowed.
- Only the current player can act.
- Invalid actions do not consume a turn.
- No actions are accepted after the game ends.

## 4. Flipping a Piece

A flip is legal when:

- The target square is within the board.
- The square contains a face-down piece.
- The game is active.
- The acting player has the current turn.

Effects:

- The target piece becomes face-up.
- Its position does not change.
- The current turn ends.
- The no-progress counter resets.

A flipped piece cannot immediately move during that same turn.

## 5. Normal Movement

A move to an empty square is legal when:

- The source contains a revealed piece belonging to the acting player.
- The destination is empty.
- The destination is orthogonally adjacent.
- Source and destination are different squares.
- Both positions are within the board.

All seven piece types, including Cannon, use one-square orthogonal movement when not capturing.

There is no diagonal movement.

## 6. Normal Captures

A normal capture requires:

- A revealed attacking piece belonging to the current player.
- An orthogonally adjacent revealed enemy piece.
- A valid rank relationship.
- The capturing piece must not be a Cannon.

### Rank Order

From highest to lowest:

General > Advisor > Elephant > Chariot > Horse > Cannon > Soldier

Normally, a piece can capture a revealed enemy piece of equal or lower rank.

### Exceptions

**General:**

- Cannot capture Soldier.

**Soldier:**

- Can capture General.
- Can capture Soldier.
- Cannot capture other piece types.

**Cannon:**

- Does not use normal adjacent capture.
- Uses the special cannon capture rule below.

Pieces cannot capture friendly pieces.

Face-down pieces cannot be captured.

## 7. Cannon Capture

A Cannon can capture an enemy piece regardless of rank if all conditions hold:

1. The Cannon is revealed and belongs to the acting player.
2. The target is a revealed enemy piece.
3. Source and target share the same row or column.
4. Exactly one occupied square lies strictly between source and target.
5. Every other square between source and target is empty.

The intervening piece (screen) may be:

- Friendly or enemy
- Revealed or hidden
- Any rank

The target must be revealed.

The Cannon moves directly to the target square and removes the captured piece.

### Important Restrictions

- No adjacent capture by Cannon.
- No capture with zero intervening pieces.
- No capture with two or more intervening pieces.
- No capturing hidden targets.
- No chain captures.
- No diagonal capture.

## 8. Captures and Piece Removal

After a valid capture:

- The attacking piece occupies the target square.
- The captured piece is removed from the board.
- The capture is added to the game history.
- The no-progress counter resets.
- The turn always passes to the other player, including when this capture ends the game.

Captured pieces never return during normal gameplay.

Undo is a local session feature and can restore a previous position.

## 9. Game End Conditions

### Win / Loss

After an accepted action, the next player loses if they have no remaining pieces, counting both revealed and hidden pieces. The acting player wins with reason `NO_PIECES`.

Otherwise, the next player loses if they have no permitted action, with reason `NO_LEGAL_ACTION`; the acting player wins. Include chase filtering in this loss check. Evaluate the candidate next-player state after an accepted action, before marking it finished. A rejected attempt does not itself advance or adjudicate the game.

While any face-down pieces remain, flipping one is a legal action, so lack of movable revealed pieces alone is not a loss.

Capturing General does not automatically end the game.

### Draw — No Progress

A draw occurs after 60 consecutive individual actions (plies) without a flip or capture.

- Ordinary movement increments the counter by one.
- Flipping resets the counter to zero.
- Capturing resets the counter to zero.

Approved automatic draws are `NO_PROGRESS` and chase-only `CHASE_STALEMATE` (section 10). Three or more occurrences of any board position do not themselves end the game. Do not maintain a general repetition counter or use position repetition as a proxy for prohibited chasing.

### Outcome Priority

For each submitted action, validate first and evaluate outcomes only after acceptance:

1. Validate ordinary legality, construct an immutable tentative transition, and check chase prohibition before committing it. A rejected attempt stops here without changing any authoritative state or timeline.
2. Apply the move or flip, including first-flip assignments and capture removal. Increment accepted-action count; increment no-progress count for a non-capturing MOVE, or reset it for a FLIP/capture. Update approved chase tracking atomically with the accepted action.
3. Advance `currentPlayer` to the next player, regardless of whether a result follows.
4. If the next player has no pieces, finish with the acting player as winner and reason `NO_PIECES`.
5. Otherwise, if the next player has no ordinary legal move/capture/flip before chase filtering, finish with the acting player as winner and reason `NO_LEGAL_ACTION`.
6. Otherwise, if every ordinary action is chase-prohibited, draw with `CHASE_STALEMATE`.
7. Otherwise, if the no-progress counter is at least 60, draw with `NO_PROGRESS`.
8. Otherwise, retain active status and a null result.

A win takes precedence over a no-progress draw triggered by the same accepted action. `NO_PIECES` takes precedence over `NO_LEGAL_ACTION`. A finished state retains the next player in `currentPlayer`, rejects further play, and has no legal actions.

## 10. Perpetual Chasing (長捉) — Chase v4

The current approved specification is [Chase v4](chase-v4-spec.md), approved
2026-11-12. Older Task 3 and v3 records are historical only.

A qualifying threat is an otherwise legal non-capturing MOVE by revealed A
creating an ordinary capture threat against revealed enemy B that A could not
capture before the MOVE, where B cannot capture A afterward. Use ordinary
rank/Cannon geometry, including hidden screens as occupancy only. Reciprocal
attacks, maintained attacks, discovered attacks by another mover, captures and
FLIPs do not qualify. The first qualifying threat counts immediately, and every
qualifying fork target counts independently.

The key is the same physical A/B plus both post-move coordinates. In the inclusive
20-ply window `[p-19, p]` containing the candidate action p, prohibit the third
qualifying appearance of that key. Different coordinates count separately;
whole-board arrangement and other fork targets do not change a key. Any fork
target violation rejects the whole action with `PERPETUAL_CHASE`.

All accepted actions advance the window. Waiting moves, FLIPs and unrelated
captures do not directly clear records. There is no PASS, permanent exhausted
pair, support certificate, witness or revalidation. Ordinary legal captures
always bypass chase prohibition. Rejected attempts leave state, counters,
turn, accepted history and records unchanged. Enumeration uses the same rules.

Undo and replay reconstruct v4 from accepted actions; restart clears all records.
Only v4 replay is supplied: fail explicitly at any v4-illegal action, without
skipping it or claiming a truncated replay succeeded. Keep historical versions,
original replays and benchmark results intact for their corresponding old Core.

If ordinary legal actions exist but all are chase-filtered, finish with
`DRAW / CHASE_STALEMATE`. Preserve the priority `NO_PIECES` → ordinary
`NO_LEGAL_ACTION` → `CHASE_STALEMATE` → `NO_PROGRESS`. Do not add a draw
for being unable to force a win. Repetition alone is never a terminal rule.

## 11. Invalid Actions

The engine rejects actions such as:

- Moving a face-down piece
- Moving an opponent's piece
- Moving outside the board
- Moving diagonally
- Moving into a face-down or friendly occupied square
- Capturing a stronger piece illegally
- Capturing a hidden piece
- Performing an invalid Cannon jump
- Supplying malformed actions or non-integer/out-of-range board positions
- Acting out of turn
- Acting after game completion

Rejected actions:

- Do not modify the board.
- Do not update turn counters.
- Do not change the current player.
- Do not create history records.
- Do not change chase tracking, counters, turn, or result, including when a prohibited candidate would otherwise reach a draw threshold.

## 12. Test Scenarios — Approved Baseline

| Scenario                                                                                   | Expected Result                                                      |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| First flip reveals Red Horse                                                               | Player 1 becomes Red                                                 |
| Player 2 flips a Red piece                                                                 | Legal                                                                |
| Chariot captures Horse                                                                     | Legal                                                                |
| Horse captures Chariot                                                                     | Illegal                                                              |
| General captures Soldier                                                                   | Illegal                                                              |
| Soldier captures General                                                                   | Legal                                                                |
| Soldier captures Cannon                                                                    | Illegal                                                              |
| Cannon captures adjacent piece                                                             | Illegal                                                              |
| Cannon jumps one screen to capture General                                                 | Legal                                                                |
| Cannon jumps one hidden screen to capture                                                  | Legal, if target is revealed                                         |
| Cannon jumps two screens                                                                   | Illegal                                                              |
| Cannon captures a face-down target                                                         | Illegal                                                              |
| Any piece moves diagonally                                                                 | Illegal                                                              |
| Flip an already revealed piece                                                             | Illegal                                                              |
| Ordinary move into empty adjacent square                                                   | Legal                                                                |
| Attempt to move when not current player                                                    | Illegal                                                              |
| 60 consecutive quiet moves                                                                 | Draw                                                                 |
| Same public position occurs three times without a chase violation or another end condition | Continue; no repetition draw                                         |
| All opponent pieces captured                                                               | Acting player wins with `NO_PIECES`; `currentPlayer` is the opponent |
| Next player has no movable revealed pieces but a hidden piece remains                      | A flip is legal; no immobilization loss                              |
| Next player has pieces but no permitted action, including after chase filtering            | Acting player wins with `NO_LEGAL_ACTION`                            |
| Winning move also reaches 60 quiet plies                                                   | Win takes priority over draw                                         |
| Move attempted after game end                                                              | Illegal                                                              |
| Invalid initial piece distribution or duplicate/missing ID                                 | Typed initialization failure; preserve any existing session          |
| Move from index 3 to 4 as if adjacent                                                      | Illegal                                                              |
| Position is negative, fractional, missing, or 32                                           | Illegal; unchanged state and timeline                                |

Section 10's chase scenarios remain regression tests. The no-alternative regression now verifies the 2026-11-10 owner-approved use of the existing NO_LEGAL_ACTION outcome, not a new result type.

## 13. Excluded Variants

Phase 1 does not support:

- Regional alternative rank orders
- Cannon blind-capturing hidden pieces
- Multi-piece or chain captures
- Broader chase adjudication beyond the eventual approved section 10 rule
- Competition clocks
- Resignation or mutual draw agreements
- Configurable custom rules

These can be introduced as separate rulesets later.

General threefold-repetition draws have been removed from this ruleset. Perpetual-chase enforcement is a Task 3 requirement, not an excluded feature and not a general repetition rule.

**Rule changes must be reviewed before implementation.**
