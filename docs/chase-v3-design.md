# Perpetual Chase v3 — Updated owner decisions and design review

**Specification approved2026-11-12. Implementation started and is paused at the measured performance gate; see [implementation status and optimization proposal](chase-v3-implementation.md).**

The review and verification record below describes the pre-implementation design snapshot; it is not the current completion status.
Starting HEAD is `76fed95`; the unchanged Core/rules pin is
`b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75`. Existing uncommitted AI-6A work and
old-rules artifacts remain intact. This document proposes a replacement for the
current rule; `game-rules.md` remains authoritative until an approved migration.

The owner's updated requirements **supersede all three earlier questions**:

- Reset unexhausted partial pursuit after an objectively defined interruption.
- Preserve exhausted physical-pair history, while allowing narrowly certified new
  coordinated attacks; a helper move never simply clears that history.
- Allow initial forks and track each newly eligible relationship independently.
  This proposal uses initial usage1 per relationship, including fork candidates.
- Provisionally use `CHASE_STALEMATE` only if every ordinary action is removed
  specifically by chase filtering; preserve all alternatives and terminal priority.

The recommended exception below buys **one additional threat**, not a fresh
unrestricted episode. It uses a one-use, geometry-verified support certificate.
This is a new proposed detail for final approval, not an already authorized rule.

## 1. Current failures reproduced before redesign

Run current-rule evidence independently of any AI policy:

```sh
node_modules/.bin/vitest run scripts/ai-eval/tests/chase-v3-diagnostics.test.ts
node --import ./scripts/ai-eval/register.mjs ./scripts/ai-eval/chase-v3-diagnostics.ts
```

All nine fixtures begin with a distribution-valid, fully hidden32-piece deck.
Every listed action is accepted by current `applyAction`; every public branch
matches the private result/event; every complete prefix replays exactly. No
synthetic capture ledger, manually injected tracker, policy choice, or future v3
rule engine is used. `benchmark-results/chase-v3-diagnostics.json` retains all
per-ply tracker transitions and exact moves, with trusted internal tracker IDs.
Those IDs are never supplied to an Agent or returned by public projection.

Notation: `F5` means FLIP5; `0>1` means MOVE0→1. Positions are row-major,4 columns.
Named pieces: A=Red Chariot initially0, B=Black Horse initially5;
C=the other Red Chariot initially20, D=the other Black Horse initially25.

The common19-action opening **P** clears squares through actual captures:

```text
F0 F1 0>1 F4 1>0 F20 0>4 F21 20>21 F24 21>20 F5
20>24 F25 24>20 F31 4>0 F30 0>1
```

Its fixed deck entries are A0, B5, C20, D25, Black Soldiers1/4/21/24/31,
Black Cannon30 and Red Horse29. The existing deterministic `arrangedInitial`
helper fills every other square from the remaining valid inventory.
At P's end, A1 threatens B5 (usage1). `5>4;1>0` is B's escape and A's
second threat. Call that21-action prefix **Q**: under v3 it must already record
exhausted A→B, although both accepted threats were legal.

| Failure                             | Exact continuation / fixture  | Actual current transition                            | Intended v3 effect                                     |
| ----------------------------------- | ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| Third qualifying appearance allowed | P + `(5>4 1>0 4>5 0>1)` twice | Anchor count1→2→3; final MOVE accepted               | Appearance3 forbidden under position limit             |
| Changing-board same-pair pursuit    | S below + `5>6 1>5 6>2 5>6`   | Same physical pair, three different keys each count1 | Third pair threat forbidden despite new board          |
| Initial fork ignored                | F(2) below                    | A0→1 threatens B5 and Soldier2; tracker remains null | Initial fork allowed; candidate pairs registered       |
| Renewed fork clears pursuit         | F(9) + `5>4 1>5`              | ESCAPE→RENEW→null; targets4 and9                     | Preserve original B relationship and its usage         |
| C→D erases exhausted A→B            | Q + `4>5 20>21 25>24 0>1`     | A→B usage2 → C→D → A→B fresh count1                  | Final A0→1 forbidden                                   |
| FLIP erases history                 | Q + `4>5 F29 25>24 0>1`       | FLIP clears tracker; final A→B count1                | Exhausted A→B survives; final renewal forbidden        |
| Unrelated CAPTURE erases history    | Q + `25>24 20>24 4>5 0>1`     | C captures D; tracker cleared; A→B fresh count1      | Capture of D cannot clear A→B; final renewal forbidden |

