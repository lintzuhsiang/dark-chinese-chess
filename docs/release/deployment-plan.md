# Deployment preparation — no publication authorized

## Local, provider-independent preparation

Use the repository directory containing pnpm-workspace.yaml, package.json, and apps/ as the build root, not its enclosing Desktop directory. Use Node 26 and pnpm 12.18.0, matching CI. Development tooling also supports Node 22.18+ on the 22 line and 24.11+ on the 24 line.

1. Install with `pnpm install --frozen-lockfile`.
2. Run lint, format:check, typecheck, unit tests, production build, and Chromium/WebKit E2E.
3. Run `pnpm verify:release`. It builds and checks index metadata, referenced production JS/CSS, missing assets, source-map/source/test files, and known test-hook markers. Its JSON output lists SHA-256 hashes and byte sizes. It performs no upload and does not prove hosted behavior.
4. Record candidate commit, hosted Verify run URL, bundle manifest, device evidence/gap acceptance, owner acceptance, and rollback target in the release checklist. Deploy only this tested revision/output; do not substitute an unverified working tree.

The complete upload directory is **apps/web/dist/**. The workspace packages, source, node_modules, tests, docs, pnpm lockfile, and original runtime deck/session are not upload inputs. Vite's default root base `/` suits the recommended provider URL. No client routing is currently implemented; no router/framework adapter is needed.

## Proposed Workers settings — pending provider/account approval

`deployment/cloudflare-worker.example.json` is an inactive review template. Its assets path is relative to that file, resolves to apps/web/dist, and uses SPA fallback. There is no `main`, Worker runtime code, resource binding, secret, or custom domain. The name is a proposed placeholder, not a reserved or created resource. JSON/path/build checks are local; Wrangler schema validation and provider behavior have not run.

After separate approval:

- Approve provider, owner account, project name, repository connection, preview visibility and production publication procedure.
- Add a pinned supported Wrangler development dependency and validate the proposed assets configuration locally with its dry-run tooling before connecting an account.
- Use the workspace as build root. Install with frozen pnpm lockfile; build command `pnpm build`; assets directory is the template's `../apps/web/dist`. Use Node 26/pnpm 12.18.0 explicitly rather than relying on provider defaults.
- Initially prefer owner-triggered publication of the exact tested artifact/revision over native auto-deploy. If Git builds are later connected, disable automatic production promotion; version uploads and preview commands still create externally accessible URLs and require approval.
- Use a provider-supplied HTTPS workers.dev URL. No DNS/custom domain, paid plan, Durable Object, backend, analytics, or persistence resources are needed.
- Never put an API token into source, client environment variables, logs, artifacts, or examples. Provision account credentials only after account configuration approval, with permissions limited to the approved resource.

After the dependency/provider configuration is approved, the local configuration validation command is `pnpm exec wrangler deploy --dry-run --config deployment/cloudflare-worker.example.json`. Its actual schema/runtime result must be recorded before hosted use; it has not been executed here. After the separate account/resource/publication approvals and a hosted CI pass, the reviewed publication command would be `pnpm exec wrangler deploy --config deployment/cloudflare-worker.example.json`, with the owner-approved name/settings. The example remains inactive and no command is run merely by installing or building this workspace.

No runnable deployment script or deployment workflow is added now. Existing CI is read-only and has no hosting credentials. A green local build is not production authorization; a passing hosted Verify run for the exact release revision is mandatory. If a later manual workflow is approved, use an explicitly approved production environment and revision check; do not infer approval from a push/merge.

## Preview and production checks — future authorized execution

Public preview creation requires its own authorization. Record revision and URL; confirm HTTPS, JavaScript/CSS MIME/content, refresh at `/`, asset URLs, startup without console errors, full local gameplay, invalid feedback, undo/restart, history and direct Review navigation. Verify accepted terminal outcomes, including chase-only NO_LEGAL_ACTION. Use the existing deterministic phone procedure only in dedicated test tabs, never a player's live game.

Check direct navigation/fallback for any routes actually introduced; today the application has only `/`. Confirm missing asset requests do not silently produce a blank app. Native Workers routing must be tested on Workers, not inferred from Vite's preview fallback. Physical phone/native zoom and timing remain pending until devices are tested or their gaps/risks are explicitly accepted.

## Rollback

Before a second production release, record the prior successful deployment/version ID, commit, artifact hashes, URL, and owner-approved rollback procedure. On a confirmed release-blocking failure, use the provider's eligible retained version rollback after authorization, then rerun HTTPS/assets/start/gameplay/Review smoke checks and record the restored version. Retain a local/CI artifact and exact lockfile as a fallback rebuild source. There is no database migration to undo, and in-memory games are not persisted or restored by deployment rollback.

First-release limitation: there is no previous production deployment to roll back to. The owner must approve a fallback (for example temporarily disabling publication) or a separately approved known-good candidate before first publication. Do not claim rollback has been exercised before an actual hosted trial. [Workers rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
