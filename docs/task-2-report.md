# Task 2 — Implementation and Multi-Agent Review

**Status:** Implemented and verified locally; independent owner review pending  
**Date:** 2026-11-09 (Asia/Taipei)  
**Scope:** Movement, capture, selection/destination interaction, and legal-action enumeration only

**Subsequent owner UX amendment:** Hidden-piece taps now submit FLIP even while another piece is selected. A successful flip clears selection and advances the turn. The verification/timing sections below record the original Task 2 run; their selected-hidden-target rejection steps are historical and superseded by this amendment. Current behavior is specified in `product-spec.md` and the README.

Amendment verification: typecheck, 340 tests across five files, and production build passed. Added/updated regressions cover both colors, exactly one FLIP/turn, clearing selection and prior error feedback, unchanged source/prior state, and redaction of all other hidden pieces. No new browser-smoke result is claimed for this follow-up.

## Result and contracts

The reported revealed-piece flip error is resolved: friendly revealed pieces select, deselect, or switch selection instead of submitting FLIP. Following the owner's UX amendment, hidden-piece taps always attempt FLIP; selected empty/revealed targets attempt MOVE. Success clears selection; failure preserves selection, domain state, turn, and accepted timeline. Empty cells are enabled destinations. The interface retains whose turn it is after all pieces reveal.

Game Core implements all seven ordinary movement ranks, normal capture ranking, General/Soldier exceptions, and Cannon capture over exactly one occupied screen. Submission and enumeration share one private validator. MOVE results and public events retain the approved shapes, including the pre-advance actor, one-based ply, source/destination, public mover, and public captured piece or null. Public types and the session contract are unchanged.

The full state remains authoritative in the session; rendered components receive only observations. Selection is React-owned state in a small pure reducer wrapping the existing session reducer. There is no second board, rule implementation, captured list, or displayed history in the UI.

Task 3 policy is intentionally absent: MOVE preserves the stored noProgressCount; existing FLIP reset remains. No outcomes, draw thresholds, chase tracker, undo, history display, replay, restart, AI, or multiplayer were added.

## Actual delegation and ownership

All three specialists were created with actual Codex delegation. They shared the checkout; no isolated worktree was assumed.

| Agent | Owned work | Observed interval, UTC+08:00 |
|---|---|---|
| Main /root | Contract alignment, root/docs, integrated review, checks, native browser smoke, final report | Measured checkpoint interval 13:48:00 to 14:35:17 |
| A /root/core_engineer | Writes only packages/game-core/: validator, transitions, enumeration, core tests | 13:48:37–13:52:47; 4m10s |
| B /root/frontend_engineer | Writes only apps/web/: selection reducer, UI wiring, markup, interaction tests | 13:48:53–13:53:10; 4m17s |
| C /root/qa_reviewer | Read-only source/test review and separate in-memory oracle/integration probes | 13:49:04–13:57:27; 8m23s including waiting |

Core and frontend implementation overlapped by 3m54s. Their combined observed work intervals total 8m27s within a 4m33s shared window. This demonstrates concurrent work; no controlled sequential run exists, so a precise speedup or cost saving is not claimed.

Contracts were sent before delegation: existing MOVE/Result/Event shapes, public-only observations, session timeline ownership, selection routing, invalid-action semantics, and the Task 3 boundary. No incompatible interfaces or overlapping file writes were found. Frontend could implement and run existing checks before Core finished, then waited for Core before its final integration tests. Neither specialist's implementation responsibility was reassigned.

Both implementation agents explicitly stopped edits at handoff. Main subsequently added two QA-recommended tests to the core test file; no simultaneous agent edits occurred. QA edited no source, tests, configuration, or documentation.

## Verification evidence

Commands used the existing pnpm installation via PATH=/private/tmp/dark-chess-toolchain/node_modules/.bin:$PATH.

| Check | Actual result |
|---|---|
| Agent A: pnpm exec vitest run packages/game-core/tests | 309 passed in 2 files before Main's two added regressions |
| Agent A: pnpm --filter @dark-chess/game-core typecheck | Exit 0 |
| Agent B: pnpm exec vitest run apps/web/tests | 27 passed in 3 files |
| Agent B: pnpm --filter @dark-chess/web typecheck | Exit 0 |
| Main: pnpm typecheck | Exit 0; root tooling, core, web, and tests |
| Main: pnpm test | 338 passed in 5 files after both final added regressions |
| Main: pnpm build | Exit 0; 23 modules, production output in apps/web/dist/ |
| Main: git diff --check -- apps packages | Exit 0 |
| Existing scripts: pnpm run | Only dev, typecheck, test, build; no lint/format scripts |
| ESLint / Prettier | Not configured or executed; no pass claimed and no new dependencies introduced |

