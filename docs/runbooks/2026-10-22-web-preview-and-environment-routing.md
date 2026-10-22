# HomeMew Web Preview Staging — 部署与配置手册

Updated: 2026-10-22
Authoritative decision: docs/decisions/2026-10-22-fixed-deployment-environments.md

## 1. Environment model

- Web Production: https://homemew.aisr.online ; backend homemew-backend-production ; LifeSpace Production.
- Web Preview: Cloudflare's named staging Preview **inside the same homemew-web-production Worker project** ; backend homemew-backend-staging ; LifeSpace Staging.
- Mini develop/trial/release: all use https://homemew.aisr.online BFF ; backend homemew-backend-production ; LifeSpace Production.
- No env=staging URL selector or UI warning: arbitrary query parameters do not affect the bound LifeSpace target. /_stage/* BFF paths still fail with 404.
- Keep **both** backend Workers and their distinct Durable Object namespaces; Service Binding from Web Preview invokes the deployed staging backend Worker, not a backend Preview.

## 2. Before deploying: protect the Preview

1. Cloudflare Zero Trust → Access → Applications: prepare a self-hosted Access policy to cover the generated Preview hostname (or the appropriate Preview wildcard), allowing only authorized testers. Preview URLs are public by default.
2. Copy the Preview Access audience (AUD) and register that Access issuer/audience for the HomeMew Application in **LifeSpace Staging Identity only**.
3. Provision/link an existing staging test user to the Preview Access principal through an authorized LifeSpace staging flow. HomeMew Web normally allows only existing-user linking, and Mini now always talks to Production, so Mini cannot confirm a staging challenge. Do not assume Preview Web onboarding works without this prerequisite.
4. GitHub HomeMew → Settings → Environments: create or restrict the preview Environment to trusted branches and authorized reviewers.
5. Keep the existing Production Web Access application and the narrow, existing Mini login/BFF bypasses. Do **not** bypass the entire Preview API.

## 3. Cloudflare Worker bindings and variables

Same Cloudflare Worker project: homemew-web-production

Production tab:
- HOMEMEW_BACKEND → homemew-backend-production
- LIFESPACE_CORE → lifespace-core
- LIFESPACE_IDENTITY → lifespace-identity
- ENVIRONMENT → production
- LIFESPACE_IDENTITY_URL → https://auth.aisr.online
- LIFESPACE_CORE_URL → https://core.aisr.online
- Secrets: LIFESPACE_APPLICATION_CREDENTIAL (Production HomeMew lsa_*) and WEB_SESSION_SECRET (Production random HMAC).

Previews Base tab (the corresponding fields are committed in apps/web/wrangler.production.jsonc):
- HOMEMEW_BACKEND → homemew-backend-staging
- LIFESPACE_CORE → lifespace-core-staging
- LIFESPACE_IDENTITY → lifespace-identity-staging
- ENVIRONMENT → staging
- LIFESPACE_IDENTITY_URL → https://auth-staging.aisr.online
- LIFESPACE_CORE_URL → https://core-staging.aisr.online

Named Preview staging needs exactly TWO Preview-scoped secrets, not the Production secrets:
- LIFESPACE_APPLICATION_CREDENTIAL = lsa_* from the LifeSpace **Staging HomeMew Application**
- WEB_SESSION_SECRET = independently generated random HMAC secret >= 32 characters (e.g., openssl rand -base64 48).

Never put staging/production credentials into GitHub source or logs. Previews do **not** automatically inherit Production secrets. Avoid Previews Base secrets for credentials that should be limited to one named Preview: shared base secrets are inherited by all newly created Previews.

Older STAGING_LIFESPACE_APPLICATION_CREDENTIAL and STAGING_WEB_SESSION_SECRET secrets may still exist on the Production Worker: after deploying this refactor they are unused. Remove only **after** validating the production release and retired route denial; do not copy the unreadable values to Preview.

## 4. Manual deployment sequence — Preview first, Production after acceptance

1. Once CI passes and the feature PR merges to main, enable Worker **Preview URLs** for the existing homemew-web-production Worker in Cloudflare Dashboard → Workers & Pages → Domains, without replacing the current Production code. The production workers.dev route can remain disabled.
2. **Before publishing a Preview**, protect this Worker's Preview hostnames/wildcard with Cloudflare Access. Register the resulting Access audience in LifeSpace **Staging** for the staging HomeMew Application. Review GitHub preview Environment branch/approver restrictions.
3. GitHub Actions → Deploy HomeMew Web Preview → choose a reviewed trusted code branch, confirm DEPLOY_HOMEMEW_WEB_PREVIEW. This creates/updates the named staging Preview under the same Worker, **without changing Production code**.
4. Add TWO Preview-scoped secrets to the named staging Preview from a secure terminal or Preview settings. Wrangler >= 4.135.0 commands from repository root:
   - corepack pnpm dlx wrangler@4.135.0 preview secret put LIFESPACE_APPLICATION_CREDENTIAL --name staging --config apps/web/wrangler.production.jsonc
   - corepack pnpm dlx wrangler@4.135.0 preview secret put WEB_SESSION_SECRET --name staging --config apps/web/wrangler.production.jsonc
   Commands prompt for values. Redeploy the Preview if required; never place secret plaintext in GitHub logs or code.
5. Run full Web Preview + LifeSpace Staging acceptance (Access authentication, staging user, Family Catalog, Goal/Habit/Anniversary models, safe test writes). **Only after acceptance** run GitHub Actions → Deploy HomeMew Web production on main with DEPLOY_HOMEMEW_WEB_PRODUCTION. This publishes the same reviewed code on the existing production custom domain using only Production bindings.
6. Validate existing Production Mini BFF and user journeys. After confirming retired route denial, remove obsolete /_stage/* Cloudflare Access bypass and unused Production STAGING_* secrets, not the staging backend Worker.

Cloudflare Preview URLs can be enabled through the dashboard, without first deploying the new HomeMew Web Production version. Protect the preview host pattern before uploading untrusted code. Do not claim a preview deploy alone proves LifeSpace production compatibility.

## 5. Acceptance / 验收

- Production: verify Web session, normal family read and production-only service bindings. Production Mini login on /api/v1/login/wechat must remain functional.
- Preview: verify /health returns staging, Access JWT is registered to staging HomeMew Application, and logged-in test user can read/create/update test-family records only in LifeSpace Staging. Verify Family Catalog and backend activity on the staging Worker.
- On both Worker versions, /_stage/api/session and /_stage/api/v1/login/wechat return 404, not production fallback.
- Production Web ignores an unrecognized `?env=staging` query; it remains bound to LifeSpace Production. Preview Web remains bound to LifeSpace Staging regardless of query.
- Mini developer/trial/release versions use only Production; upgrading old staging-enabled client clears cached staging bearer and family context once.
- A LifeSpace breaking upgrade is ready for production only after verified Web Preview tests **and** backward compatibility checks with deployed Mini BFF + existing Mini clients. football_match/football_goal remain ordinary models and must be manually published in LifeSpace Console as needed.
- Once live and verified, delete the obsolete Cloudflare Access bypass app covering /_stage paths and remove unused Production Worker STAGING_* secrets. Keep homemew-backend-staging and its Durable Objects.
- Roll back a broken Preview independently; Production rollback follows its existing guarded GitHub deployment/release procedure.
