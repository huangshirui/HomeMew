# Decision: One HomeMew Worker, independent code previews and LifeSpace environment routing

Date: 2026-10-22
Status: Accepted architecture; implementation rollout pending configuration
Scope: HomeMew Web front door, Mini runtime environment selection; **not** a UI feature toggle.

## Motivation / 背景

One HomeMew Web Worker project has a production code deployment and optional Cloudflare Worker Preview deployments of unmerged/new Web code. **Code version is independent from LifeSpace data environment.** On *either* code version, the URL explicitly selects LifeSpace staging or (by default) production. No separate HomeMew Web staging Worker project is created. LifeSpace production and staging retain independent Identity/Core deployments and persistent data.

## User-facing convention / 入口

- Web normal: `https://homemew.aisr.online/` -> production.
- Web staging: `https://homemew.aisr.online/?env=staging` -> production *code* with staging LifeSpace. Any Worker Preview URL without `env` -> LifeSpace production; the same Preview URL with `?env=staging` -> LifeSpace staging. `?env=production` is equivalent to omitting `env`. No UI feature toggle.
- Web `env` is **not persisted in sessionStorage**: removing the query immediately selects production. Internal React Router links and redirects explicitly carry `env=staging` so normal navigation stays in staging; direct navigation to a URL without the query intentionally resets to production.
- Preview and production use the **same** server-side environment router and application codebase; only the deployed *version* and Preview-scoped configuration differ.
- Mini normal: `pages/home/home` -> production.
- Mini staging: `pages/home/home?env=staging` (or another registered entry page with `?env=staging`) -> the Mini runtime's app backend base URL becomes `https://homemew.aisr.online/_stage`; all stable Mini BFF and wx.login endpoints stay HomeMew application routes. Switching environments invalidates cached token, expiry, current family and cached domain display state. A cold launch defaults to production. No second Mini binary is required, but this code still needs to be shipped in a published Mini version.

## Routing and isolation / 隔离

- The production front-door Worker recognizes only a fixed `/_stage/api/*` prefix, removes that prefix **before** routing to its existing explicit Web/Mini product BFF contracts, and selects **fixed** staging LifeSpace service bindings and application backend, URLs and secrets.
- It never accepts a browser-supplied upstream base URL, core path, credential, or arbitrary `env` header. An unknown path remains in the production route namespace; staging routing is derived from the trusted path only.
- Staging needs `HOMEMEW_BACKEND_STAGING`, `LIFESPACE_CORE_STAGING`, `LIFESPACE_IDENTITY_STAGING` service bindings; `STAGING_LIFESPACE_CORE_URL` / `STAGING_LIFESPACE_IDENTITY_URL` set to the verified staging hosts; and separately provisioned Worker secrets `STAGING_LIFESPACE_APPLICATION_CREDENTIAL` and `STAGING_WEB_SESSION_SECRET` (>=32 chars).
- `__Host-homemew_staging_session` differs from the production `__Host-homemew_session`. Different HMAC secrets and cookies prevent staging Identity tokens being reused as production sessions. Family UI preference and daily activity report cache keys are environment-scoped. Origin CSRF enforcement, request IDs, Cloudflare Access JWT verification and LifeSpace authorization remain unchanged.
- If **any** staging configuration is unavailable, respond 503 `STAGING_NOT_CONFIGURED` instead of accidentally calling production. Do not deploy routing before validating Cloudflare bindings, Access ingress policies, LifeSpace staging Application × Model permissions, staging Access audience/exchange, and staging backend Durable Object bindings/credentials.
- Cloudflare Access must continue to protect the Web paths. Review the existing Mini BFF and WeChat login bypass rules **specifically for the additional `/_stage/api/v1/login/wechat` and `/_stage/api/v1/miniprogram/*` routes**; add narrow route exceptions as needed without opening the entire `/_stage/api/*` prefix publicly. This is a deployment configuration requirement, not a feature-flag/UI mechanism.
- Within each **code version** assets are deployed once, and the same `/calendar`, `/habits`, `/football` React routes support both LifeSpace environments. Worker Preview deploys a different code version/assets under the same Worker project; there is no second HomeMew staging Worker project.

## Cloudflare Preview / 代码版本维度

- Use Worker Previews (`wrangler >=4.135.0`) on the existing `homemew-web-production` Worker **project**, with a manual, review-gated named Preview `staging`; do not create a new `homemew-web-staging` Worker. The existing production deploy stays separately gated.
- `previews.vars` explicitly defaults to LifeSpace production, and `previews.services` explicitly maps **both** fixed sets of LifeSpace and HomeMew backend bindings. Cloudflare Worker Previews do not inherit production variables or secrets. Preview Service Bindings route to the named target Workers' deployed versions, not to automatically matched previews of those Workers.
- Preview has its own four secrets: production-Identity `LIFESPACE_APPLICATION_CREDENTIAL`, `WEB_SESSION_SECRET`, staging-Identity `STAGING_LIFESPACE_APPLICATION_CREDENTIAL`, `STAGING_WEB_SESSION_SECRET`. Distinct session secrets are required. LifeSpace `lsa_*` never enters repo, GitHub artifacts, or browser code. Both target Identity instances must associate the **Preview Cloudflare Access audience** with their own HomeMew Application.
- Restrict Preview URL with Cloudflare Access **before sharing/running it**. Do not allow unreviewed/untrusted code to deploy with production credentials, because Preview default requests can write production data. Preview deployment is manual and GitHub Environment `preview` should require authorized reviewers. The normal Mini Program never points at a Preview URL and remains on the published production HomeMew front door.
- Preview is for code testing, not a third LifeSpace data environment. Both preview and production perform the same `/_stage/api/*` routing and fail closed on incomplete staging credentials. See `docs/runbooks/2026-10-22-web-preview-and-environment-routing.md`.

## Domain Web changes / 业务范围

Activity, Goal, Habit, Anniversary use current LifeSpace baseline models and governed model Actions. Habit creator may designate another family Person; only its actual authenticated Person can check in or manage. Anniversary is a distinct annual all-day presentation in month/week calendar; 2/29 only appears in leap years (do not silently shift). Football screens use the Notion draft `football_match` and `football_goal` model contracts with Activity competition and PersonGroup teams. Those football models are **not** in the merged LifeSpace baseline as of this PR, so their publication/registration is an explicit prerequisite for live use; HomeMew must not emulate missing business models locally.

Analytics V1 is currently a bounded client aggregate of explicitly fetched football records, with a hard upper bound and an error rather than an unbounded silent partial metric. Authoritative server-side indexed aggregation remains a follow-up LifeSpace proposal if scale requires it. No new HomeMew business database or cross-env data movement.

## Review / rollout

1. Code review + full Web/Mini unit tests and typecheck in PR, including URL reset and navigation-preservation tests.
2. Confirm the latest LifeSpace staging Core schema 72 and published baseline; register football models via the authorized LifeSpace process before football E2E.
3. Provision staging credentials and Cloudflare Access ingress exceptions, validate isolation and login on one *deployed* HomeMew production front door in a controlled operator-approved release.
4. Before deploying any Preview, configure Access protection and LifeSpace Access audiences. Use manual GitHub Environment approval for any branch with Preview production credentials.
5. Validate all four combinations: production/Preview code × production/staging LifeSpace data. Do not treat a merged PR or passing CI as evidence of deployment or real end-to-end validation. Production defaults must remain unchanged.