These are **current-rule prefixes**, not promises that every earlier action would
be accepted under v3. In the third-appearance fixture, the pair limit would reject
an earlier MOVE: A's third total threat at P + the first full cycle. The final
count3 isolates the old position threshold; do not pretend v3 can reach it through
that entire prefix. Repeated fork positions/interrupted episodes independently
exercise position records when a continuous pair counter is not sufficient.

Opening **S**, used for three distinct threat boards, fixes Red Chariot0, Black
Horse5 and Black Soldiers1/2/4/6, then deterministically fills the rest:

```text
F0 F1 0>1 F4 1>0 F2 0>4 F6 4>0 F31 0>1 F30 1>2 F29
2>6 F28 6>2 F27 2>1 F26 1>0 F5 0>1
```

Opening **F(t)** fixes Red Chariot0, Black Horse5, Black Soldiers1/4/t and
Black General31:

```text
F0 F1 0>1 F4 1>0 Ft 0>4 F5 4>0 F31 0>1
```

Controls: Q + `25>24 0>4` accepts A's direct capture of B. Replacing A with a
Red Horse in P and repeating the four-action loop three times yields reciprocal
Horse threats, no qualifying new targets, and no tracker. Ordinary repetition
alone is not a chase and must remain legal before the separate quiet limit.

The7 focused diagnostics pass. They assert **current** behavior and must be
intentionally migrated/versioned when v3 is approved, not mistaken for v3 acceptance
tests or left to accidentally prohibit the requested change.

## 2. Public geometry and qualifying threats

Use the existing authoritative `isCaptureThreat` / ordinary movement semantics,
including General/Soldier exceptions, Cannon screens and hidden blockers. No hidden
target identities, deck IDs in public input, strategic-intent inference or duplicate
movement engine is permitted. Definitions ignore turn/outcome/chase only where
explicitly stated, so they cannot recursively call full `applyAction`.

For a revealed piece A's ordinary non-capturing MOVE, let:

- `E` be all revealed enemy physical targets A can capture afterward that cannot
  capture A back under ordinary geometry.
- `N` be members of E that A could not capture immediately before this MOVE.
- A qualifying attack has nonempty N. Each member starts/continues its own pair.
  A fork has at least two eligible targets; newly threatened members are seeded,
  while maintained `E minus N` relationships consume no new usage.

Captures, FLIPs, reciprocal threats, maintained threats alone and discovered attacks
by a piece other than the mover do not consume pursuit usage. They retain their
ordinary legality unless the mover independently creates another prohibited quiet
pursuit. In particular, C moving does not spend A's allowance just because C's move
changes A's line of attack. Direct legal captures always bypass chase filtering.

A pair is `(attackerPlayer, physicalAttacker, physicalTarget)`. Moving squares does
not change it; equal-ranked pieces are distinct. Position records use:

```text
(attackerPlayer, physicalAttacker, sorted all-E physical targets,
 resulting public board values, nextPlayer, assigned colors)
```

Board values are EMPTY/HIDDEN/revealed color+rank, without hidden values, IDs,
counters, history or result. Physical references scope the record separately from
board values. Count once per qualifying mover action, not once per fork target.
Use all E, not just N, so another arrival route cannot split the same fork key.
Accept appearances1/2; reject appearance3, regardless of support certificates.
General board repetition and a defender's escape are not qualifying appearances.

## 3. Minimal persistent ledger and transient state

Keep the `GameState.chase` field, replacing its internal single-pair representation:

```text
activePairs[pair] = { phase: AWAIT_ESCAPE | AWAIT_RENEW, uses: 1 | 2 }
exhaustedPairs[pair] = { spentSupportWitnesses: sorted set<Witness> }
qualifyingPositions[scopedPositionKey] = 1 | 2
pendingSupport[pair] = {
  helper, from, to, earnedPly, eligibleWitnesses: sorted set<Witness>
}
Witness = DIRECT(helper) | ESCAPE(helper, destinationSquare)
```

