# AI-5.1 chase investigation and amendment proposal

Status: **proposal only; owner approval required before Core, rule documentation, or contract changes.** No scoring or rules were changed by this investigation. The diagnostic test records current behavior, including behavior a future approved amendment would intentionally replace.

## Confirmed current behavior

`packages/game-core/src/chase.ts:getChaseUpdate` and `docs/game-rules.md` §10 agree: the first threat position is appearance **1**, return one is appearance **2**, return two is appearance **3**, and return three would be appearance **4**, which is rejected. This implements the previously approved **third qualifying return**; it does **not** implement the newly proposed third-appearance rejection.

For Red Chariot 1 / Black Horse 5, repeat `Horse 5→4; Chariot 1→0; Horse 4→5; Chariot 0→1`. The anchor begins at count 1. The first complete cycle raises its count to 2; the second to 3; the third cycle's final Chariot move is rejected. Escapes are never counted as threat appearances. The chase tests explicitly verify this convention, alternative routes, later loops, and unchanged state after rejection.

The implementation already follows the same physical attacker/target across different squares. Its limit is **per logical threat-position key**, not per pursuit: every fresh board starts at count 1. `chase.test.ts` deliberately tests that non-closing pursuit remains legal. The observed changing-square pursuit is therefore a current rule-definition limitation, not evidence of a broken validator.

Other boundaries are deliberate: switching attacking pieces or targets, unrelated intervening actions, reciprocal capture threats, or ambiguous multiple newly threatened targets can break the current chain. These are not comprehensive tournament chase adjudication.

## Reproducible changing-position pursuit

Run:

```sh
node_modules/.bin/vitest run packages/ai-agents/tests/ai51-chase-diagnostics.test.ts
```

The fixture uses a valid full 32-piece initial deck, not a synthetic capture ledger. Reserve Red Chariot at 0, Black Soldiers at 1/2/4/6, and Black Horse at 5; the existing `arrangedInitial` fixture deterministically fills the remaining deck. Indices are row-major on the 4-column board. The exact accepted opening is:

```text
F0 F1 M0→1 F4 M1→0 F2 M0→4 F6 M4→0 F31 M0→1 F30
M1→2 F29 M2→6 F28 M6→2 F27 M2→1 F26 M1→0 F5 M0→1
```

`F` means FLIP and `M` means MOVE. P1/Red captures four Black Soldiers. At accepted ply 23, P2/Black must play; the relevant public board is:

```text
      c0   c1   c2   c3
r0     .   RC    .    ?
r1     .   BH    .    ?
r2     ?    ?    ?    ?
r3     ?    ?    ?    ?
r4     ?    ?    ?    ?
r5     ?    ?    ?    ?
r6     ?    ?   BC   BC
r7    BH   BN   BN   BS
```

`C`=Chariot, `H`=Horse, `N`=Cannon, `S`=Soldier; `?`=hidden. Both Black Chariots, the second Black Horse, both Black Cannons, and the remaining Black Soldier were revealed at 26–31. They do not move in this example.

| Threat appearance | Defender's preceding escape | Attacker renewal | Chariot / Horse | Current result                |
| ----------------- | --------------------------- | ---------------- | --------------- | ----------------------------- |
| 1                 | Opening above               | Chariot 0→1      | 1 / 5           | Accepted; first key count 1   |
| 2                 | Horse 5→6                   | Chariot 1→5      | 5 / 6           | Accepted; another key count 1 |
| 3                 | Horse 6→2                   | Chariot 5→6      | 6 / 2           | Accepted; another key count 1 |
| 4                 | Horse 2→1                   | Chariot 6→2      | 2 / 1           | Accepted; another key count 1 |
| 5                 | Horse 1→0                   | Chariot 2→1      | 1 / 0           | Accepted; another key count 1 |

All five boards differ. The same physical pair survives, every defender escape is permitted, and every renewal projects identically through the public API and private Core. The test replays all 31 accepted actions from the initial deck and obtains identical state/history.

