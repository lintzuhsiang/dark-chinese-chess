# E2b Board 2×2 historical 24M proposal for Intel review

M1 has evaluated 4,096 games across seeds 95001 and 95003. The 256-deck set is historical. The proposal remains pending Intel review with frozen_at unset. The original training plan and M1 evaluation manifests are preserved byte-for-byte under evidence/. Their hashes, the exact deck IDs, both seats, evaluator fingerprints, RNG and scoring are in protocol.json. The proposal lives alongside the results registry so it does not register a frozen study before agreement.

## Retrieve the frozen opponent

Use the original M1 E2b-L seed 92001 checkpoint at 3,640,000 transitions. The remote asset filename identifies the model. The downloaded bytes are the original final.pt.

```sh
gh release download ai7-e2b-l-m1-92001-364m-v1 \
  --repo lintzuhsiang/dark-chinese-chess \
  --pattern e2b-l-m1-seed-92001-364m-final.pt
printf '%s  %s\n' a5f00e10ccb885df29a2f60c2154ca2e018b5d5987f000a9b03363d79c95296c \
  e2b-l-m1-seed-92001-364m-final.pt | shasum -a 256 -c -
```

Intel review covers the selected final checkpoint, the actual 24M deck IDs and seats, evaluator/Core fingerprints, role RNG, scoring, and any Intel execution or exposure already recorded. Record any runtime or source differences as conformance evidence. Jointly freeze only after both sides agree.