Presence in exhaustedPairs means exhausted; do not also store a duplicate exhaustion
boolean or lifetime counter. `activePairs` and `pendingSupport` are transient.
The exhausted map and its spent witnesses persist even when active maps are empty.
Use deterministic immutable JSON-safe records/arrays, not sets with serialization
ambiguity. No second authoritative Session/AI chase ledger is introduced.

A second accepted threat inserts exhaustedPairs immediately with an empty spent set.
Waiting, target switching, FLIPs and unrelated captures never remove that entry.
A certificate exception adds spent witnesses; it never deletes exhaustion or resets
uses to1. Capturing A or B removes their pair entry; capturing a helper does not
refund its spent witnesses for surviving A/B. Restart clears everything; Undo
rebuilds the exact earlier accepted prefix.

Qualifying position records survive quiet interruptions. They may be pruned on
FLIP/capture because a full logical public board cannot recur after the hidden mask
or piece count irreversibly decreases. This pruning never clears exhausted pairs
or spent support. Position records therefore cover at most the current60-quiet-ply
interval. All history-sensitive state remains derived from accepted actions.

## 4. Exact state machine

All rows describe a tentative otherwise ordinary-legal action. Commit **only if all
relationships, position limits and other ordinary checks pass**.

| Accepted event                                                                | Active state                                            | Persistent effect                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| First qualifying threat A→B                                                   | AWAIT_ESCAPE, uses1                                     | Record qualifying appearance                                                      |
| Initial fork against B and D                                                  | Seed A→B and A→D independently at1                      | One fork-position appearance; initial fork is legal                               |
| Exact B immediately makes a quiet escape outside A's capture reach            | A→B becomes AWAIT_RENEW, same usage                     | No charge to A; no restriction inherited from A's ledger                          |
| Same A immediately renews against B in N                                      | Increment previous usage; AWAIT_ESCAPE                  | At usage2, insert exhausted entry on this accepted action                         |
| Qualifying N includes an already exhausted A→B, with or without continuity    | Require the certificate in §5; retain uses2 if accepted | Spend certificate witnesses; never erase prior exhaustion                         |
| Renewal adds another target D                                                 | Preserve B's existing usage/ban; seed only fresh D at1  | D cannot launder B's history; validate every N member atomically                  |
| Any other accepted action fails that pair's expected immediate escape/renewal | End that active episode; its unexhausted usage1 resets  | Exhaustion and position records persist                                           |
| Helper C makes a permitted quiet MOVE                                         | C's own relationships are evaluated normally            | It may earn pending support for exhausted A/B, but moving alone grants nothing    |
| FLIP or CAPTURE                                                               | Interrupt active episodes                               | Preserve unrelated exhausted pairs; prune only unreachable keys/dead-member pairs |
| Invalid/prohibited attempt                                                    | No change                                               | No event, turn, counter, pending expiry, usage or witness consumption             |

An interruption is structural, not inferred intent: the next accepted action is
not the required exact-target quiet escape, or the following action is not the
same attacker's immediate qualifying renewal. Another target's escape can preserve
its own fork relationship while another pair expires. An escape that is itself a
new offensive threat can seed the defender's separate pair without deleting the
pursuer's persistent entries. A capture is not a quiet escape but remains legal.

Inspect exhaustedPairs for **every pair in N**, even when activePairs is empty.
A new fork must not overwrite an exhausted pair with a fresh count. A quiet action
renewing multiple exhausted pairs needs a valid certificate for each. Reject the
whole candidate if any pair or its scoped position limit fails; consume nothing.

The pursuer's history can never prohibit the defender's escape. If the defender's
move independently renews its own exhausted attack on a third piece, its own rule
still applies. This is distinct from charging the escape to its pursuer's ledger.
Waiting moves are permitted unless they independently violate the waiting piece's
own chase/position restrictions. There is no blanket ban on another piece moving.

## 5. Conservative definition of a new coordinated attack

### 5.1 What can be proved without deeper search

