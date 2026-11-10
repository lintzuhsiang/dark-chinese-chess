# Tasks 5–6 — Owner and Physical-Device Checks

Automated checks are recorded in [the Task 6 report](task-6-results.md). Physical-phone results and a hosted CI run are still pending; browser emulation does not complete those requirements.

## Open a production test session

From the repository root:

```sh
pnpm build
pnpm --filter @dark-chess/web exec vite preview --host 0.0.0.0 --port 5188 --strictPort
```

On the computer, open `http://127.0.0.1:5188/`. On a phone on the same network, use the computer's LAN IP and port 5188. This is a local verification server; stop it with Ctrl+C when finished. Use a fresh test tab: refresh resets this MVP's game.

Record the actual device model, OS, browser/version, and CSS viewport. Do not label desktop Chromium/WebKit or a simulated phone viewport as a physical-device result.

## Gameplay and Review

Run on both iPhone Safari and Android Chrome:

1. Start 「本機雙人」. Check 32 hidden cells, unassigned colors, and Player 1. Confirm the whole board and essential controls fit the screen at normal text size. Record the actual CSS viewport if it differs from 320×640 or 390×844.
2. Flip a piece: assignments become opposite and the turn advances. Select/switch/deselect your revealed pieces. With a selection active, tap a hidden piece: it should flip directly and clear selection.
3. Attempt an invalid move/capture: feedback appears, but the board, turn, and history stay unchanged. Make a legal ordinary move/capture when available; empty destinations remain tappable.
4. Undo a move/capture/flip. Confirm restoration of the board and actor. Undo to zero: hidden pieces return to their original squares, assignments clear, and undo becomes unavailable. Re-flipping an undone piece reveals the same identity; undo does not reshuffle.
5. Open 「棋譜」. Check action numbers/actors, flip identities, move coordinates, and captured pieces. Scroll a long list inside the dialog; close with 「返回棋盤」 or Escape when a keyboard is available.
6. Select a piece, open restart, then Cancel. Selection, history, and board must remain. Confirm restart and check a clean hidden game. Do not require a new shuffle to differ by permutation.
7. Finish a game, or use the test-only procedure below. Check the result and unavailable undo. Restart from the completed screen should be immediate.
8. Enter 「覆盤」: zero has a hidden board, unassigned colors, and empty history. Step forward/back and jump to opening/final. The complete public history stays visible; select step 1, then step 30, then another earlier step and check the resulting board/current-row highlight. Its captured-piece summary, assignments, and result must match the selected position; future public events in the list must not reveal pieces on the earlier board. On desktop the list sits to the right; on phones it sits below in a bounded scroll area. Board taps must do nothing throughout Review. Exit to the unchanged completed game.
9. Check native browser zoom at 200% and increased text size. Vertical scrolling is allowed; every square, control, and dialog must remain readable and reachable. Restore normal size afterward. With a keyboard, also check Tab/Shift+Tab, Enter/Space, visible focus, dialog dismissal, and focus return.

Automated scenarios separately cover Cannon rules, outcome priority, third-return chase rejection (including a later pattern), and undo of chase resets. The approved no-alternative chase position can remain ACTIVE without permitted actions; no extra loss/pass/draw is invented.

## Five-sample physical-phone timing procedure

The [standalone console script](../../verification/phone-check.js) prepares legal games through normal UI actions, then waits for **trusted taps**. It is not shipped in the production bundle and never replaces domain state directly.

1. Open a fresh dedicated test tab at the entry screen. Connect its usual Safari/Chrome remote developer console.
2. Paste the complete contents of `verification/phone-check.js` into that console.
3. Start it with your actual device details:

   ```js
   await runPhoneVerification('device model / OS version / browser version');
   ```

4. Keep the phone tab in the foreground. Wait while it prepares the short game. For each of five prompts, tap the empty square **第 2 列，第 2 欄** (the Horse is preselected), then tap **悔棋** when prompted.
5. It completes the game and opens Review. Tap **終局** five times as prompted; it returns to the opening between samples.
6. It repeats the procedure with **547 accepted actions**, completing at **607 actions**. Do not interact while it prepares the fixture. The script checks action counts and stops on unexpected gameplay; refresh the dedicated tab to retry.
7. Copy the resulting `phoneVerificationReport` from the console:

   ```js
   JSON.stringify(phoneVerificationReport, null, 2);
   ```

The report includes all five samples and medians for ordinary action, undo, and Review jump in both games. Timing begins at click activation and ends after two animation-frame callbacks, allowing an intervening paint; selection/setup and automation round-trip time are excluded. The target median is ≤100 ms for each operation. This is a browser paint estimate, not a hardware display measurement. No timing threshold is enforced in CI.

The procedure itself has automated Chromium/WebKit coverage, including the real 547-action position at 320×640. Those procedure checks are not physical-phone measurements.

## Acceptance record — fill after testing

| Check                                                   | iPhone Safari | Android Chrome |
| ------------------------------------------------------- | ------------- | -------------- |
| Device / OS / browser version                           | Pending       | Pending        |
| CSS viewport / normal layout / touch targets            | Pending       | Pending        |
| Gameplay / invalid feedback / undo / restart            | Pending       | Pending        |
| History / Progressive Review / exit                     | Pending       | Pending        |
| Native 200% zoom / larger text / reachability           | Pending       | Pending        |
| Keyboard / focus / accessibility labels where available | Pending       | Pending        |
| Short action / undo / Review medians; five samples each | Pending       | Pending        |
| Long action / undo / Review medians; five samples each  | Pending       | Pending        |
| Defects / observations                                  | Pending       | Pending        |

Hosted CI execution is also pending. After the owner authorizes committing/pushing, record the run URL and outcome for `.github/workflows/verify.yml`. The local workflow file and matching local command passes do not constitute a hosted run. Phase 1 acceptance remains pending these checks and owner review, including acceptance of the existing no-alternative chase limitation or a separately approved policy change.