### Actual EV choice at ply 25

After Horse 5→6, P1 has MOVEs `1→0`, `1→2`, `1→5`, plus FLIPs at 3 and 7–25. Fixed decision seed 0 selects **Chariot 1→5**, which is the next same-pair pursuit step.

| Candidate     | Material contribution | Threat contribution | Mobility contribution |        Total |
| ------------- | --------------------: | ------------------: | --------------------: | -----------: |
| MOVE 1→0      |              0.080645 |                   0 |                     0 |     0.080645 |
| MOVE 1→2      |              0.080645 |            0.015121 |                     0 |     0.095766 |
| **MOVE 1→5**  |          **0.080645** |        **0.015121** |          **0.000504** | **0.096270** |
| Best FLIP: 25 |              0.080645 |   0.010585 expected |     0.000504 expected |     0.091734 |

Material raw advantage is 8 (four captured Soldiers ×2); threatening the Horse adds raw threat 3. The immediate threat is credited even though the defender can evade it. Enumerating **all** permitted opponent MOVEs and public FLIP expectations from fixed defender P2 perspective confirms Horse **6→2** is the unique strongest immediate response: P2 score **−0.081149**, equivalently fixed-P1 **+0.081149**, removing the threat benefit. The strongest FLIP is at **21**, with P2 expected score **−0.083669** (fixed-P1 **+0.083669**), so escaping is also better than every FLIP under this evaluator. This is a complete one-step public expectation comparison, not a claim of game-theoretic optimality or knowledge of the actual hidden reveal.

All FLIP scores range from 0.068548 to 0.091734, below the selected renewal. The current one-step evaluator has no opponent reply or pursuit/progress feature. This explains the first chosen renewal without proving that every legal subsequent scripted renewal would be the AI's choice. At the next diagnostic states EV instead selects 5→1 and 6→5, each another same-target threat; the table's longer path is a legal rule reproduction, not an autonomous EV game.

The local ignored artifact `benchmark-results/ai51-chase-diagnostics.json` contains the public board, complete accepted opening/history, all legal actions and candidate/outcome breakdowns for the first three renewal decision points, seed-0 choices, the best immediate MOVE replies, and complete defender reply inputs/decisions including every FLIP expectation. The tracked test independently reproduces the rule findings and the complete first-response comparison without requiring that artifact.

### Historical loop that breaks the unique-target tracker

The existing benchmark also demonstrates a different limit that a same-pair pursuit budget alone does **not** fix. The decision diagnostic reproduces deck **20001**, leg **1**, immediately before ply **76**:

1. Red Elephant 9 threatens the tracked Black Chariot 10; the tracker is ESCAPE with one appearance.
2. Black plays Chariot **10→14**; this is a permitted escape, leaving the tracker in RENEW.
3. Red plays Elephant **9→13**; it now newly threatens **both** Black Soldier 12 and the original Black Chariot 14.
4. The existing exactly-one-new-target classifier finds two targets and clears the tracker. After Chariot 14→10, Elephant 13→9 can start a fresh unique-target chain; the fork/unique-threat loop can repeat without accumulating one continuous chain's counts.

At the reproduced ending, Elephant 9→13 is also quiet ply 60 and the game draws; earlier repetitions of the same pattern reset the tracker before the draw. `ai51-gameplay-diagnostics.test.ts` verifies the ESCAPE→RENEW→null sequence and the two capture geometries `13→12` and `13→14`.

The proposal below retains ambiguous-target resets by default, so it **does not stop this observed fork-reset loop**. The owner must choose whether to preserve this tactical fork exception and address the AI's repetition through a separately approved progress/reply experiment, or broaden continuity: during RENEW, continue tracking the previous target whenever it is still among the same attacker's newly eligible, non-reciprocal targets, even if other new targets are added. Initial chain creation can still require exactly one target. This alternative closes this particular reset path while potentially classifying a legitimate repeated fork as pursuit; it needs separate explicit approval and differential tests.

