# HomeMew Web

HomeMew Web is the browser application for HomeMew. It is a LifeSpace client, not a second business Core.

## Target stack

The long-term frontend stack is:

- React + TypeScript;
- Vite;
- Cloudflare Workers + the official Cloudflare Vite plugin;
- same-origin Worker BFF for browser-to-LifeSpace calls;
- Cloudflare Access for Web authentication and SSO.

The first implementation slice intentionally lands the authentication/BFF boundary before adding the React package dependencies. This keeps the platform identity integration independently testable and avoids building UI against an unproven authentication path.

## Authentication boundary

```text
Browser
  -> Cloudflare Access
  -> HomeMew Web Worker
       reads Cf-Access-Jwt-Assertion
       never trusts browser-supplied sub/email/userId
       -> LifeSpace Identity /internal/v1/access/* with server-only lsa_*
       -> Identity independently verifies Access JWT + audience
       -> Identity resolves (iss, sub) -> global usr_*
       -> short-lived HomeMew-Web-scoped LifeSpace user token
  -> signed host-only HttpOnly HomeMew session
  -> same-origin BFF -> LifeSpace Identity/Core
```

HomeMew Web never stores its own Access-subject -> `usr_*` mapping. That mapping belongs to LifeSpace Identity.

The BFF session is additionally bound to a SHA-256 fingerprint of the current Access assertion. A browser that changes to another Access principal cannot reuse the previous LifeSpace user session cookie; the BFF performs a fresh Identity exchange.

## Implemented BFF routes

`worker.mjs` currently provides:

- `GET /health` — deployment/configuration health without exposing secrets;
- `GET /api/session` — resolve/reuse the current Access-bound LifeSpace session and return the current LifeSpace profile;
- `POST /api/session/logout` — clear only the HomeMew application session;
- `POST /api/access/register` — explicit create-new-LifeSpace-account path for an unlinked Access principal;
- `POST /api/access/link-challenge` — create the one-time Identity challenge used to link the Web principal to an existing LifeSpace account;
- `/api/lifespace/core/v1/*` — same-origin authenticated proxy to LifeSpace Core `/api/v1/*`;
- `/api/lifespace/identity/v1/*` — same-origin authenticated proxy to LifeSpace Identity `/api/v1/*`.

State-changing BFF/proxy requests require an exact same-origin `Origin` header. Cookies, Access assertion headers and application credentials are never forwarded to Core/Identity as arbitrary client headers; the BFF adds only the resolved LifeSpace user bearer.

## Required configuration

Server-only secrets:

- `LIFESPACE_APPLICATION_CREDENTIAL` — dedicated trusted **HomeMew Web** LifeSpace application credential (`lsa_*`), not the Mini Program credential;
- `WEB_SESSION_SECRET` — at least 32 characters, used only to authenticate the host-only BFF session cookie.

Non-secret configuration:

- `ENVIRONMENT`;
- `LIFESPACE_IDENTITY_URL`;
- `LIFESPACE_CORE_URL`.

The Worker must sit behind the intended Cloudflare Access application. The original Access assertion is obtained from `Cf-Access-Jwt-Assertion`; the BFF does not accept an assertion supplied in JSON by browser code.

## Account linking behavior

An unknown Access principal is not silently merged by email and is not automatically treated as the existing Mini Program user.

The UI will offer two explicit paths:

1. **Link existing account** — create `/api/access/link-challenge`, then let the already-authenticated HomeMew Mini Program confirm that challenge as its current LifeSpace user.
2. **Create new account** — explicitly call `/api/access/register` with the user's chosen display name.

A later Mini Program UI slice will add the challenge confirmation/deep-link experience. Identity derives the target `usr_*` from the Mini Program's authenticated LifeSpace bearer; Web never submits a target user ID.

## Product routes

The confirmed first HomeMew Web product surface is:

- `/` — household home/overview;
- `/calendar`;
- `/tasks`;
- `/days`;
- `/wishes`;
- `/family`;
- `/settings`;
- `/settings/integrations`.

Desktop uses a sidebar; mobile uses bottom navigation. The visual direction should remain warm and household-oriented rather than looking like an enterprise admin/ERP product.

## Domain and cutover

The final user-facing Web domain is `homemew.aisr.online`.

That hostname currently also serves the production Mini Program login endpoint through `homemew-backend-production`. Do not move the production domain to the Web Worker until the Web Worker can preserve `/api/v1/login/wechat` through an explicit HomeMew backend service-binding/pass-through and the staging Access flow has been proven.

The first Web deployment should therefore use an isolated staging hostname/Access application. Production Mini Program traffic is not changed by this BFF slice.

## Tests

The BFF has dependency-free Node tests and is included in the repository root check:

```bash
pnpm test:web
pnpm check
```

Tests cover Access-required fail-closed behavior, server-only token handling, signed session binding to the Access assertion, same-origin mutation protection, explicit registration, link-challenge creation and authenticated Core proxying.
