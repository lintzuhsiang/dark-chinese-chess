# Dark Chess — Game Rules

**Version:** 0.7 — Task 3 house-rule clarification\
**Ruleset:** Taiwanese Banqi — Project Ruleset  
**Status:** Task 3 implemented; owner review pending

Task 3 implements outcomes, counters, and the simplified chase house rule under the owner's 2026-11-09 authorization to choose a narrow deterministic interpretation. General repetition never causes a draw. Chase prohibits a third qualifying return without inducing a loss; the no-alternative limitation is stated below. Task 4 adds session-level undo, history, and restart without changing these rules; Review remains later work. This is a project-specific ruleset, not a universal tournament standard.

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

| Rank | Red | Black | Count per Color |
|---|---|---|---|
| General | 帥 | 將 | 1 |
| Advisor | 仕 | 士 | 2 |
| Elephant | 相 | 象 | 2 |
| Chariot | 俥 | 車 | 2 |
| Horse | 傌 | 馬 | 2 |
| Cannon | 炮 | 包 | 2 |
| Soldier | 兵 | 卒 | 5 |

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

Otherwise, the next player loses if they have no ordinary legal action, with reason `NO_LEGAL_ACTION`; the acting player wins. For this loss check, evaluate ordinary move/capture/flip legality before chase filtering: chase prohibitions must not themselves trigger a loss. Section 10 describes the limited case where ordinary actions exist but every one is chase-prohibited.

While any face-down pieces remain, flipping one is a legal action, so lack of movable revealed pieces alone is not a loss.

Capturing General does not automatically end the game.

### Draw — No Progress

A draw occurs after 60 consecutive individual actions (plies) without a flip or capture.

- Ordinary movement increments the counter by one.
- Flipping resets the counter to zero.
- Capturing resets the counter to zero.

The only approved automatic draw condition is `NO_PROGRESS`. Three or more occurrences of any board position do not themselves end the game. Do not maintain a general repetition counter or use position repetition as a proxy for prohibited chasing.

### Outcome Priority

For each submitted action, validate first and evaluate outcomes only after acceptance:

1. Validate ordinary legality, construct an immutable tentative transition, and check chase prohibition before committing it. A rejected attempt stops here without changing any authoritative state or timeline.
2. Apply the move or flip, including first-flip assignments and capture removal. Increment accepted-action count; increment no-progress count for a non-capturing MOVE, or reset it for a FLIP/capture. Update approved chase tracking atomically with the accepted action.
3. Advance `currentPlayer` to the next player, regardless of whether a result follows.
4. If the next player has no pieces, finish with the acting player as winner and reason `NO_PIECES`.
5. Otherwise, if the next player has no ordinary legal action, finish with the acting player as winner and reason `NO_LEGAL_ACTION`. Do not infer this loss solely from an empty chase-filtered action list.
6. Otherwise, if the no-progress counter is at least 60, finish with a draw and reason `NO_PROGRESS`.
7. Otherwise, retain active status and a null result.

A win takes precedence over a no-progress draw triggered by the same accepted action. `NO_PIECES` takes precedence over `NO_LEGAL_ACTION`. A finished state retains the next player in `currentPlayer`, rejects further play, and has no legal actions.

## 10. Perpetual Chasing (長捉) — Simplified House Rule

### Approval record and limited scope

The owner authorized this minimal single-pair interpretation in Task 3, including logical board-value comparison, physical-pair identity, and prohibition without a chase-induced loss. This is deliberately narrower than comprehensive pursuit or tournament adjudication.

Use a minimal **single-attacker, single-target closed chase cycle**. It follows actual renewed capture threats and evasions by the same two revealed pieces. It does not classify ordinary shuffling, general position repetition, or strategic intent as chasing. Longer-term pursuit that never closes a cycle remains subject to the 60-ply no-progress rule.

### What constitutes a chase