## Proposed exact definitions

Keep the current narrow direct-threat classifier and state machine unless the owner explicitly chooses a broader definition:

- **Position identity:** board squares encoded as EMPTY, HIDDEN, or revealed color/rank, plus next player and fixed color assignments. Exclude physical IDs, hidden identities, counters, tracker, status, and result. Count positions only after qualifying initial threats and renewals within the active chain; ordinary repeated positions still do not cause a repetition draw.
- **Qualifying initial threat:** an otherwise legal quiet MOVE by a revealed attacker creates exactly one new eligible revealed enemy capture target; this attacker could not capture that target before the move, and that target cannot directly capture the attacker afterward. Use ordinary rank exceptions and Cannon occupancy/screens, independent of chase legality and turn. Hidden targets, discovered threats made by another piece, reciprocal threats, and multiple eligible new targets do not qualify.
- **Ownership/identity:** attribute the chain to the attacking player and the same physical revealed attacker/target. Keep references trusted; reconstruct equivalent public temporary references from accepted history, never expose real IDs to policies. Changing square does not change identity.
- **Start:** accept a qualifying first threat, enter ESCAPE, and record one threat appearance and one appearance for its logical key.
- **Continue:** the opponent immediately quietly moves the exact target out of that attacker's direct capture reach (RENEW); then the same attacker immediately quietly recreates the sole new non-reciprocal threat against the exact target (ESCAPE). Only the attacker's threat moves increment counts. A defender's escape is never itself rejected as the tracked chase violation.
- **End/reset:** any accepted FLIP/capture ends the chain and resets no-progress, as today. A different target/attacker, unrelated quiet move, failed escape/renewal, reciprocal threat, or ambiguous target ends the chain; that action can seed a genuinely new qualifying chain. Such a quiet reset does **not** reset the 60-ply counter. Invalid attempts do not change anything. Undo/restart retain their current replay/reset semantics.

### Two limits requiring approval

1. **Repeated-key appearances:** change the current accepted maximum from **3 to 2**, rejecting a candidate that would create appearance 3. This is a semantic rule change: the first threat counts, so this means rejecting the second return, not the third return. In the four-action cycle above, accept the first complete cycle and reject the second cycle's final `Chariot 0→1`.
2. **Continuous-pursuit budget:** impose a chain-wide threat-appearance limit independent of board keys, within a chain satisfying the approved continuity/reset definition. A concrete starting proposal is **maximum 4 threat appearances** (initial attack + three renewals); reject the fourth renewal, the fifth threat appearance, even if its key is entirely new. In the changing-position table, appearances 1–4 remain allowed and Chariot 2→1 at appearance 5 becomes prohibited. **The value 4 is proposed, not inferred from an approved rule.** A strict maximum 2 total threats is an alternative, but would prevent even two follow-up attacks and make the per-key table redundant for this single-pair chain. Neither budget prevents the separate fork-reset loop while ambiguous-target resets remain in force.

The repeated-key limit addresses closed cycles. The independent budget addresses continuous same-pair pursuit without board repetition. **No additional counter or `ChaseState` field is required:** `sum(Object.values(positionCounts))` already equals the number of initial/renewed threats in the current chain. Each accepted renewal increments exactly one key and preserves every other count; rejected candidates preserve the map, while a chain reset discards the whole map. Derive the proposed global limit from that sum, alongside the per-key limit. The diagnostic verifies this invariant through all five distinct appearances. Changing shared chase rule logic still requires owner approval, but this smallest approach preserves existing contracts and policy input.

### Avoiding overreach and remaining choices

A bounded non-repeating sequence is not proof of endless pursuit. A fixed pursuit budget is an explicit house-rule trade-off: it can also reject a legitimate longer forcing attack that shepherds a weaker target into a trap. Captures remain legal, and the reciprocal/multiple-target exclusions preserve many tactical attacks, but they cannot guarantee zero false positives. Do not describe this proposal as a complete tactical-intent detector.

