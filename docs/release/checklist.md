# Phase 1.5 release checklist and evidence

Date: 2026-11-10. Baseline: e4afd23. Independent preparation is authorized; commits, pushes, accounts/resources, previews, production publication and Phase 2 are not authorized. The unrelated Phase 2 draft remains untouched.

## Readiness versus publication

| Gate                    | Local implementation/evidence                                                                                                                                                                                                                                                                                     | Publication state                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Chase deadlock          | Owner approved chase-aware NO_LEGAL_ACTION. Existing Cannon cycle now finishes on the defender's accepted escape, before the attacker could make a prohibited renewal. Tests include the quiet-ply-60 priority case, immutable input/rejection, deterministic transition and seeded ACTIVE/legal-action invariant | Local verification passed; owner review pending                                                             |
| Quality tools           | Minimal syntax ESLint, Prettier, strict TypeScript with unused checks; no compiler downgrade, production Babel transform, framework, runtime dependency or state-contract change                                                                                                                                  | Hosted run pending                                                                                          |
| Formatting separation   | Exact formatting-only patch saved before behavioral/tooling changes; typecheck, 451 original tests and build passed on that intermediate baseline; bundle hashes remained unchanged                                                                                                                               | Commit approval required                                                                                    |
| CI                      | Existing read-only Verify workflow extended with lint, format and release-artifact checks; no hosting credentials or deploy step                                                                                                                                                                                  | Must pass remotely for exact release revision before production publication                                 |
| E2E                     | Reuse 22 existing Chromium/WebKit production flows; gameplay, invalid/chase attempts, undo/restart, completed draw/Review, direct row selection, full public history, geometry/contrast/keyboard/enlarged text. Win labels/results also have Core/SSR coverage                                                    | Local 22-check rerun passed; Linux hosted/browser evidence pending                                          |
| Phones                  | Existing manual guide, native zoom checklist and trusted-tap timing procedure retained                                                                                                                                                                                                                            | Actual iPhone Safari / Android Chrome unavailable: owner must explicitly accept gaps and risk if not tested |
| Hosting                 | Workers Static Assets recommended; all four requested options compared; inactive JSON example and deployment/rollback plan prepared                                                                                                                                                                               | Provider/account/resource approval required; no external setup performed                                    |
| Hosted smoke/rollback   | Procedure includes HTTPS, assets, refresh, real gameplay/Review, revision/hash record and rollback target                                                                                                                                                                                                         | Not executed; first release has no prior hosted rollback target                                             |
| Release/friend feedback | No release version, public URL or acceptance claimed                                                                                                                                                                                                                                                              | Owner approval and actual publication/feedback required                                                     |

## Chase correction and trade-off

The old outcome helper used ordinary legality, while getLegalActions screened chase. That deliberate discrepancy produced an ACTIVE/result-null state with no permitted action. The owner approved correcting it on 2026-11-10.

The smallest implementation keeps the existing result union and transition/tracker contracts. After a successful permitted transition advances turn/counters/tracking, evaluate NO_PIECES, then a lazy shared chase-aware action enumeration for NO_LEGAL_ACTION, then NO_PROGRESS. Enumeration runs ordinary validation/tentative transition/chase screening only, never outcome evaluation, so it does not recurse. If all next-player actions are prohibited, the actor wins immediately. Rejected attempts do not trigger adjudication, mutate state, or add a timeline entry.

This retains the approved simplified chase rule rather than removing it. Cost: outcome evaluation enumerates permitted actions instead of only checking ordinary actions. Existing browser/performance verification must establish that this small board still meets the interaction target. No speculative cache or new tracker is added. Sessions still replay deterministically through the same applyAction; there are no persisted games to migrate.

## Tooling decision

Installed development tooling: ESLint 10.14.0, @eslint/js 10.0.1, @babel/eslint-parser 8.0.7, @babel/core 8.1.0 and Prettier 3.9.10. The current typescript-eslint 8.72.1 metadata supports TypeScript <6.1, while the existing compiler is 7.0.2. Syntax-only Babel parsing avoids downgrading the compiler or introducing an isolated second compiler/tooling workspace. No Babel production transform/configuration is added.