For this rule, a direct capture threat means that one revealed piece could capture the other under the ordinary rank/Cannon geometry and occupancy rules. Evaluate that relationship independent of whose turn it currently is and independent of the chase restriction. Do not call full outcome evaluation or recursive chase-aware legal-action enumeration to determine a threat.

A qualifying chase starts when:

1. A player makes an otherwise legal non-capturing MOVE with a revealed piece, the attacker.
2. That MOVE creates a direct capture threat against exactly one eligible revealed enemy target that this attacker could not capture immediately before the MOVE.
3. The target cannot directly capture the attacker in the resulting position. Reciprocal threats, including equal-rank mutual attacks, are excluded from this minimal rule.

Only newly threatened, non-reciprocal targets count toward the exactly-one test. Captures, flips, discovered threats by another piece, and ambiguous multiple eligible targets do not start this tracker. Cannon threats use the approved screen rules, including hidden screens; no hidden target identities are inspected to classify a chase.

Record the attacker's player and internal piece ID, the target's internal piece ID, and that the defender must escape next. Start a chase-local appearance count of one for the logical public-position key immediately after this first threat. IDs identify the same physical pair; they are excluded from position keys and public events.

### Evasion, renewal, and cycle counting

Continue the same chain only through this alternating sequence:

- **Escape:** The defender immediately makes a non-capturing MOVE with that exact target, and the tracked attacker can no longer directly capture it afterward.
- **Renewal:** The attacker immediately makes a non-capturing MOVE with that exact attacking piece, creating a new, non-reciprocal capture threat against that exact target. It must again be the only eligible newly threatened target.

After each qualifying renewal, count the appearance of its logical public-position key within this continuous chase. Encode every square as EMPTY, HIDDEN, or revealed color/rank, followed by the next player and both assignments in fixed order. Exclude all IDs, hidden rank/color, counters, tracker data, status, and result. A repeated key completes a return to that position; the qualifying route may differ. Physical IDs still determine whether the same attacker/target continued the chain. Count only the first threat and qualifying renewals, never ordinary repetition or the defender's escapes.

**Approved threshold:** Each distinct threat position begins at zero completed returns on its first appearance. Accept its first and second completed returns. Reject the attacker's candidate renewal that would complete its third return, the fourth qualifying appearance. Do not count the first appearance as a completed cycle. The owner clarified after UI testing that a chase moving to other squares and repeating a different pattern must also trigger a later prohibition; counting only the original threat position misses that case.

Example using a Red Chariot and a Black Horse, with other pieces stationary and no additional eligible targets: anchor Chariot at index 1 and Horse at index 5, with the Horse's player next. The four actions `Horse 5→4; Chariot 1→0; Horse 4→5; Chariot 0→1` complete one cycle. Two such cycles are accepted. In the third cycle, the final `Chariot 0→1` is the prohibited candidate. The defender's escapes are never penalized as the chase violation.

If the attacker instead renews with `Chariot 0→4` after that rejection, the continuous chase can move to a new loop: `Horse 5→9; Chariot 4→8; Horse 9→5; Chariot 8→4`. The first two returns to this new threat position are allowed; the third loop's final `Chariot 8→4` is prohibited even though the original anchor never returns. A rejected attempt does not erase earlier qualifying appearances in the same continuous chase.

### Resets and invalid attempts

- A FLIP, capture, different mover/target, failure to escape, failure to renew, reciprocal threat, or ambiguous eligible targets breaks the tracked chain. The accepted action clears the old tracker; if that same action independently qualifies as a new first chase, it may seed a fresh tracker with zero cycles.
- Qualifying returns do not reset appearance counts. A renewal at a new position starts that position's count at one while preserving other counts in the same chain. These counts are bounded by the 60-quiet-ply rule and are discarded when the chain breaks; no general game-wide repetition table exists.
- Rejected attempts do not advance or reset tracking, consume a turn, increment counters, or create history. Undo reconstructs tracking from the remaining accepted timeline. Restart clears it.
- Chase tracking and the no-progress counter are different mechanisms. Quiet escapes/renewals still increment no-progress count; a tracker reset alone does not reset that counter.