Geometry can prove that a helper has newly added an immediate capture threat, or
removed an immediately safe refuge. It cannot prove a forced win, lasting strategic
improvement, or that the defender must choose a particular reply. A subjective
"useful move" test is unsuitable for a deterministic rule.

Recommend the following sufficient local certificate. It intentionally misses some
legitimate combinations rather than granting resets for unexplained board changes.
It needs finite one-reply geometry probes, **no minimax or Agent evaluation**.

### 5.2 Safe-refuge definition

For a public board X and revealed target B, `S_B(X)` is the set of destinations of
B's ordinary legal MOVEs, including captures, for which B cannot be captured by
**any** revealed enemy immediately on the resulting board. Apply each candidate
with the shared structural transition, including removing a captured piece, and
query shared ordinary capture semantics. Occupancy, rank exceptions and Cannon
screens must be recomputed after B moves; do not approximate empty-square control.

S is an immediate geometric safety set, not a search result or the complete
chase-filtered legal-action set. To certify a lost square s below, also require
B→s on the comparison board to be unconditionally chase-permitted: either a capture
(always exempt), or a quiet escape creating no newly eligible offensive targets N
for B. This excludes credit for suppressing a square already potentially barred by
B's own chase history, without recursively invoking chase-aware outcomes. Other
ordinary safe destinations remain in S when checking that no new refuge appeared.
This conservative witness test can miss legal escaping counterattacks.

### 5.3 Earning a certificate on an actual helper move

While A→B is exhausted and both pieces survive, another revealed friendly physical
piece H makes an **accepted ordinary quiet MOVE** u→v. Compare the actual immediately
before/after public boards X0/X1; only H moved. A and B are unchanged. Record these
eligible witnesses, excluding keys already spent for A/B:

- **DIRECT(H):** H newly gains a nonreciprocal direct capture on B: false in X0,
  true in X1. The reciprocal exclusion makes this deliberately conservative.
- **ESCAPE(H,s):** `S_B(X1)` is a proper subset of `S_B(X0)`; s is lost and meets
  the unconditional-permission test above. After B's hypothetical move to s, H
  itself can capture B in X1 and cannot in X0. Merely vacating a square so another
  piece discovers a threat does not qualify this first version.

A pure relocation with unchanged attack/refuge facts earns no witness. A swap of
one safe escape for a different safe escape earns no ESCAPE witness: set inclusion,
not a weighted count, is required. A helper may earn both types; all applicable
unused witnesses form one pending bundle for this pair, not multiple allowances.
C's own chase checks must pass first. A prohibited helper attempt earns nothing.

### 5.4 Redeeming at A's next turn

Pending support is valid **only for that player's immediately next accepted action**
(earnedPly+2 in alternating play). The opponent has exactly one intervening action;
invalid attempts do not expire it. If the next own action is not a qualifying A→B
renewal, discard the pending bundle without spending its keys. Do not bank credits.

For a candidate A renewal, let X be the current board before A moves, Y the tentative
board after. H must remain at v, u must remain empty in **both** X and Y, and A/B/H
must survive. Define `undoH(Z)` solely for a local geometry probe: relocate H from
v back to u, retaining every other square of Z. It is not an accepted turn or a
change to history. Use the same authoritative movement/structural board semantics;
no synthetic GameResult or hidden value is needed.

Revalidate each earned witness on **both** pairs `(undoH(X),X)` and `(undoH(Y),Y)`
using the exact DIRECT/ESCAPE tests of §5.3. An ESCAPE witness must still remove the
same destination s. This rules out stale assistance, changes caused only by A, and
an apparent constraint that disappears when A renews or the opponent responds.
Require at least one still-valid, unspent witness from the original bundle.

Then, only if the whole action passes every other pair and position limit:

1. Accept this **one** additional A→B threat, retaining exhaustion/usage2.
2. Mark **all still-valid witnesses** in that pending bundle spent for A/B.
3. Expire the pending bundle. The next renewal requires another new certificate.