ESLint checks recommended syntax/correctness rules and explicit any. TypeScript handles type/name/unused-declaration checks; ESLint's no-undef/no-unused-vars are disabled only for TS/TSX because core rules do not understand type names. Node tooling minimums are now 22.18 on Node 22 or 24.11 on Node 24; CI/reference verification uses Node 26. This is a developer-tool floor, not a browser/runtime feature change. [Babel parser support](https://babel.dev/docs/babel-eslint-parser), [typescript-eslint compatibility](https://typescript-eslint.io/users/dependency-versions/).

`verify:gates` proves positive and negative lint, formatting, typecheck and actual Vitest exit behavior. It uses stdin and disposable temporary files; its unique repository test probe is created exclusively and removed in finally. It never weakens permanent tests. Expected deliberate failures are probe successes, not failing project tests. Do not run this isolated probe concurrently with the full suite.

## Physical-device gaps and risk

Without actual iPhone Safari/Android Chrome and native zoom, desktop engines/emulation cannot establish OS-specific focus, touch/viewport behavior, or phone performance. Mac host timing does not prove the <=100 ms phone target. Follow [manual-checks.md](../verification/manual-checks.md) and record five samples per operation, device/OS/browser and native zoom results, or obtain explicit owner acceptance of each missing check before publication.

## Verification record

| Command/check                               | Actual local result                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| pnpm lint                                   | Passed; zero warnings                                                                                   |
| pnpm format:check                           | Passed                                                                                                  |
| pnpm typecheck                              | Passed, including strict unused checks                                                                  |
| pnpm test                                   | Passed; 453 tests in 13 files                                                                           |
| pnpm build / pnpm verify:release            | Passed; three static files, referenced JS/CSS present, artifact marker/source checks passed             |
| pnpm verify:gates                           | Passed all positive/negative probes, including actual Vitest failure/success; no probe file left behind |
| pnpm test:e2e                               | Passed; all 22 production Chromium/WebKit checks                                                        |
| Deployment example                          | JSON syntax/path/no-account/no-runtime-entry checks passed; no Wrangler/provider execution claimed      |
| Formatting-only intermediate baseline       | Typecheck, 451 original tests and build passed before behavioral/tooling changes                        |
| Hosted CI, phones, HTTPS and rollback trial | Not executed; external/publication gates remain open                                                    |

See [commit-boundaries.md](commit-boundaries.md) for two independently reviewable patches.

## Post-correction host performance

`pnpm verify:performance` passed both Chromium reference configurations with short (7/66 action) and long (547/607 action) games. Five attempts per operation, click capture through two animation frames, production build; no timing-sensitive CI assertion. Reference host: Apple M1, arm64, macOS 27.2, Node 26.10.0, Chromium 158.0.8127.18. Other browser verification was idle.

| Configuration/game             | Action median | Undo median | Review jump median |
| ------------------------------ | ------------: | ----------: | -----------------: |
| Desktop 1280×800 / short       |       31.4 ms |     31.0 ms |            32.5 ms |
| Desktop 1280×800 / long        |       31.9 ms |     31.8 ms |            32.0 ms |
| Touch viewport 390×844 / short |       31.5 ms |     31.3 ms |            31.4 ms |
| Touch viewport 390×844 / long  |       32.0 ms |     31.9 ms |            32.1 ms |

[Raw samples](../verification/phase-15-performance-baseline.json) preserve all five observations. These host results do not establish physical-phone performance. No material host slowdown was observed in this small sample; no snapshot cache or additional architecture is justified by it.

## Remaining approval and external work

Approve the two proposed commits separately from any push. Approve or choose a hosting provider before account/configuration work. Hosted CI must pass for the release revision. Record actual device/native zoom/timing results or explicitly accept the documented gaps/risks. Public preview creation, production publication and first-release rollback fallback require their own explicit approval. No Phase 2 work is started.
No hosted CI run, external provider setup, HTTPS smoke, physical-device pass, rollback trial or release acceptance may be inferred from these local checks.