### Enforcement and no-alternative limitation

Prohibit the candidate renewal with a typed `PERPETUAL_CHASE` rejection, preserve the prior state/timeline, and require the player to choose a different permitted action. A short message such as 「長捉，請改走其他步。」 is sufficient; do not suggest moves. An attempted chase violation does not produce a loss or a new result reason.

`getLegalActions` must exclude the prohibited candidate, but this filtering must not itself trigger `NO_LEGAL_ACTION`. The owner's prohibition-only decision supersedes the previous recommendation to lose when all otherwise legal actions are chase-prohibited.

Under the owner's instruction to retain a narrow rule rather than invent adjudication, ordinary actions existing but all being chase-prohibited leaves the game ACTIVE with an empty permitted-action list. Attempts remain rejected; no loss, pass, draw, or exemption is invented. A separately triggered no-progress draw still applies after an accepted action. This rare position can therefore stall local play; it is a known house-rule limitation requiring a future owner decision, not an implicit forfeiture. Task 3 includes a Cannon-cycle regression for this case.

### Required Task 3 tests

- Direct threat versus unrelated repeated positions; no automatic general repetition draw.
- General/Soldier exceptions and Cannon screens in threat classification; hidden targets excluded.
- Non-reciprocal versus reciprocal threats, multiple eligible targets, and different physical pieces of the same rank/color.
- Each position starts at zero returns; first and second returns accepted; third-return candidate rejected with exact state/timeline unchanged. Exercise the example above, a different qualifying route, and a later loop on other squares after the first rejection.
- A non-closing pursuit does not trigger this prohibition; the normal 60-ply draw still applies.
- Every listed reset, fresh-chain seeding, and rejected-attempt behavior.
- Legal-action enumeration excludes the prohibited candidate; alternatives remain playable; rejection and filtering never themselves cause a loss. When no permitted alternative exists, preserve ACTIVE/result-null and the previous state on rejection.
- Undo before/after cycle boundaries restores the exact tracker; undo followed by a different action cannot inherit discarded cycles; replay deterministically reproduces accepted positions and trackers.

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

| Scenario | Expected Result |
|---|---|
| First flip reveals Red Horse | Player 1 becomes Red |
| Player 2 flips a Red piece | Legal |
| Chariot captures Horse | Legal |
| Horse captures Chariot | Illegal |
| General captures Soldier | Illegal |
| Soldier captures General | Legal |
| Soldier captures Cannon | Illegal |
| Cannon captures adjacent piece | Illegal |
| Cannon jumps one screen to capture General | Legal |
| Cannon jumps one hidden screen to capture | Legal, if target is revealed |
| Cannon jumps two screens | Illegal |
| Cannon captures a face-down target | Illegal |
| Any piece moves diagonally | Illegal |
| Flip an already revealed piece | Illegal |
| Ordinary move into empty adjacent square | Legal |
| Attempt to move when not current player | Illegal |
| 60 consecutive quiet moves | Draw |
| Same public position occurs three times without a chase violation or another end condition | Continue; no repetition draw |
| All opponent pieces captured | Acting player wins with `NO_PIECES`; `currentPlayer` is the opponent |
| Next player has no movable revealed pieces but a hidden piece remains | A flip is legal; no immobilization loss |
| Next player has pieces but no ordinary legal action | Acting player wins with `NO_LEGAL_ACTION`; chase filtering alone cannot trigger this |
| Winning move also reaches 60 quiet plies | Win takes priority over draw |
| Move attempted after game end | Illegal |
| Invalid initial piece distribution or duplicate/missing ID | Typed initialization failure; preserve any existing session |
| Move from index 3 to 4 as if adjacent | Illegal |
| Position is negative, fractional, missing, or 32 | Illegal; unchanged state and timeline |

Section 10's chase scenarios are Task 3 acceptance tests. The no-alternative case verifies the explicit limited behavior above; it does not authorize a new end condition.

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
