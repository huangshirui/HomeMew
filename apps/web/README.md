# HomeMew Web

HomeMew Web is the primary browser application for HomeMew. It is a LifeSpace client, not a second business Core.

## Current stack

```text
React 19
TypeScript
Vite
React Router (SPA / library mode)
Tailwind CSS
local shadcn/ui-style primitives
Lucide Icons

Cloudflare Vite Plugin
Cloudflare Workers + Static Assets
pnpm workspace
```

The foundation already includes the responsive App Shell, Today preview and the first product routes. Do not introduce Next.js, SSR/RSC or another framework layer for the signed-in household app.

Keep dependencies demand-driven:

- add TanStack Query when real LifeSpace server-state integration begins;
- add Schedule-X when `/calendar` becomes a real calendar surface;
- prefer URL state, React Context and local browser/UI state before adding Redux/Zustand or another global state library.

## Product routes

- `/` — Today / household overview
- `/calendar`
- `/tasks`
- `/days`
- `/wishes`
- `/family`
- `/settings`
- `/settings/integrations`

Desktop uses a sidebar. Mobile uses bottom navigation. Tablet adapts within the same codebase. The visual direction is warm, calm and household-oriented rather than enterprise-admin/ERP styled.

`apps/display/` is a separate future household-display runtime and is not implemented as a mode inside the normal signed-in Web app.

## Cloudflare deployment model

One Cloudflare Worker deployment owns both the SPA assets and the thin same-origin BFF:

```text
Browser
  -> homemew.aisr.online
       -> Workers Static Assets -> React SPA
       -> /api/* and /health -> Worker BFF
```

The Worker BFF is an authentication/session/application-orchestration boundary only. It must not:

- create a HomeMew `/families/...` business contract;
- persist Spaces, events, tasks, day records, wishes or other household data;
- duplicate LifeSpace authorization/model validation;
- become another business Core.

## Authentication boundary

Cloudflare Access is the long-term Web authentication and SSO layer. Authorization Code + PKCE is **not** the target LifeSpace browser architecture.

```text
Browser
  -> Cloudflare Access
  -> HomeMew Web Worker
       reads Cf-Access-Jwt-Assertion
       never trusts browser-supplied sub/email/userId
       -> LifeSpace Identity /internal/v1/access/* with dedicated server-only lsa_*
       -> Identity independently verifies Access JWT + audience
       -> Identity resolves (iss, sub) -> global usr_*
       -> short-lived HomeMew-Web-scoped LifeSpace user token
  -> signed host-only HttpOnly HomeMew session
  -> same-origin BFF -> LifeSpace Identity/Core
```

HomeMew Web never stores its own Access-subject -> `usr_*` mapping. That mapping belongs to LifeSpace Identity.

The BFF session is HMAC-authenticated with `WEB_SESSION_SECRET` and bound to a SHA-256 fingerprint of the current Access assertion. If the Access principal changes, the previous LifeSpace session is not reused.

State-changing BFF/proxy requests require an exact same-origin `Origin` header. Cookies, Access assertion headers and application credentials are never forwarded as arbitrary browser headers to Core/Identity; the BFF adds only the resolved LifeSpace user bearer.

## Implemented BFF routes

`worker.mjs` currently provides:

- `GET /health`
- `GET /api/session`
- `POST /api/session/logout`
- `POST /api/access/register`
- `POST /api/access/link-challenge`
- `/api/integrations*` bounded external-system orchestration
- `/api/lifespace/core/v1/*`
- `/api/lifespace/identity/v1/*`

An unknown Access principal is never silently merged by email. The UI exposes two explicit paths:

1. **Link existing account** — Web creates a one-time link challenge; an already-authenticated HomeMew Mini Program confirms it as its current LifeSpace user.
2. **Create new account** — Web explicitly calls Access registration with the chosen display name.

Identity derives the target `usr_*`; Web never submits a target user ID.

### Existing-account linking UX

The first staging/MVP UX intentionally keeps the security contract visible and simple:

```text
HomeMew Web
  -> POST /api/access/link-challenge
  -> show alc_... one-time challenge

HomeMew Mini Program
  -> 我的 -> 设置 -> 关联 Web 登录
  -> paste alc_...
  -> POST LifeSpace Identity /api/v1/me/access-link-challenges/{challengeId}/confirm
     with the Mini Program's existing LifeSpace user bearer

HomeMew Web
  -> GET /api/session again
  -> same global usr_* session
```

The challenge is high-entropy, short-lived and single-use. The Mini Program never accepts or sends a target `userId`; the authenticated bearer is the only proof of which LifeSpace user is confirming the link.

Manual copy/paste is the staging/MVP confirmation UX. A later QR code or Mini Program deep-link may carry the same `challengeId`, but it must not weaken or replace the Identity challenge/confirmation contract.

## External integrations boundary

`/settings/integrations` uses LifeSpace Service Principals, Service API Tokens and model-scoped Data Grants directly; HomeMew does not own a credential store or permission table.

Two separate LifeSpace application contexts are involved:

```text
HomeMew Web application
  lsa_* -> Access exchange for the current human
  normal session scopes do not include grants:manage

HomeMew integrations application
  separate lsa_* held only by the Worker
  -> create/update Service Principals
  -> create/list/revoke lsp_pat_* credentials
```

For every integration-management request the Worker performs a fresh Access exchange for only `profile:read grants:manage`, obtains the current `usr_*`, and calls `GET /api/v1/spaces/{spaceId}/grants?includeRevoked=true`. Core therefore proves both the `grants:manage` credential scope and the user's current `manage` authority on the selected Space before the BFF performs any service-principal operation.

The first UI exposes model collection permissions for `event`, `task`, and `day_record`. Stable service token scopes remain `resources:read` / `resources:write`; model identity belongs to Application × Model Access and Data Grants.

New integrations do not receive whole-Space Grants. Migrated principals that still have a whole-Space `read/write/manage` Grant are surfaced as broad legacy authority and are not falsely represented as model-restricted.

Token plaintext is returned once by Identity and rendered only in current React memory. It is not written to localStorage/sessionStorage or a HomeMew database.

## Required configuration

Base server-only secrets:

- `LIFESPACE_APPLICATION_CREDENTIAL` — dedicated trusted **HomeMew Web** LifeSpace application credential (`lsa_*`), not the Mini Program credential;
- `WEB_SESSION_SECRET` — at least 32 characters.

External integrations additionally require:

- `LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL` — a separate trusted LifeSpace application credential used only for HomeMew-managed service principals and credentials.

The HomeMew Web LifeSpace application must allow `grants:manage` so the BFF can request the narrow on-demand manager token. The normal ambient Web session intentionally does not request that scope.

The integrations LifeSpace application should have only the stable service scope ceiling needed by the product (currently `resources:read` / `resources:write`) and Core Application × Model Access for the explicitly supported HomeMew models.

Non-secret configuration:

- `ENVIRONMENT`
- `LIFESPACE_IDENTITY_URL`
- `LIFESPACE_CORE_URL`

The Worker must sit behind the intended Cloudflare Access application. The original assertion comes from `Cf-Access-Jwt-Assertion`; browser JSON must never be accepted as an assertion source.

`/health` reports base `ready` and separate `integrationsReady`. Before the integrations credential is installed, normal HomeMew Web remains usable while `/api/integrations*` fails closed with `INTEGRATIONS_NOT_CONFIGURED`.

## Staging and production

The isolated first Web environment is:

```text
homemew-web-staging.aisr.online
```

The final user-facing domain remains:

```text
homemew.aisr.online
```

That production hostname currently also serves the Mini Program login endpoint through `homemew-backend-production`. Do not move the production domain to the Web Worker until staging proves the Access flow and the Web front-door preserves `/api/v1/login/wechat` through an explicit backend service-binding/pass-through.

Production configuration intentionally contains no Web custom-domain route yet.

## Tests and builds

```bash
pnpm dev:web
pnpm typecheck:web
pnpm build:web
pnpm test:web
pnpm check
```

`pnpm test:web` runs dependency-free Worker/BFF tests for both the normal Access session boundary and the external-integration orchestration boundary.

The root check includes Mini Program typecheck, Web typecheck/build, BFF tests, legacy Core contract/tests/typecheck/build and therefore treats the Web application as a first-class repository surface.
