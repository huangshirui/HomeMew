# Decision: Fixed deployment environments for HomeMew Web and Mini

Date: 2026-10-22
Status: Accepted
Supersedes: `2026-10-22-one-deployment-staging-routing.md` (URL switching and dual-target Preview).

## Boundaries / 环境边界

- LifeSpace Production and Staging maintain independent Identity, Core, models, grants, persistence and applications.
- HomeMew **Web Production**, at `homemew.aisr.online`, has only production service bindings: `HOMEMEW_BACKEND=homemew-backend-production`, `LIFESPACE_CORE=lifespace-core`, `LIFESPACE_IDENTITY=lifespace-identity`, production URLs, a production HomeMew `lsa_*` and session key.
- HomeMew **Web Preview** is a *code version in the same* `homemew-web-production` Worker project, with only staging service bindings: `HOMEMEW_BACKEND=homemew-backend-staging`, `LIFESPACE_CORE=lifespace-core-staging`, `LIFESPACE_IDENTITY=lifespace-identity-staging`, staging URLs, staging HomeMew `lsa_*` and separate session key.
- HomeMew **Mini Program**, including development, trial and release clients, always uses the production HomeMew front door/BFF and production LifeSpace. No launch-query backend selector.
- **Retire `?env=staging` and `/_stage/api/*`** entirely. Old Web query opens a deprecation warning instead of silently switching to production; old `/_stage/*` BFF requests return 404. Worker deployment controls backend selection, not the URL or UI.
- Keep both narrow HomeMew backend Workers and their distinct Durable Object namespaces. Web Preview needs independent staging Family Catalog, Family Join Coordinator, External System Catalog and activity state, even though it does not need WeChat login.

## Test responsibilities / 验收分工

- LifeSpace breaking changes and HomeMew Web UX changes: **Web Preview + staging HomeMew backend + LifeSpace Staging**, prior to LifeSpace production cutover.
- Mini Program development/trial code: **LifeSpace Production** through the stable HomeMew Mini BFF, with a disposable test Space. Do not bypass the reviewed Mini contract.
- Staging Web E2E alone never proves compatibility of already-distributed Mini code with a planned LifeSpace production breaking update. Validate the frozen Mini BFF and deployed Mini compatibility before a production LifeSpace migration.

## Security & deployment

- Preview has exactly two independent Preview-scoped secrets: staging HomeMew Application `LIFESPACE_APPLICATION_CREDENTIAL` and independent `WEB_SESSION_SECRET`; never inject production `lsa_*` into Preview.
- Protect Preview hostname using Cloudflare Access; register its Access audience to staging HomeMew Application in staging Identity only; do not expose Preview public Mini BFF bypasses.
- Preview Service Bindings target their named staging Workers' deployed code, not those Workers' own Previews.
- Restrict Preview GitHub Environment/branches. Both Web production and Preview deployments require explicit approval and separate workflows. Keep staging backend deployed.
- After live route-denial validation, delete the obsolete `/_stage/*` Cloudflare Access bypass application and then remove old unused production Worker `STAGING_*` secrets.
- `football_match` and `football_goal` remain user-published ordinary models, not baseline models. No LifeSpace repo changes are authorized by this decision.
- See `docs/runbooks/2026-10-22-web-preview-and-environment-routing.md` for operator setup and smoke checks.
