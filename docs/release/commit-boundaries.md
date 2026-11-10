# Proposed commit boundaries — approval required

Baseline HEAD: `e4afd23`. No Phase 1.5 commits or pushes have been made. The real Git index is intentionally left untouched. The unrelated untracked `docs/phase-2-plan.md` is excluded from both proposed commits.

## 1. Formatting only

Suggested title: `style: format the existing workspace with Prettier`

Patch: `/private/tmp/dark-chess-phase15-review/formatting.patch`.

This captures only Prettier's changes to 58 already-tracked files at e4afd23, before any rule/tooling edits. There is no refactoring or semantic fix. Generated output, lockfile, measured raw baseline JSON and unrelated assets/drafts are excluded. Typecheck, all 451 original tests, and build passed on that intermediate state; output bundle names/sizes were unchanged.

The formatter configuration is introduced by the next tooling commit, so this first boundary contains no package/configuration/behavior changes beyond formatting existing JSON/config files. Review the patch independently rather than judging semantic scope from the final workspace's combined diff.

## 2. Release preparation and approved rule correction

Suggested title: `feat: prepare release quality gates and resolve chase-only immobilization`

Patch: `/private/tmp/dark-chess-phase15-review/release-preparation.patch`, relative to boundary 1.

Includes minimal lint/format tooling and strict unused checks, read-only CI gates, isolated failure probes, release artifact inspection, the owner-approved chase-aware NO_LEGAL_ACTION correction and regressions, updated current specifications/plan, hosting comparison, inactive deployment example, release checklist and commit boundary documentation. No frontend behavior changes beyond the already approved rule outcome; other frontend diffs in the combined workspace are formatting only.

The hosting recommendation and example are not provider selection, resource creation, publication or a deployment workflow. No runtime dependency, game-state/action/result shape, generalized adjudication, caching, AI or multiplayer is introduced.

## Applying after authorization

The patches are prepared for review, not applied to the real index. On a clean checkout at e4afd23, apply formatting.patch, review/verify and commit it only after authorization; then apply release-preparation.patch, verify and commit it after authorization. Do not apply the patches on top of this already-modified working tree.

Alternatively, an authorized agent can stage only the first patch from HEAD into the real index while preserving the full working tree, then stage the reviewed second boundary after the formatting commit. Avoid `git add .`, which could include the unrelated Phase 2 draft. Check the exact staged diff before each commit. Pushing and publication require separate authorization.

Patch validation uses temporary index files, not commits, branches or changes to the real index. Applying both patches there must exactly reproduce all owned tracked/new files in the final workspace. Neither a prepared patch nor a green local check is approval to commit.
