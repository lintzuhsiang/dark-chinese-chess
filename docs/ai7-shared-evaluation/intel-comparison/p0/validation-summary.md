# M1 bundle validation

Status: **passed**.

- Isolated import: `imports/intel-evaluation-bundle/`; original archive and owner copy unchanged.
- Archive SHA-256: `3a84f4e6edc2bbc02e93854bec4d5d94f048e855fbefacec6575c88f26afb476`.
- Extracted files: 127; verified static checksum entries: 126. Existing owner copy matches every entry.
- Reserved bank: not included; no reserved data read/extracted/evaluated.
- Exact original Stage2 SHA-256: `970fa685171b61d3b9a43c515e5cbfdd47801885ef259ca65aa3b345bc603d27`.
- All 400 full Core prefixes, legal branches, public histories and rotated labels independently replayed successfully.
- Public encode(), Policy, mask_array(), seed_all(), Core/rules and environment/action code match the reviewed Intel implementation.
- Collector difference is extra audit fields under training=True only, unused by this evaluation.
- Exact historical Baseline4023 original SHA-256: `d7b5623b61b26b1f17dd93189a512c3c0f81a4c9d8bd7a3131728078c53bb4b8`.
- Original checkpoint loads natively; all eight tensors equal the NPZ export bit for bit.
- Maximum absolute policy-probability error vs M1 reference: 2.384185791e-07, tolerance 1e-5.
- Actual source revisions and dependency mismatches retained in compatibility-validation.json; use one verified compatible runtime for the common evaluation.
- Old Intel 14M namespace overlaps M1 curriculum generation: retain as Intel internal results, not a fresh shared final test.
- New P0 common decks: 20,000,000–20,000,255, exactly 256 decks, both seats. Manifest SHA-256: `b2076ad8b89ac39eba71ef022c0dbbaa7bbeb7a1c6cfd4f07dc6358860269568`.
- Source/checkpoint/manifest hashes frozen before new results; no retraining or fine-tuning.

See verification-results.json for tests, plan.json for the evaluation contract, and the final tactical/historical-opponent reports for scientific results.
