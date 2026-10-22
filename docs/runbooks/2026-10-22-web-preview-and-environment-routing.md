# HomeMew Web Preview and LifeSpace environment routing / 配置手册

Date: 2026-10-22
Scope: one existing Worker project `homemew-web-production`; **not** a second staging Worker.
See also `docs/decisions/2026-10-22-one-deployment-staging-routing.md`.

## 1. Target / 目标矩阵

| HomeMew code version | URL selector | LifeSpace target |
| --- | --- | --- |
| Production: `https://homemew.aisr.online/` | none or `?env=production` | Production |
| Production | `?env=staging` | Staging |
| Same Worker, named Preview `staging` (use URL reported by Cloudflare) | none or `?env=production` | Production |
| Same Worker, named Preview `staging` | `?env=staging` | Staging |

A missing/invalid Web `env` query **always** selects production, even if the same tab previously visited staging. Internal SPA links preserve an explicit staging query; directly navigating to a URL without it selects production. The parameter is *not* a page feature flag. Browser API requests use either `/api/*` or the **fixed** `/_stage/api/*` namespace. Worker front door chooses fixed service bindings, not a user-provided upstream.

The released WeChat Mini Program always calls `https://homemew.aisr.online`: launch `pages/home/home` for production or `pages/home/home?env=staging` for staging. It **never** calls the Web Preview hostname. Mini staging uses the same BFF with a `/_stage` prefix and clears stored bearer/family state on environment switch.

## 2. Requirements before any production or Preview deployment

1. Both LifeSpace environments must be healthy and *data/storage independent*. Confirm each current Identity/Core contract and model publication independently. `football_match` and `football_goal` are ordinary user-published models, **not baseline**. User publishes them via LifeSpace Console before football E2E.
2. Existing HomeMew staging application backend `homemew-backend-staging`, `lifespace-identity-staging` and `lifespace-core-staging` must be deployed. These are deliberately separate backend services; only the HomeMew **Web front door** shares one Worker.
3. HomeMew Web Production must retain its production bindings, host Custom Domain, production `lsa_*`, production HMAC session key, and protected Access app. Never remove or replace these with staging values.
4. Validate existing narrow Cloudflare Access bypass applications for `/api/v1/login/wechat`, `/api/v1/miniprogram/*`, `/_stage/api/v1/login/wechat`, `/_stage/api/v1/miniprogram/*`. No bypass for `/_stage/api/session` or general `/_stage/api/*`.

## 3. Production Worker: separate staging backend secrets

Worker: `homemew-web-production` → **Settings → Variables and Secrets**:

- `STAGING_LIFESPACE_APPLICATION_CREDENTIAL`: a newly issued `lsa_*` for the **HomeMew Application registered in LifeSpace staging Identity**. Existing staging backend uses another staging credential, whose original plaintext is not readable from Cloudflare. Issue an additional credential through trusted LifeSpace platform-admin tooling, do **not** reuse production `lsa_*`.
- `STAGING_WEB_SESSION_SECRET`: independently generated high-entropy HMAC secret, >=32 characters; example generator `openssl rand -base64 48`. This must differ from production `WEB_SESSION_SECRET`.
- Non-secrets and six fixed production/staging service bindings are declared in `apps/web/wrangler.production.jsonc`, not typed by clients. `STAGING_LIFESPACE_IDENTITY_URL` and `STAGING_LIFESPACE_CORE_URL` must identify staging hosts exactly.

LifeSpace **staging Identity** must register existing HomeMew Production Web Cloudflare Access audience against the staging HomeMew Application (the same Access JWT is passed to staging BFF; its `iss,aud` registration lives in a separate staging database). HomeMew Web onboarding requires explicit linking of the current Access principal to the staging LifeSpace user. Production and staging user IDs/data are not shared.

Changing production Worker secrets affects production Worker settings; schedule/configure safely and validate this before production deploy.

## 4. Preview code version under the same Worker

### 4.1. Cloudflare and GitHub protection

- In Cloudflare Dashboard → Workers & Pages → `homemew-web-production` → Domains, enable **Preview** URLs (the same Worker project; the production `workers.dev` route may remain disabled). Wrangler production config explicitly sets `preview_urls: true`; apply it in the controlled production deployment if not already active.
- **Before creating or sharing the Preview**, use Cloudflare Zero Trust → Access to protect its Preview hostname (or the appropriate Worker Preview wildcard) with authenticated, narrowly allowed testers. Preview URLs are otherwise public by default. Do not blindly bypass its whole `/api/*` or `/_stage/api/*` space.
- Record the Preview Access application's **audience (AUD)** and register it to HomeMew Application in **both** LifeSpace production Identity and LifeSpace staging Identity. This audience is distinct from the existing `homemew.aisr.online` Access audience. Protect any public Mini BFF paths exposed on the Preview hostname; if Preview is Web-only, no public bypass is required.
- In GitHub → Settings → Environments, create `preview` (if missing). Restrict deployment to maintainers/trusted branches; configure required reviewer protection when supported. Preview default requests use production LifeSpace, so **unreviewed code with production credentials can change production data**. Do not automatically deploy all pull requests or share Preview secrets with fork PRs.

