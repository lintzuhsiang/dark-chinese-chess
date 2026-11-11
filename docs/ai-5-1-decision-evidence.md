# AI-5.1 exact decision evidence

Positions use zero-based row-major indices on the 8×4 board. Deck prefixes and full accepted public histories are replayable from the standalone diagnostic test; JSON includes every candidate/outcome component. Policy source and weights unchanged.

Defaults remain General/Advisor/Elephant/Chariot/Horse/Cannon/Soldier values
8/6/5/4/3/5/2 and Material/Threat/Mobility weights 1/0.5/0.05. FLIP table rows show
probability-weighted raw feature means; their total is the weighted successor V,
not a separate information bonus. Complete prefixes are embedded in
`packages/ai-agents/tests/ai51-gameplay-diagnostics.test.ts`; ignored original
benchmark reports are not required to rerun those fixtures.

## Deck 20005, leg 0, ply 177

Current P1 (BLACK), decision seed 3581166702; pair Agent root 1107409145; quiet count 37; hidden 1.

Board (. empty, ? hidden; color R/B followed by rank):

```
0:. 1:. 2:. 3:.
4:. 5:. 6:. 7:.
8:. 9:. 10:BADVISOR 11:.
12:. 13:RELEPHANT 14:. 15:.
16:? 17:. 18:RADVISOR 19:.
20:. 21:RHORSE 22:. 23:.
24:RELEPHANT 25:. 26:RSOLDIER 27:.
28:. 29:RADVISOR 30:. 31:RSOLDIER
```

| Candidate | Material raw | Threat raw | Mobility raw |        Total/EV |
| --------- | -----------: | ---------: | -----------: | --------------: |
| 10→6      |   -25.000000 |   0.000000 |   -20.000000 | -0.262096774194 |
| 10→9      |   -25.000000 |   5.000000 |   -20.000000 | -0.236895161290 |
| 10→11     |   -25.000000 |   0.000000 |   -21.000000 | -0.262600806452 |
| 10→14     |   -25.000000 |   5.000000 |   -20.000000 | -0.236895161290 |
| FLIP 16   |   -25.000000 |   0.000000 |   -23.000000 | -0.263608870968 |

Chosen {"type":"MOVE","from":10,"to":14}. Actual opponent response {"type":"MOVE","from":18,"to":14}. Strongest immediate opponent score 2 from opponent perspective, enumerating all MOVEs and all public FLIP outcomes.

## Deck 20001, leg 1, ply 76

Current P2 (BLACK), decision seed 4030719552; pair Agent root 3448003371; quiet count 58; hidden 19.

Board (. empty, ? hidden; color R/B followed by rank):

```
0:? 1:. 2:? 3:?
4:? 5:. 6:? 7:?
8:? 9:RELEPHANT 10:BCHARIOT 11:BELEPHANT
12:BSOLDIER 13:. 14:. 15:?
16:? 17:? 18:? 19:RSOLDIER
20:? 21:? 22:BSOLDIER 23:?
24:BHORSE 25:? 26:? 27:?
28:BADVISOR 29:? 30:RGENERAL 31:?
```

| Candidate | Material raw | Threat raw | Mobility raw |       Total/EV |
| --------- | -----------: | ---------: | -----------: | -------------: |
| FLIP 0    |     7.000000 |  -4.000000 |    -0.052632 | 0.050376697793 |
| FLIP 2    |     7.000000 |  -4.000000 |    -0.052632 | 0.050376697793 |
| FLIP 3    |     7.000000 |  -4.263158 |     0.000000 | 0.049076825127 |
| FLIP 4    |     7.000000 |  -4.105263 |    -0.052632 | 0.049846137521 |
| FLIP 6    |     7.000000 |  -2.842105 |    -0.052632 | 0.056212860781 |
| FLIP 7    |     7.000000 |  -3.368421 |     0.000000 | 0.053586587436 |
| FLIP 8    |     7.000000 |  -5.157895 |     0.000000 | 0.044567062818 |
| 10→14     |     7.000000 |   0.000000 |     1.000000 | 0.071068548387 |
| 12→13     |     7.000000 |  -6.000000 |     2.000000 | 0.041330645161 |
| FLIP 15   |     7.000000 |  -3.473684 |    -0.052632 | 0.053029499151 |
| FLIP 16   |     7.000000 |  -4.789474 |     0.000000 | 0.046424023769 |
| FLIP 17   |     7.000000 |  -3.789474 |    -0.052632 | 0.051437818336 |
| FLIP 18   |     7.000000 |  -4.736842 |    -0.052632 | 0.046662775891 |
| FLIP 20   |     7.000000 |  -4.736842 |     0.000000 | 0.046689303905 |
| FLIP 21   |     7.000000 |  -4.105263 |     0.000000 | 0.049872665535 |
| FLIP 23   |     7.000000 |  -4.736842 |     0.000000 | 0.046689303905 |
| FLIP 25   |     7.000000 |  -4.210526 |     0.000000 | 0.049342105263 |
| FLIP 26   |     7.000000 |  -4.842105 |     0.000000 | 0.046158743633 |
| FLIP 27   |     7.000000 |  -3.789474 |     0.000000 | 0.051464346350 |
| FLIP 29   |     7.000000 |  -2.631579 |     0.000000 | 0.057300509338 |
| FLIP 31   |     7.000000 |  -4.052632 |     0.000000 | 0.050137945671 |

Chosen {"type":"MOVE","from":10,"to":14}. Actual opponent response {"type":"MOVE","from":9,"to":13}. Strongest immediate opponent score 0 from opponent perspective, enumerating all MOVEs and all public FLIP outcomes.

Sacrifice cause: safe10→9 has friendly/enemy exposed material0/5; unsafe10→14 has6/11. Both net+5, same material and mobility difference. The capture reply18→14 wins immediately. Net feature aggregation hides risk, seed resolves the exact tie; no value/weight-only adjustment can separate these equal feature vectors. No terminal bug: after the enemy capture, fixed P1 score is exactly−2.

Stall cause: MOVE10→14 improves threat raw−4→0 and mobility0→1; expected best FLIP29 keeps material+7 but expected threat−2.631578947 and mobility0, thus scores lower. No information/progress feature exists; quiet58→59 is nonterminal, next enemy quiet move makes60 and draw. Enemy has no better immediate EV than0 (all FLIPs negative), so draw is its best immediate result. A hypothetical FLIP resets quiet counter0 without changing material; it does not prove a forced win.

The same fixture confirms a rule-boundary interaction: before the MOVE, the chase
is ESCAPE (Red Elephant9 / Black Chariot10), with one recorded appearance. After
10→14 it is RENEW. Red Elephant9→13 newly threatens both Black Soldier12 and Black
Chariot14; the current exactly-one-eligible-target classifier resets chase to null.
Thus a fork can interrupt this pursuit's counting even when the original target
is still threatened. This is current documented classifier behavior, not an
incorrect escape counter. Any decision to retain the prior target across a fork
requires separate rule approval and a legitimate-tactics trade-off.

Terminal priorities: each feature normalized[-1,1], nonnegative weights, denominator=max(1,sumweights) implies |Vactive|≤1. WIN/LOSS override±2, DRAW0 fixed original perspective. Draw is intentionally not above every active score.