Choices for owner review:

| Approach                                                      | Benefit                                                                                      | Limitation                                                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Repeated-key maximum 2 only                                   | Smallest change, preserves long non-closing tactics                                          | Does not satisfy the requested changing-board pursuit limit                                               |
| **Maximum 2 per key + maximum 4 threats per same-pair chain** | Small, deterministic, testable; square changes cannot evade it                               | The proposed numeric budget needs acceptance; some longer forcing attacks become illegal                  |
| Player/target continuity across changing attackers            | Also blocks alternating two attackers against one target                                     | Broader rule and public replay state; coordinated tactical attacks may be penalized                       |
| Continue the tracked target through additional new targets    | Closes the observed Elephant fork-reset loop while retaining exact physical-pair attribution | May penalize legitimate repeated forks; must explicitly change renewal classification                     |
| Retain the exactly-one-target reset                           | Preserves existing fork/tactical exception                                                   | A progress/reply policy experiment must address the observed fork-reset loop; pursuit limits alone do not |
| Persistence across interruptions/target switches              | Harder to evade by an unrelated waiting move                                                 | Larger state/window definition and many more false-positive cases                                         |
| AI-only pursuit/progress/reply experiment                     | Improves choices without making tactics illegal                                              | Does not amend the game rule; another policy/human can still chase                                        |

Recommend approving the repeated-key wording separately from choosing a continuous budget and the fork-continuity alternative. Physical-pair identity can remain unchanged in either fork option. If changing attackers or inserting unrelated actions must also be forbidden, decide that explicitly before implementation; this narrow proposal does not claim to close those different loopholes or every form of continuous chasing.

## Enforcement, verification, and compatibility

Preserve the existing enforcement contract: reject the offending attacker's candidate with `PERPETUAL_CHASE`; do not commit it, advance turn, add history, consume no-progress, or declare a loss for the rejected attempt. `getLegalActions` and public projection must reject it identically.

Preserve accepted-action outcome priority: `NO_PIECES`, then next-player `NO_LEGAL_ACTION` **after chase filtering**, then 60-quiet-ply `NO_PROGRESS`. If an accepted defender escape leaves the attacker with no permitted action, the defender wins `NO_LEGAL_ACTION`; this is a consequence of the accepted escape, not a loss caused by an attempted invalid move. Preserve terminal turn/result perspective and local Undo.

An approved implementation should add differential private-Core/public-projection tests for third-key appearance and fifth distinct threat (or the chosen budget), and retain rank/Cannon/hidden-screen, identities, all resets, immutable rejection, undo/replay, no-alternative loss, and quiet-ply-60 outcome priority coverage. Test defender escapes separately to prevent attribution errors. Add explicit accepted multi-target, reciprocal, capture, FLIP, changed-target/attacker, and interrupted examples. Pin the historical Elephant fork reset as either deliberately retained or deliberately changed according to the owner's choice, and test initial ambiguous threats separately from renewal forks. The existing diagnostic's five-distinct-board acceptance expectation must be revised intentionally after approval, not left as an accidental regression failure.

Keep `AgentInput`/policy isolation unchanged. Public projection reconstructs the quiet suffix after the last FLIP/capture; the proposed same-pair counter is derivable from that suffix through shared chase logic. A future rule that persists across captures/FLIPs would require revisiting that boundary before implementation. Do not duplicate chase classification in the AI or browser.

The present Core pin remains `b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75`. A rule amendment needs a separately approved Core commit and benchmark pin update. Retain historical benchmark artifacts under their original rule revision and replay their transcripts with that old Core; an accepted old transcript may contain moves newly prohibited by the amendment. Restart active browser games after updating rules so existing timelines are not silently reinterpreted. Scores/outcomes across different chase rules cannot isolate a policy improvement. Compare policy experiments on the same Core revision and use explicit old-rules/new-rules experiments for rule effects. No benchmark guard was bypassed and no Core files were modified here.