### 4.2. Preview-scoped Secrets (not production worker secrets)

New Preview `staging` needs four values independent of production Web **session secrets**, under the same HomeMew Application identity in each target LifeSpace environment:

| Preview secret | Source |
| --- | --- |
| `LIFESPACE_APPLICATION_CREDENTIAL` | Newly issued HomeMew `lsa_*` from **production** LifeSpace Identity |
| `WEB_SESSION_SECRET` | Independent random HMAC secret, >=32 chars |
| `STAGING_LIFESPACE_APPLICATION_CREDENTIAL` | Newly issued HomeMew `lsa_*` from **staging** LifeSpace Identity |
| `STAGING_WEB_SESSION_SECRET` | Different random HMAC secret, >=32 chars |

Use Wrangler >=4.135.0. Once named Preview exists, run these commands from the repository root in a secured terminal (they prompt for secret value; never pass plaintext on the command line or commit it):

```bash
corepack pnpm dlx wrangler@4.135.0 preview secret put LIFESPACE_APPLICATION_CREDENTIAL --name staging --config apps/web/wrangler.production.jsonc
corepack pnpm dlx wrangler@4.135.0 preview secret put WEB_SESSION_SECRET --name staging --config apps/web/wrangler.production.jsonc
corepack pnpm dlx wrangler@4.135.0 preview secret put STAGING_LIFESPACE_APPLICATION_CREDENTIAL --name staging --config apps/web/wrangler.production.jsonc
corepack pnpm dlx wrangler@4.135.0 preview secret put STAGING_WEB_SESSION_SECRET --name staging --config apps/web/wrangler.production.jsonc
```

You may first deploy a protected Preview without the four credentials: application session requests fail closed. Then put the secrets and deploy again. Do **not** use `preview base-config secret put` for production credentials: Base secrets would be inherited by all new Previews, including less-trusted PR branches.

Preview `services` are explicitly mapped in the Wrangler `previews` block: production-target bindings call deployed production Workers, staging-target bindings call deployed staging Workers. Worker Previews do **not** automatically route service bindings to matching Previews of other Workers.

### 4.3. Deploy the Preview code

Run **GitHub Actions → Deploy HomeMew Web Preview → Run workflow** on a *reviewed/trusted* branch or main, with confirmation:

```text
DEPLOY_HOMEMEW_WEB_PREVIEW
```

The workflow is intentionally manual; tests, typechecks, builds, and uses `wrangler@4.135.0 preview --name staging`. It does **not** deploy or transfer the production Custom Domain. Use the Preview URL reported by Cloudflare/GitHub logs; do not guess an account subdomain.

For production, separately run **Deploy HomeMew Web production** on main with `DEPLOY_HOMEMEW_WEB_PRODUCTION`, after its own readiness gates. Production deployment does not implicitly promote a Preview and should preserve the current Custom Domain.

## 5. Acceptance checklist / 验收

1. Production code + no `env` → production HomeMew session and production LifeSpace family records.
2. Production code + `?env=staging` → staging session / staging family records; navigating `/calendar`, `/tasks`, `/football` keeps the staging query, while a direct new URL without `env` reselects production.
3. Preview code + no `env` → **production LifeSpace**, but UI changes come only from the Preview code.
4. Preview code + `?env=staging` → **staging LifeSpace**, UI changes come from Preview code.
5. Compare distinct cookie names and HMAC secrets for LifeSpace environments. Production code / Preview hosts also use host-only cookies (no parent-domain cookie).
6. Confirm production identity/family data never appears in staging queries, and vice versa. Missing staging bindings/credentials must return 503 `STAGING_NOT_CONFIGURED`; never fall back to production.
7. Mini Program: launch with/without `env=staging`, verify token/cache clearing on changes. The Mini never calls a Preview URL.
8. After model publication and migrations in each target LifeSpace environment, perform Web Goal/Habit/Anniversary/Football E2E. Do not claim full acceptance based only on GitHub CI or public health endpoints.

## 6. Rollback

- For a broken Preview, stop testing, disable/limit Access or delete that Preview; this does not revert production Worker code.
- For a broken production deployment, use the approved production Workers deployment rollback procedure. Avoid changing LifeSpace production/staging data or credentials while rolling back the HomeMew code.
- For a leaked `lsa_*`, revoke that individual credential in the corresponding LifeSpace Identity and issue a replacement. For a leaked HMAC secret, replace it; all sessions signed with the old key will be invalidated.
