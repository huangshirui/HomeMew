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

The foundation already includes the responsive App Shell, Today and the real household routes. Do not introduce Next.js, SSR/RSC or another framework layer for the signed-in household app.

Keep dependencies demand-driven:

- add TanStack Query only when current React context/local-state patterns stop being sufficient;
- add Schedule-X only when a richer Calendar renderer materially improves the product;
- prefer URL state, React Context and local browser/UI state before adding Redux/Zustand or another global state library.

## Product routes

- `/` — Today / household overview
- `/calendar`
- `/tasks`
- `/days`
- `/wishes`
- `/family`
- `/settings`
- `/settings/integrations` — external-system summary list
- `/settings/integrations/:integrationId` — one external system's authentication, event subscriptions and future integration capabilities

Desktop uses a sidebar. Mobile uses bottom navigation. Tablet adapts within the same codebase. The visual direction is warm, calm and household-oriented rather than enterprise-admin/ERP styled.

`apps/display/` is a separate future household-display runtime and is not implemented as a mode inside the normal signed-in Web app.

External-system administration is intentionally Web-only. The accepted product boundary is recorded in `docs/decisions/2026-08-24-external-integrations-web-only.md` and the list/detail + event-subscription structure is recorded in `docs/decisions/2026-08-25-lifespace-event-subscriptions.md`.

HomeMew onboarding is intentionally asymmetric across clients. The Mini Program is the base client and first-use/account-entry client; HomeMew Web is an advanced client for an existing HomeMew user. The accepted policy is recorded in `docs/decisions/2026-08-25-web-existing-user-link-only.md`.

## Cloudflare deployment model

One Cloudflare Worker deployment owns both the SPA assets and the thin same-origin BFF:

```text
Browser
  -> homemew.aisr.online
       -> Workers Static Assets -> React SPA
       -> /api/* and /health -> Worker BFF
```

The Worker hosts two deliberately separate application boundaries:

- the Web same-origin BFF, an authentication/session/application-orchestration boundary whose server-controlled Web client follows the current LifeSpace contract;
- explicit public Mini BFF product routes, a stable anti-corruption/release-lag contract for the reviewed Mini Program.

Both boundaries must not:

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
- `POST /api/access/link-challenge`
- `/api/integrations*` bounded external-system orchestration
- `/api/lifespace/core/v1/*`
- `/api/lifespace/identity/v1/*`

An unknown Access principal is never silently merged by email and HomeMew Web does not create a new LifeSpace user. The only HomeMew Web onboarding path is **Link existing account**: Web creates a one-time link challenge and an already-authenticated HomeMew Mini Program confirms it as its current LifeSpace user.

Identity derives the target `usr_*`; Web never submits a target user ID. LifeSpace may retain Access registration as a platform capability for other applications, but HomeMew Web does not expose or proxy it.

### Existing-account linking UX

The initial production UX intentionally keeps the security contract visible and simple:

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

Manual copy/paste is the initial confirmation UX. A later QR code or Mini Program deep-link may carry the same `challengeId`, but it must not weaken or replace the Identity challenge/confirmation contract.

If a person has never used HomeMew, the Web UI directs them to complete first use in the Mini Program and return to link the Web login. This avoids creating a second global LifeSpace user as a normal HomeMew onboarding outcome. Future LifeSpace user-merge capability remains a platform concern rather than a prerequisite for normal HomeMew Web onboarding.

## External integrations boundary

`/settings/integrations` is a low-frequency external-system **list**. It shows compact operational summaries and is not a wall of editable credentials and Grants. Selecting a system opens `/settings/integrations/:integrationId`, which is the extensible detail container for all capabilities belonging to that external system.

The first detail modules are:

```text
External system = one LifeSpace Service Principal
  -> Authentication
       -> credential mode / current credential
       -> credential rotation or mode switch
       -> model-scoped family Data Grants
       -> direct LifeSpace API connection information
  -> Event push
       -> one shared Webhook Endpoint bound to this Service Principal
       -> selectable model/event subscription filters
  -> future external-system-specific capabilities
```

Future synchronization rules, notification channels, MCP/Agent configuration or similar integration features should be added to this detail surface instead of becoming new top-level Settings entries.

HomeMew uses LifeSpace Service Principals, API Tokens / OAuth Client Credentials and model-scoped Data Grants directly; HomeMew does not own a credential store or permission table.

Two separate LifeSpace application contexts are involved:

```text
HomeMew Web application
  lsa_* -> Access exchange for the current human
  normal session scopes do not include grants:manage

HomeMew integrations application
  separate lsa_* held only by the Worker
  -> create/update Service Principals
  -> create/list/revoke service credentials
```

For every integration-management request the Worker performs a fresh Access exchange for only `profile:read grants:manage`, obtains the current `usr_*`, and calls `GET /api/v1/spaces/{spaceId}/grants?includeRevoked=true`. Core therefore proves both the `grants:manage` credential scope and the user's current `manage` authority on the selected Space before the BFF performs any service-principal operation.

The UI exposes model collection permissions for `event`, `task`, and `day_record`. Stable service credential scopes remain `resources:read` / `resources:write`; model identity belongs to Application × Model Access and Data Grants.