Consuming the bundle prevents farming a simultaneous direct attack and escape
restriction as successive resets. A witness is keyed by helper physical identity
and, for ESCAPE, absolute destination square: **not** helper source/destination,
target's current square, board hash, event number or an "epoch" counter. Repeating
the same helper maneuver or moving B to another square therefore cannot refresh a
spent DIRECT(H) or ESCAPE(H,s). A different newly constrained escape square can
qualify once; a different physical helper is independent. Reflection/rotation tests
must transform destination keys with the board.

No allowance is granted for a helper's capture, a FLIP, a screen-only discovered
attack, a reciprocal helper threat, an escape trade-off, delayed coordination, or
an A renewal occupying H's vacated square. These are known omissions of the minimal
rule, not assertions that such tactics are useless. Direct captures and those helper
actions themselves remain ordinary-legal; they simply do not certify an otherwise
exhausted A→B renewal. Expanding these cases would need a separately precise review.

### 5.5 Loop bound and unavoidable trade-offs

For a surviving A/B pair, each physical helper supplies at most one DIRECT and32
ESCAPE keys; a fixed game has finitely many revealed pieces. Spent keys are never
refunded by waiting, FLIP, capture of another piece, or changing squares. Thus
support toggling cannot yield an unbounded stream of exceptions. Each accepted
quiet helper/escape/renewal also advances the unchanged60-ply counter; only finitely
many FLIPs/captures can reset it. Position appearance3 remains forbidden even if a
fresh certificate otherwise exists.

This does not prohibit every long or unproductive sequence: interrupted usage1
can restart, maintained threats are excluded, and new squares/helpers can earn
finite new certificates. Repeated qualifying positions and NO_PROGRESS remain the
separate limits. Restricting every futile attack would require broader rules or
strategic adjudication the owner has not requested. Conversely, lifetime-spent
witnesses may reject a genuinely useful later repetition of the same support motif.
An unrestricted reusable "new geometry" exception cannot distinguish that tactic
from a reset exploit without more history/search; this explicit conservative cost
is preferable to pretending the distinction has been solved.

## 6. Allowed/prohibited examples and proposed fixtures

All coordinates use a4-column board. The small boards here are **geometry fixtures**,
not claims of valid full opening transcripts or executable v3 tests. The exhausted
A/B premise must be reached through accepted prefixes in integration tests. Existing
§1 fixtures provide real-prefix diagnosis; new coordinated cases still need those
prefixes during approved implementation.

| Case                                                                                     | Decision under proposal                                                                        | Reason                                                               |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Initial A0→1 fork: Red Chariot A; Black Horse B5 and Soldier D2                          | Allow; seed A/B=1, A/D=1                                                                       | New fork is a legitimate first threat to each                        |
| B escapes; A renews against B while also newly threatening D                             | Allow second B threat; exhaust B, seed D independently                                         | New target never resets B; a third B threat needs support            |
| Same fork above; Black waiting Soldier31→30, A1→0, Soldier30→31; repeat                  | First/second fork appearances allowed; third0→1 rejected                                       | Interrupted partial usage resets, but exact scoped fork key persists |
| A/B exhausted, A renews while adding a new target                                        | Reject absent support for B                                                                    | A fork does not grant amnesty for its old relationship               |
| A genuine different fork excluding exhausted B, or a different physical attacker         | Allow if its own pair/key limits pass                                                          | No global prohibition on forks or equal-ranked attackers             |
| Exhausted A/B; C makes an unrelated quiet move                                           | Allow C; game remains ACTIVE if a permitted action remains and no higher terminal rule applies | A's ledger does not restrict C; no support earned                    |
| C waits, FLIP occurs, or C captures D; later unsupported A/B renewal                     | Helper/progress action allowed; A renewal still rejected                                       | None clears A/B exhaustion                                           |
| A directly captures B                                                                    | Allow                                                                                          | All direct legal captures exempt                                     |
| Helper goes out and back, repeating an already redeemed support motif                    | Ordinary helper moves allowed; no new A/B exception from spent keys                            | No meaningful-change laundering                                      |
| Helper initially qualifies but B escapes the added constraint, or A's renewal removes it | Reject unsupported renewal                                                                     | Revalidation on current and candidate boards fails                   |

