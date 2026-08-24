# Decision: HomeMew Web owns the production front door

Date: 2026-08-24
Status: Accepted

## Decision

`homemew.aisr.online` is now owned by `homemew-web-production` as the HomeMew production front door.

The Web Worker serves the signed-in browser application and same-origin BFF behind Cloudflare Access. The WeChat Mini Program provider login endpoint remains available at the same public hostname through an exact Access bypass and an explicit Worker Service Binding:

```text
homemew.aisr.online
  -> homemew-web-production
       -> Web / same-origin BFF
       -> POST /api/v1/login/wechat
            -> HOMEMEW_BACKEND
            -> homemew-backend-production
```

The provider backend remains a narrow WeChat identity adapter. It does not regain ownership of HomeMew business data or become a business Core.

## Production safety model

The normal production Wrangler configuration for `homemew-web-production` intentionally does not declare the Custom Domain route. Production domain ownership is changed only by the manual `Cut over HomeMew Web production` workflow.

That workflow requires explicit confirmation and verifies before and after transfer:

- LifeSpace Identity/Core production contract versions;
- Cloudflare Access root protection and exact Mini Program login bypass;
- required Web and integrations Worker secret bindings;
- HomeMew Web tests, typecheck and build;
- Mini Program `POST /api/v1/login/wechat` reaches the existing backend and returns normal request validation rather than Access interception.

When a run actually transfers the domain and a post-transfer verification fails, the workflow attempts to restore the Custom Domain to `homemew-backend-production` and rechecks Mini Program login.

## Cutover result

The final production cutover completed successfully in HomeMew Actions run `32743275547`.

Verified final state:

- `homemew.aisr.online` -> `homemew-web-production`;
- Cloudflare Access root protection passed;
- Mini Program login pass-through via `HOMEMEW_BACKEND` passed;
- LifeSpace production runtime gate passed;
- required Web and integrations secret bindings passed.

An earlier cutover attempt was safely rejected by Cloudflare before domain transfer because an already-owned Custom Domain requires `override_existing_origin`. PR #42 added the explicit override for both transfer and rollback plus regression coverage; the subsequent cutover succeeded.

## Consequences

- Documentation or plans that still describe `homemew.aisr.online` as owned by `homemew-backend-production` are stale and are superseded by this decision.
- Future normal Web deployments must not implicitly move production Custom Domain ownership.
- Mini Program login compatibility remains a release gate for production front-door changes.
- Browser Web traffic and Mini Program provider-login traffic now share one public hostname but retain separate trust/runtime boundaries.