One HomeMew external system has exactly one selected authentication mode and one active credential at steady state:

- `api_token` -> long-lived opaque `lsp_pat_*` bearer;
- `oauth_client_credentials` -> OAuth 2.0 Client Credentials.

LifeSpace may hold multiple credential rows, but HomeMew does not expose arbitrary multi-key management. Rotation is a controlled temporary exception: create a candidate, update and verify the external system, then explicitly complete by revoking the previous credential(s). Cancel revokes the candidate and keeps the previous credential. Switching authentication mode uses the same controlled flow.

New integrations do not receive whole-Space Grants. Migrated principals that still have a whole-Space `read/write/manage` Grant are surfaced as broad legacy authority and are not falsely represented as model-restricted.

Credential plaintext is returned once by LifeSpace and rendered only in current React/module memory. API Tokens and OAuth Client Secrets are not written to URLs, React Router history state, localStorage/sessionStorage or a HomeMew database.

The external-system detail page shows the household Core API Base URL including the current `spaceId`. Machine clients call LifeSpace Core directly with the service credential; they do not call the Cloudflare Access-protected HomeMew Web hostname.

### Event push and subscriptions

Event push is not a standalone HomeMew setting. It is configured inside one external system and uses the LifeSpace Core Kernel 0.15.0+ Endpoint/filter split.

The current HomeMew product exposes one Webhook Endpoint per external system: one callback URL, one signing secret, one endpoint-level enable/disable switch, one test action and one combined delivery history. The signing secret is returned only when the Endpoint is created or explicitly rotated and is never persisted by HomeMew.

Under that Endpoint, HomeMew exposes `event` (日程) and `task` (待办) as selectable Event Subscription filters. Selecting a model does not create another Webhook or another secret; it only attaches the selected model plus `record.created` / `record.updated` / `record.deleted` choices to the existing Endpoint.

LifeSpace requires the Endpoint subscriber Service Principal to retain a current Data Grant that can read every selected model. It re-checks current Application × Model Access and subscriber Grant state before matching and queued delivery. Revoking/expiring a model Grant therefore stops that model's new events without HomeMew maintaining a second authority table.

Payloads remain reference-only and contain no full business record or actor identity. Endpoint-level delivery history includes `modelKey` so shared-destination diagnostics remain clear.

With both 日程 and 待办 wired through this shared Endpoint, the current event-subscription milestone is complete for now. `day_record` and future models remain explicit later product decisions rather than being automatically exposed because the LifeSpace Eventing layer is generic.

## Required configuration

Server-only Worker secrets:

- `LIFESPACE_APPLICATION_CREDENTIAL` — dedicated trusted **HomeMew Web** LifeSpace application credential (`lsa_*`), not the Mini Program credential;
- `WEB_SESSION_SECRET` — at least 32 characters;
- `LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL` — separate trusted LifeSpace application credential used only for HomeMew-managed service principals and credentials.

The HomeMew Web LifeSpace application must allow `grants:manage` so the BFF can request the narrow on-demand manager token. The normal ambient Web session intentionally does not request that scope.

The integrations LifeSpace application has only the stable service scope ceiling needed by the product (`resources:read` / `resources:write`) and Core Application × Model Access for the explicitly supported HomeMew models.

All three Worker secrets above are required production runtime prerequisites. Deployment checks binding names without printing secret values.

Non-secret configuration:

- `ENVIRONMENT`
- `LIFESPACE_IDENTITY_URL`
- `LIFESPACE_CORE_URL`

The Worker must sit behind the intended Cloudflare Access application. The original assertion comes from `Cf-Access-Jwt-Assertion`; browser JSON must never be accepted as an assertion source.

`/health` reports base `ready` and separate `integrationsReady`; production smoke verification expects both to be ready.

## Production release

HomeMew Web has no dedicated staging environment after the accepted 2026-09-16 final-BFF decision. This does not remove LifeSpace staging or unrelated test environments.

The user-facing domain is:

```text
homemew.aisr.online
```

Since the accepted production cutover on 2026-08-24, it is owned by `homemew-web-production`. Browser Web traffic remains behind Cloudflare Access. Explicit Mini application routes—including `POST /api/v1/login/wechat` and the stable Mini BFF surface—use narrowly scoped Access bypass rules, still require their own LifeSpace user bearer where applicable, and delegate only to fixed internal operations.

Release path:

```text
local tests / typecheck / build
-> CI
-> explicit production deployment
-> production smoke verification
```

Normal production deployment configuration intentionally does not claim or move the Custom Domain. Domain ownership transfer or rollback remains a separate confirmation-gated operation and must preserve all Mini routes.

## Tests and builds

```bash
pnpm dev:web
pnpm typecheck:web
pnpm build:web
pnpm test:web
pnpm check
```

`pnpm test:web` runs dependency-free Worker/BFF tests for both the normal Access session boundary and the external-integration orchestration boundary, including credential mode/rotation behavior. It also asserts that HomeMew Web does not expose the LifeSpace Access registration flow.

The root check validates the active HomeMew application surfaces: backend syntax, Mini Program tests/typecheck, and Web BFF tests/typecheck/build. The retired legacy HomeMew Core is not part of the active workspace.