**Concrete new direct-support fixture:** Red A=Chariot1, H=Cannon21,
Black Soldier12 (screen); Black B=Horse4, waiting Soldier31; other squares empty.
Assume A/B exhausted. H21→20 is legal. `S_B` changes `{8}`→`{}` and H newly
threatens B over the screen12. Black31→30 leaves those facts intact. A1→0 renews
against B, with H20 still attacking B4. On its candidate board, reverting H to21
changes refuges `{5}`→`{5,8}`. Thus DIRECT(H) and ESCAPE(H,8) both validate;
accept A's one new threat and spend both. Moving H back and repeating cannot renew
those same keys. Black is not forced to wait: enumerate all its real alternatives.

**Concrete escape-only fixture:** Red A=Chariot0, H=Cannon15,
Black Soldier10 (screen); Black B=Horse5 and waiting Soldier31. H15→14 does **not**
attack B. It reduces B's refuges `{6,9}`→`{9}` by controlling6 through screen10.
After Black31→30, A0→1 renews B; the comparison refuges are `{4,6,9}` without the
helper move and `{4,9}` with it. B5→6 has no new eligible offensive target on the
comparison boards. ESCAPE(H,6) therefore certifies one new A/B attack; DIRECT(H)
does not. H15→19 instead changes neither direct attack nor these refuge sets and
earns nothing. Both ordinary helper moves are legal.

These two examples' refuge sets and direct attacks were checked against current
`getPublicOrdinaryMoves`, including structural B captures and recapture geometry.
This verifies geometry only: no exception state machine has been implemented/tested.

## 7. Chase-only stalemate and incentives

After an accepted action, use this provisional priority:

1. NO_PIECES win.
2. Zero ordinary actions before chase filtering: NO_LEGAL_ACTION win.
3. Ordinary actions exist, but **every** candidate is rejected specifically by
   chase filtering: DRAW / CHASE_STALEMATE.
4. Otherwise quiet count at least60: DRAW / NO_PROGRESS.
5. Otherwise ACTIVE with at least one permitted action.

Enumerate all pieces and destinations, including captures, FLIPs and quiet waiting
moves. Any permitted alternative prevents CHASE_STALEMATE; it does not override
NO_PIECES/ordinary immobilization/NO_PROGRESS. A capture or FLIP is never rejected
by chase, so either available action alone rules out chase-only stalemate. Include
certificate-aware quiet legality; tentative probes must not spend support.
A rejected attempt never triggers a result or changes any ledger.

The existing synthetic Cannon control has Red Cannon1; Black Horse12, General2,
Soldiers4/5. `1>0;12>13;0>1;13>12` reaches the two-threat allowance and leaves Red
only its exhausted renewal. With no helper/capture/FLIP, v3 would draw there; current
Core is still ACTIVE then and later awards Black NO_LEGAL_ACTION. Black also has
the immediate winning General2→1 capture before choosing13→12. This establishes
an **avoidable** favorable draw for the disadvantaged pursuer, not a forced draw.
It is separately identified from the nine actual-deck prefixes in the diagnostic
artifact. The fixture must enumerate defender alternatives before making claims.

A genuinely forced fixture must show that **every** permitted defender reply reaches
a draw (or a draw-or-worse outcome under an explicitly bounded analysis); material
imbalance alone proves nothing. Add both avoidable and forced-local-draw cases,
without claiming a game-theoretic forced draw from a one-ply audit. The proposed
rule can benefit a losing player: that is an explicit consequence of choosing a
draw rather than the current loss for chase-only immobilization.

An available helper waiting move already prevents stalemate, even if it earns no
certificate. A helper certificate may make an otherwise barred renewal available,
so it can prevent a draw but never remove another legal action. Its expiry can
legitimately leave only prohibited actions on a later turn; adjudicate that actual
accepted prefix, never a failed attempt. Consumed support cannot revive loops;
quiet60 and third qualifying appearance remain higher constraints on continuation.

## 8. Focused implementation acceptance matrix

These are required tests **after final approval**, not claims of implemented v3:

