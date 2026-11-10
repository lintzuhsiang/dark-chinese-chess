# Dark Chess — Phase 1.5 Release Plan

**Version:** 0.2 — Owner decisions, 2026-11-10\
**Status:** Independent preparation implemented; owner review/external publication gates pending\
**Baseline:** `e4afd23` — Phase 1 Tasks 1–6 implementation and selectable Review\
**Goal:** Prepare a stable public local-game release without starting Phase 2.

## Readiness and authorization

Implementation readiness and publication readiness are separate. Hosted CI and unavailable physical devices do not block independent preparation. Phase 1 acceptance is still open; preparation is not acceptance or publication.

The owner authorizes local CI/E2E/tooling work, release configuration, deployment preparation, and investigation of terminal-state consistency. Follow `AGENTS.md`, preserve Core/session/public-data boundaries, and add no multiplayer, AI, backend, accounts, persistence, hints, or effects.

Approval is still required for:

- Commits and pushes. Prepare separate formatting-only and behavioral/tooling commit boundaries; do not commit either without authorization.
- Hosting provider selection, account connection, external resources, publication, and any paid resources. Use a provider HTTPS URL; no custom domain is needed.
- Additional game-rule changes. On 2026-11-10 the owner explicitly approved NO_LEGAL_ACTION when the next player has no permitted action, including chase filtering; the prior prohibition-only/no-loss rule is superseded. Rejection itself stays immutable. An ACTIVE game with zero permitted actions is a release blocker.

## R0 — Audit and terminal-state investigation

Inventory implemented requirements, scripts, tests, baseline Git status, and open acceptance checks. Investigate the existing ordinary-versus-chase-filtered legality distinction. Recommend reusing `NO_LEGAL_ACTION` if no permitted action exists, with shared validation/enumeration and no recursive adjudication. If that requires changing the prior no-chase-induced-loss rule, present the exact amendment for approval. If a minimal consistent fix is not practical, propose explicitly deferring chase enforcement rather than releasing a stalled ACTIVE game.

Acceptance: a traceable release checklist, reproducible deadlock evidence, exact proposed semantics, and no unapproved rule changes. Verification: existing regression, terminal-priority/reconstruction review, local checks. Chase deadlock remains a publication blocker until approved resolution is implemented and verified.

## R1 — Minimal quality gates

Add ESLint and Prettier, preserve strict TypeScript, provide lint/format/typecheck/test/build commands, and extend existing read-only GitHub Actions. Use minimal rules and no unrelated refactoring. Align `AGENTS.md` with actual tooling.

If formatting touches existing files, keep an exact formatting-only patch/commit boundary separate from tooling and behavior. Do not format generated output, lockfiles, unrelated assets, or the unrelated Phase 2 draft. Run typecheck, unit tests, and build after formatting. Verify the tools reject deliberate isolated failure probes without leaving broken files behind.

Acceptance: local gates pass and CI configuration includes them. A hosted pass is a separate pending gate, not inferred from local success. No commit or push without owner authorization.

## R2 — Reuse E2E coverage

Audit the existing 22 Chromium/WebKit production-browser checks before adding coverage. Retain deterministic test-only fixtures, public-data isolation, diagnostics, first flip/movement/capture/rejection, chase, undo, restart, full selectable Review, terminal state, and viewport/accessibility checks. Add only confirmed missing release-critical cases.

Acceptance: local critical flows pass; hosted supported-browser execution remains pending until an authorized push. Do not rebuild the existing Playwright infrastructure or add production fixture endpoints.

## R3 — Device and accessibility evidence

Reuse `docs/verification/` evidence and trusted-tap procedure. Prefer actual iPhone Safari and Android Chrome, including native zoom and five-sample short/long interaction measurements. Record real devices/browser versions and actual results. An unavailable device is a verification gap and risk requiring explicit owner acceptance before publication; merely documenting it is not acceptance.

Acceptance: all 32 cells and essential controls remain accessible, Review/history remain usable, no critical overflow/overlap, and no effects/hints/redesign. Existing desktop engine/emulation results must not be described as physical-device verification.

## R4 — Hosting comparison and deployment preparation

Compare Cloudflare Workers Static Assets, Cloudflare Pages, Vercel Hobby, and GitHub Pages using current official documentation. Cover setup, free limits, Git builds, previews, rollback, monorepo compatibility, and future multiplayer implications. Recommend one option and document its trade-offs, build/root/output settings, preview/production behavior, asset/refresh checks, and rollback plan.

Prepare locally reviewable configuration/artifacts only. No external project/account/resource creation, public preview, deployment, credentials, paid services, or DNS changes. Hosting choice is a recommendation until approved. Keep production publication manual and gated on a passing hosted verification run for the exact release revision.

## R5 — Publication acceptance and feedback

Before any production publication, require:

- Owner acceptance of Phase 1 functionality and release scope.
- Resolution of the ACTIVE-with-zero-permitted-actions blocker.
- Passing hosted CI for the proposed release revision.
- Actual device checks, or explicit owner acceptance of each unavailable-device gap/risk.
- Approved hosting/account/settings, documented rollback, and explicit publication authorization.

After a separately approved deployment, perform HTTPS/asset/navigation/refresh and complete-game/Review smoke checks; record version/revision/URL and rollback target. The owner coordinates friend testing; do not send invitations or messages without instruction. Record feedback and release blockers before final acceptance.

## Sequence and current evidence

`R0 → independent R1 / R2 audit / R3 evidence preparation / R4 research → owner decisions and external verification → R5`

Missing external access does not block independent preparation. Keep shared configuration edits sequential. No Phase 2 work is authorized.

Baseline local evidence: typecheck, 451 unit tests in 13 files, production build, and 22 Chromium/WebKit checks pass. CI is configured but has not run remotely. ESLint/Prettier are not yet configured at this baseline. Mac host action/undo/Review medians are approximately 31–32 ms; physical phones/native zoom remain unverified. The full completed Review history is intentionally visible; its board/turn/result/captures remain selected-prefix projections.

## Completion record

- [x] Owner preparation/publication boundaries recorded.
- [x] Terminal-state investigation and exact rule amendment approved by owner on 2026-11-10.
- [x] Local lint/format/type/unit/build/E2E evidence recorded in the release checklist.
- [x] Formatting-only and tooling/behavior commit boundaries prepared for approval; no commits authorized.
- [x] Hosting comparison and inactive deployment example/local plan prepared; provider choice pending approval.
- [ ] Hosted CI passes for release revision.
- [ ] Device results or explicit owner gap acceptance recorded.
- [ ] Publication authorized and public release verified.

The implementation report and remaining publication gates are maintained in [the release checklist](release/checklist.md). Hosting research is in [the comparison](release/hosting-comparison.md); the Workers recommendation remains subject to owner selection/account approval.

Local release preparation passes lint, format checking, typecheck, 453 tests in 13 files, production build/artifact inspection, isolated positive/negative quality-gate probes, and all 22 Chromium/WebKit production-browser checks. This is implementation evidence, not hosted CI/device/publication acceptance.

The opt-in post-correction performance check also passes both host configurations: five-sample medians are approximately 31–33 ms for action/undo/Review in short and 607-action games. This is Mac reference evidence, not a physical-device pass. No cache or new architecture was needed.
