# Decision: Rename HomeMew Web Worker to homemew-web

Date: 2026-10-22
Status: Accepted
Scope: the existing **same Worker resource**, Production/Preview, CI, Web front door; no application data migration.

## Motivation

The Web Worker is the shared code project for both the Production deployment and the named staging Preview. The earlier `homemew-web-production` name incorrectly implies separate Web Workers for different environments. The canonical name is **`homemew-web`**.

## Implementation and safety

- Rename the **existing Cloudflare Worker ID `260f99bcf41b4290925ac5e35ce41d31`**, not provision another Worker. Use Cloudflare Workers' resource-oriented Worker PATCH API with the immutable ID and only the new `name` field.
- Keep production custom domain **`homemew.aisr.online`** attached to that same Worker ID. Existing production Secrets, three Service Bindings, deployed version, Access host policies and future Preview configuration must remain intact. The Worker currently has no active Previews.
- Keep `homemew-backend-production` and `homemew-backend-staging` untouched; their Durable Objects are separately managed. LifeSpace Production/Staging also remain untouched.
- Change all **active** Wrangler config, Web deployment checks, test assertions, workflow summaries, current docs, and operator runbook to `homemew-web`. Historical 2026-08-24 cutover and superseded decisions may preserve the old name as an accurate historical reference.
- Both production and Preview deployment workflows call `apps/web/verify-cloudflare-worker.mjs` before Wrangler. It checks the expected immutable Worker ID and custom-domain ownership; a missing/wrong Worker fails closed instead of letting Wrangler accidentally create a duplicate `homemew-web`.
- The GitHub Environment names `production` and `preview` are still **environment names**; the manual confirmation values `DEPLOY_HOMEMEW_WEB_PRODUCTION` and `DEPLOY_HOMEMEW_WEB_PREVIEW` remain unchanged.
- Do not run a production code deployment merely to rename the Worker. Verify the same ID, domain reference and version deployment after PATCH, plus a read-only production health / Mini BFF route smoke test. If Cloudflare PATCH changes domain routing unexpectedly, restore the previous Worker name using the same immutable ID, and re-verify domain.
- Preview URL suffix (if later enabled) uses the new Worker name, but it does not need migration because no Preview exists yet.

## Expected boundaries after rename

`homemew-web` Production → HomeMew Backend Production + LifeSpace Production.

`homemew-web` named Web Preview → HomeMew Backend Staging + LifeSpace Staging.

All Mini clients → `homemew.aisr.online` and LifeSpace Production. No URL environment selector.