| Family                | Required assertions                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base pursuit          | First/second threat accepted, third rejected across changing boards; exhaustion stored on second; exact rejection immutability                                                             |
| Interruptions         | Partial1 resets on wrong mover/non-escape/non-renewal/FLIP/capture; exhausted pair survives all of these and target switches                                                               |
| Forks                 | Initial pair counts1 each; one target escaping does not erase another's state; renewed fork preserves B; independent attackers/targets; maintained E-minus-N not charged                   |
| Position cap          | Appearance1/2 accepted,3 rejected across interrupted episodes; other arrival routes same key; no general repetition ban; certificate cannot override cap                                   |
| Helpers               | Unrelated C move legal/ACTIVE; actual new direct attack and strict refuge reduction accepted; helper's own prohibited chase still rejected                                                 |
| Certificate causality | Different B reply, captured/moved helper, occupied old helper square, broken screen, A spoiling support, delayed redemption and no longer safe/lost refuge all fail                        |
| Reset exploits        | Repeated helper toggles, different helper squares, moving B, adding fork targets, FLIP/unrelated capture, cycling spent support all fail to refund witnesses                               |
| Witness limits        | Consume all valid witnesses in one bundle, no double redemption; fresh helper/square once allowed; unchanged/swap-only refuge sets rejected; no credit for already barred offensive escape |
| Rank/screens          | General/Soldier, reciprocal exclusions, Cannon0/1/2 screens, hidden screens, captured screen, B capturing helper/screen; recompute after each escape                                       |
| Atomicity             | Multiple exhausted fork pairs need all certificates; invalid/rejected moves and legal-action enumeration change nothing; commit all ledger changes once                                    |
| End conditions        | NO_PIECES → ordinary NO_LEGAL_ACTION → CHASE_STALEMATE → NO_PROGRESS; quiet59/60 collisions; any helper MOVE/capture/FLIP prevents chase-only draw                                         |
| Incentives            | Losing pursuer obtains avoidable draw; enumerate winning defender reply; construct forced-local no-alternative case; defender escape never inherits pursuer's ban                          |
| Reconstruction        | Full private/public prefix parity before/after progress; public-origin identity mapping, same-rank swaps, hidden permutation, per-branch capture/FLIP history                              |
| Lifecycle             | Undo before/after exhaustion, earning/redemption and invalid attempt; branching Undo/restart/replay exact ledger/action/result parity                                                      |
| Invariance/cost       | Both colors/seats, board symmetries with witness-square mapping, deterministic records; search latency and full-history cost under fixed unchanged budget                                  |

Use authoritative Core private/public differential tests for every new rule decision
and full match/Session regressions. Keep arbitrary-position geometry unit tests
separate from full-prefix integration tests. Preserve current-rule diagnostics under
the old Core rather than accidentally demanding that v3 accept their old prefixes.
Do not add an Agent-specific chase approximation or use an Agent's score as an oracle.

## 9. Public projection, Undo, Replay and AI impact

**Public projection:** `reconstructPosition` currently keeps only the quiet suffix
after the last FLIP/capture and initializes `chase:null`. That loses exhausted
pairs and spent support. Smallest correct source is the complete already-supplied
accepted public ActionEvent prefix, replayed from32 HIDDEN squares using the shared
Core v3 state machine. Each public FLIP establishes a reveal-origin reference,
carried by MOVEs and removed on capture; no unseen piece ever receives a reference.
A/B/C/D in §1 have public origins at plies1/12/6/14 respectively. These tokens
remain internal and must not leak into observations/events or become private IDs.

Verify event actor/piece/capture/assignments/turn/inventory and final public board.
Private IDs and public-origin references yield isomorphic pairs, helper witnesses
and pending state; differential tests compare permitted actions/events/results,
not raw identifier strings. Reuse shared ordinary rules for refuge probes and
counterfactual structural moves. No new policy input or trusted private shortcut.

Some existing `tacticalSnapshot` public-policy fixtures use invented capture ledgers
that are not replayable openings. Migrate those to real accepted public prefixes or
keep them at internal rule-helper level; no production bypass for missing history.