The original Task 1 coverage is retained. Its obsolete assertion that MOVE is unavailable now checks that its still-hidden source returns INVALID_SOURCE. This reflects the new feature rather than weakening rejection or immutability tests.

Native Safari smoke verification passed on the actual randomized board:

- Start with 32 hidden cells, assign P1 Black / P2 Red on first flip, alternate later flips.
- Select/deselect a friendly revealed Horse without an already-open error or consumed turn.
- Reject a selected hidden destination without revealing it; deselect and flip it normally.
- Reject Black General at index 5 capturing Red Soldier at 6, preserving turn/selection.
- Switch to Black Elephant at 3 and capture Red Soldier at 2: source empties, target becomes the Elephant, selection clears, P2 is next.
- P2 Red Horse at 7 moves to empty index 3: source empties, target updates, selection clears, P1 is next.
- Screenshot inspection showed the complete 32-cell board and no move hints.

The Chrome extension's navigation/new-tab path failed before page interaction; native Safari was the successful fallback. No production test deck, seed endpoint, hidden-state inspection, or validation bypass was used for browser smoke. The owned local server is stopped after verification.

## Independent QA findings

No functional defect or public contract mismatch was confirmed. QA executed:

- 108,356 action decisions against a separately encoded rank/coordinate/occupancy oracle.
- 5,372 accepted cases with board, turn, event, piece-count, and deep-frozen-input invariants.
- Exhaustive comparison of 1,056 candidates on 64 mixed boards with enumeration equality and no duplicates.
- Hidden-identity permutation invariance of observations and legal actions on all 64 boards.
- 32 malformed cases including NaN, infinities, strings, BigInt, and Symbol.
- A separate seven-accepted-action UI/session/core sequence including a Cannon capture over a hidden screen, P2 empty-square movement, selection switching, rejection, and flipping.
- SSR checks for 32 enabled native buttons, accessible empty cells, exactly one selected state, and public-only data.

The oracle command printed a non-fatal sandbox WebSocket-bind warning from its in-memory Vite SSR loader. Every assertion executed and it exited 0 with PASS; this was not browser coverage.

QA suggested permanent regression coverage for P2 capture and hidden-identity permutation, which its temporary probes already exercised. Main added both and reran typecheck and the complete suite. No implementation fix was needed after handoff.

## Integration lessons and measurements

Main's integrated full suite first passed before browser testing. Shared contracts and exclusive ownership avoided interface rework and write collisions. The main integration work was reviewing boundaries, updating obsolete Task 1 scope documentation, persisting QA coverage recommendations, and independently checking the live interaction.

Measured wall interval from contract-alignment checkpoint to this report checkpoint: **47m 17s**, ending **2026-11-09 14:35:17 UTC+08:00**. Main's integration/review/verification window from 13:53:21 to the checkpoint was **41m 56s**. These include waiting and tool latency, not just active coding.

A native browser acquisition tool call stalled for **2,047.8 seconds (~34m08s)** after implementation and automated checks had completed. This dominated total latency; it is not application runtime or agent coding time. The agent intervals above are recorded separately from Main's stalled call. Browser fallback ultimately passed.

No further conversational approval or clarification was requested after the initial Task 2 authorization. Token usage and execution cost were not available and are not estimated.

## Human review guide and remaining limits

- [Core validator](../packages/game-core/src/validation.ts): integer/boundary checks, rank exceptions, Cannon geometry/screens; one path shared by submission/enumeration.
- [Core transitions](../packages/game-core/src/index.ts): immutable source removal/target replacement, actor/turn/ply, public event projection, and legal-action enumeration.
- [UI interaction reducer](../apps/web/src/game/interaction.ts): ownership-only selection, destination dispatch, domain-session preservation after rejection, and selection clearing after success.
- [React hook](../apps/web/src/hooks/useLocalGame.ts) and [Board](../apps/web/src/components/Board.tsx): trusted-state/public-props boundary, enabled empty cells, and accessible static selection.
- [Core regressions](../packages/game-core/tests/movement.test.ts) and [UI integration tests](../apps/web/tests/interaction.test.ts): rank matrix, Cannon screens, exhaustive enumeration, redaction, and real accepted-action sequences.

ESLint/Prettier remain unavailable; actual mobile devices, full Phase 1 E2E coverage, and long-timeline performance checks remain Task 6 work. Outcomes/no-progress/chase remain Task 3, including the unresolved all-actions-chase-prohibited case. This is a completed Task 2 increment, not the completed Phase 1 game.

No commits, pushes, deployments, destructive operations, public contract changes, or new dependencies were performed. Stop here for the owner's independent review; do not begin Task 3.