**Undo/Replay:** derive all ledgers and pending support from the retained accepted
prefix. Undo of redemption restores its unused certificate; Undo of earning removes
it; abandoned branches never keep spent keys. Preserve accepted initial-deck private
replay and public Review without adding a second editable ledger. Human-vs-AI Undo
remains disabled. Old transcripts require the old rules engine or explicit migration,
because actions accepted under old thresholds may be illegal under v3.

**AI-6A:** retain policies, scoring, seed schedules, widths and8,192-projection
budget unchanged. New Core semantics alter permitted actions and terminal reasons;
revalidate forced-choice/capture/fork/search fixtures against that same new Core.
Generic draws remain zero in evaluation and0.5 in harness scoring. Update exhaustive
reason handling and browser draw text in a separately scoped implementation step;
current App copy assumes every draw is60 quiet plies. No heuristic tuning to offset
rule changes. Preserve the frozen old engine/artifacts; compare policy versions only
under the same new reproducible rules revision.

Refuge probes add bounded work but are not AI search nodes: do not claim that the
unchanged projection count alone bounds wall-clock time. Enumerate safe refuges
lazily only for relevant exhausted pairs/helpers, then profile. Full public-history
replay per projection is another substantial cost. If necessary, separately propose
a small caller-owned public-derived projection context advanced by shared Core
transitions; no new context/cache API or search configuration is authorized here.
Do not declare browser AI ready under v3 until latency/replay parity are measured.

**AI-7 self-play:** record rules version, pinned Core, policy/configuration, seeds
and source identity. Label CHASE_STALEMATE separately from NO_PROGRESS; preserve
failed/truncated games. Use history-derived permitted actions during data generation
and reconstruction. Identical boards can have different exhaustion/spent-support
histories, so future board-only learned inputs cannot recover legal permissions;
the existing legal-action mask/history must remain available. Any future compact
public rule-context export needs its own contract review. Keep old/new-rule datasets
separate; do not attribute rule-induced draw/strength changes to better training.

## 10. Complexity assessment and final approval boundary

The requirements are compatible once "new tactical attack" means a specified local
certificate, rather than proven strategic progress. Three unavoidable costs remain:

- Persistent exhaustion plus a repeat-proof exception needs more than a pair boolean:
  spent witness history and a short-lived causal helper record are necessary.
- A finite conservative exception rejects some later legitimate repeats; an unlimited
  reusable geometry reset admits toggling. This proposal chooses finite witnesses
  and one additional threat per certificate, with explicit tactical omissions.
- Draw adjudication can help a disadvantaged pursuer; material advantage and useful
  support do not prove either player has a forced win. Strategic intent is excluded.

This is more complex than permanent pair exhaustion, but stays a local deterministic
rule with four small purpose-specific maps. Do not add generic epochs, unrestricted
board-hash resets, deeper search, global feature weights or game-tree intent tests.
If this complexity is unacceptable, the simpler alternatives are permanent pair
exhaustion (overrestricts coordination) or dropping pair persistence (restores reset
exploits); neither satisfies all updated requirements.

After final approval: update authoritative rule/product/architecture documents;
implement and test shared classifier/ledger/certificate semantics; add ordinary versus
permitted availability and terminal reason; repair full public reconstruction and
fixtures; verify Session/UI reason compatibility, all regressions and browser cost.
A subsequent reproducible Core-only commit/pin update requires separate approval.
Never weaken the existing benchmark guard or call dirty HEAD the complete new Core.

Review verification: workspace typecheck, lint, formatting, all **756 tests across37
files**, and production build passed. The nine old-rule diagnostic prefixes still
pass public/private consistency and exact replay (207 accepted actions); the Cannon
terminal-control audit also passes. The new helper examples were checked with
read-only ordinary-geometry probes, including the lost escape's non-offensive test.
These results preserve current behavior; they do **not** verify an implemented v3
rule. A source-hash audit found no changes outside this design document during this
updated review. Browser E2E was not rerun for a documentation-only change.

**Current stop:** this design review updates only this proposal. No Core, authoritative
rules, scoring, Agent, AI-6A/search configuration, baseline pin, dependency, commit,
push or deployment is changed or authorized. The superseded three questions no
longer apply. Final approval of this revised specification is the next boundary.
