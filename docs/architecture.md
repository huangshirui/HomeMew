# HomeMew System Architecture

## 1. Positioning

HomeMew is a household application built on LifeSpace. LifeSpace is the platform source of truth for Identity, Spaces/authorization, domain models, Actions, contracts, migrations and business data. HomeMew owns household product UX plus provider-specific application integration.

The legacy HomeMew business Core was retired from the active repository on 2026-08-26 after the completed LifeSpace production migration/cutover. Git history is the archive for its old implementation, OpenAPI and migrations; new HomeMew business behavior must use LifeSpace rather than recreate a local Core.

## 2. Target context

```text
WeChat Mini Program
  ├─ wx.login code ───────────────> HomeMew production front door
  │                                  └─ /api/v1/login/wechat
  │                                       -> HOMEMEW_BACKEND Service Binding
  │                                       -> WeChat jscode2session
  │                                       -> Durable Object: openid -> LifeSpace usr_*
  │                                       -> LifeSpace Identity token exchange
  └─ all normal runtime + bearer ─> stable HomeMew Mini BFF contract
                                     -> fixed HomeMew adapter
                                     -> LifeSpace Identity/Core Service Bindings

HomeMew Web browser
  -> Cloudflare Access
  -> HomeMew Web Worker / same-origin Web session BFF
      ├─ original Cf-Access-Jwt-Assertion
      ├─ dedicated HomeMew-Web lsa_* credential
      ├─ LifeSpace Identity Access principal exchange/linking
      ├─ signed host-only HttpOnly application session
      └─ current LifeSpace Identity/Core contract

HomeMew-managed n8n / Agents / scripts
  -> dedicated LifeSpace Service Principal
  -> one active API Token OR OAuth Client Credentials at steady state
  -> HomeMew integrations application context
  -> model-scoped Data Grants for the intended family
  -> LifeSpace Core
```

The Mini BFF and Web same-origin BFF are distinct contracts even when hosted by the same production Worker. The Mini BFF is a stable HomeMew product/anti-corruption boundary for a review-constrained downloadable client; the Web BFF is a browser trust/session boundary whose server-controlled application follows the current LifeSpace contract. Neither persists household business truth or duplicates LifeSpace authorization.

After Phase 2, Mini runtime code does not address public LifeSpace Core/Identity URLs or wire routes. BFF-to-LifeSpace calls use Cloudflare Service Bindings where supported while preserving the LifeSpace user bearer, request IDs, errors, timeouts and authoritative checks. There is no WeChat Cloud Development dependency and no second HomeMew business Core.

External-system administration is an advanced HomeMew Web capability. The Mini Program remains a lightweight household client and does not create, configure, rotate, revoke or display service credentials or Data Grants. This product boundary is fixed by `docs/decisions/2026-08-24-external-integrations-web-only.md`.

## 3. HomeMew Cloudflare application backend

`apps/backend/` is a narrow trusted WeChat adapter, not a second Core and not the Web Access-principal authority.

Responsibilities:

- receive a one-time `wx.login()` code;
- call the WeChat `jscode2session` server API with the server-only app secret;
- resolve and persist `openid -> LifeSpace user_id` in a HomeMew-owned SQLite-backed Durable Object;
- create a LifeSpace Identity user when the provider identity is first seen;
- authenticate as the registered HomeMew Mini Program LifeSpace application using a server-only `lsa_*` credential;
- request a short-lived LifeSpace user token and return it to the Mini Program.

The Durable Object is keyed by `WeChat appid + openid`, so each external identity has its own coordination/storage unit. Concurrent first-login requests to the same live object share one in-flight user-creation promise before the mapping is persisted. A dedicated HomeMew D1 is intentionally not provisioned for this small identity mapping.

This removes the D1 database-slot cost while retaining strongly consistent per-identity storage. There is still a narrow crash window between a successful LifeSpace user creation and the Durable Object storage write; eliminating that window completely would require an idempotency contract on the LifeSpace user-creation API and therefore is not implemented as a HomeMew-only workaround.

The backend must not persist Spaces/families, events, tasks, day records, wishes or duplicate LifeSpace authorization.

Required secrets/configuration:

- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `LIFESPACE_APPLICATION_CREDENTIAL`
- `LIFESPACE_IDENTITY_URL`
- `LIFESPACE_CORE_URL`
- Durable Object binding `WECHAT_IDENTITIES`

The Mini Program never receives `openid`, the WeChat app secret, or the LifeSpace application credential.

## 4. Mini Program identity flow

```text
Mini Program
-> wx.login()
-> POST HomeMew /api/v1/login/wechat { code }
-> WeChat jscode2session
-> trusted openid
-> resolve HomeMew WechatIdentity Durable Object
-> if mapping absent: POST LifeSpace Identity /internal/v1/users
-> persist openid -> LifeSpace user_id mapping in Durable Object
-> POST LifeSpace Identity /internal/v1/tokens
-> { accessToken, expiresAt, coreApiUrl, identityApiUrl }
```

An existing mapping is authoritative. If LifeSpace later refuses token issuance for a mapped user, HomeMew does not silently create a replacement user and overwrite the mapping; the inconsistency must be investigated instead.

The access token represents the LifeSpace user, has the HomeMew Mini Program application as its authorized party, and carries only the scopes granted to that application. Token refresh repeats this flow with a fresh WeChat code.

### 4.1 Direct-entry startup and silent identity recovery

The Mini Program has no application-level Logo/splash routing page. `pages/home/home` is the default page, while WeChat deep links, shares, notifications, QR codes and enterprise-WeChat entries may open any registered target page directly.

`App.onShow` starts runtime preparation in parallel with the requested page. Short-lived token expiry is never modeled as a user-visible login state: all callers share one in-flight `wx.login() -> HomeMew backend -> LifeSpace token exchange` operation. User/profile and accessible-family initialization is also single-flighted so the App coordinator and the target page do not duplicate startup requests.

First-time or incomplete-profile users are redirected to profile setup only after identity is resolved. The original entry path and query are kept in process memory and restored after profile completion, so onboarding does not collapse a task detail, invite, date anchor or other deep link back to Home. Disabled accounts use the dedicated disabled-state page; ordinary network/service failures stay on the requested page and use that page's retry/error UI.

Non-idempotent writes are never blindly replayed after a 401. The client may silently refresh credentials so the next explicit user retry uses a fresh token.

## 5. HomeMew Web authentication and BFF

`apps/web/` is the HomeMew browser application plus its same-origin BFF. It is separate from `apps/backend/` because Cloudflare Access is a platform Web authentication boundary, while WeChat `openid` remains application-provider mapping owned by the Mini Program adapter.

Target Web stack:

- React + TypeScript;
- Vite + the official Cloudflare Vite plugin;
- Cloudflare Worker serving the Web assets and same-origin API/BFF;
- Cloudflare Access protecting the Web application;
- LifeSpace Identity 0.5.0+ for Access principal verification, audience registration, exchange and account linking.

Authentication flow:

```text
Browser
-> Cloudflare Access login / SSO
-> HomeMew Web Worker receives Cf-Access-Jwt-Assertion
-> Worker authenticates to Identity with the dedicated HomeMew-Web lsa_*
-> POST /internal/v1/access/tokens
-> Identity independently verifies Access JWT signature / issuer / expiry / audience
-> Identity resolves verified (iss, sub) -> global usr_*
-> Identity issues short-lived HomeMew-Web-scoped LifeSpace user token
-> Web Worker stores it only in a signed host-only HttpOnly application session
-> browser calls same-origin /api/lifespace/* BFF paths
-> BFF calls LifeSpace Identity/Core with the LifeSpace user bearer
```

The Web BFF never accepts a browser-supplied `sub`, Access email or target LifeSpace `userId` as identity authority. It forwards the original Cloudflare Access assertion only to the approved Identity Access exchange/linking contract. It does not maintain its own Access principal mapping table.

The HomeMew application session uses a dedicated `WEB_SESSION_SECRET`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and no parent-domain `Domain` attribute. The signed session is bound to a SHA-256 fingerprint of the Access assertion that produced it. If the current Access assertion changes, the old LifeSpace bearer is not reused; the BFF performs a new Identity exchange. This prevents a stale HomeMew session from crossing an Access-user switch in the same browser.

State-changing same-origin BFF/proxy routes require an exact `Origin` match. This remains necessary because cookie SameSite behavior is not an application authorization boundary between sibling subdomains.

Normal Web sessions intentionally do not carry `grants:manage`. `/api/integrations*` performs a fresh Access exchange for only `profile:read grants:manage` when an administrator starts an integration-management operation. Core then independently requires current `manage` authority on the selected family Space before the BFF may create/update service credentials with the separate HomeMew integrations application credential. This is privilege-on-demand, not a second HomeMew role check.

For HomeMew, an unknown Access principal has exactly one onboarding path: link the already-existing HomeMew/LifeSpace account through the Mini Program. HomeMew Web does not expose LifeSpace Access registration and does not create a new LifeSpace user. LifeSpace Identity may retain explicit Access registration as a platform capability for other applications.

```text
unlinked Access principal
  -> Web creates Identity one-time link challenge
  -> already-authenticated Mini Program confirms challenge
  -> Identity derives usr_* from Mini Program bearer
  -> Identity binds the verified Access principal to that existing usr_*
  -> Web retries /api/session
```

The target user ID for account linking is never supplied by Web. Identity owns the Access-principal -> `usr_*` relationship. This HomeMew product policy is fixed by `docs/decisions/2026-08-25-web-existing-user-link-only.md`.

The final Web domain is `homemew.aisr.online`. Since the accepted production cutover on 2026-08-24, that hostname is owned by `homemew-web-production`: browser Web traffic and the same-origin BFF remain behind Cloudflare Access, while the exact `POST /api/v1/login/wechat` provider route uses an Access bypass and the `HOMEMEW_BACKEND` Service Binding to `homemew-backend-production`. Normal Web deployments do not implicitly move Custom Domain ownership; domain transfer/rollback remains a separately confirmed release operation. The dedicated HomeMew Web staging environment is retired by the 2026-09-16 final-BFF decision; production release now uses repository gates plus explicit production smoke verification. See `docs/decisions/2026-08-24-web-production-cutover.md`.

## 6. Household model mapping

HomeMew keeps product-friendly terms in the UI but maps them explicitly at the client service boundary:

| HomeMew | LifeSpace |
|---|---|
| family | HomeMew Family Catalog entry -> LifeSpace `Space` |
| family admin | Space `owner` / `admin` |
| writable member | Space `editor` |
| member reference in business models | Space Person |
| event | `event` model + Calendar capability |
| task | `task` model + Actions |
| day | `day_record` model + Temporal capability |
| wish | `wish` model + Actions |
| 喵一下 | Currently offline; future bounded HomeMew BFF-owned draft orchestration, while confirmed domain records still write to LifeSpace |

HomeMew services may expose `familyId`, `attendeeIds`, `assigneeIds` and similar product DTOs to pages, but translate them to Space IDs/Person IDs before calling LifeSpace.

The HomeMew Family Catalog is the sole product-classification authority for family Spaces. LifeSpace 0.39 no longer exposes `Space.kind`; HomeMew create/list/invite flows must not send, read or infer a family classification from the LifeSpace Space representation.

HomeMew's eight-active-member limit is enforced only on HomeMew membership-join flows. A `FamilyJoinCoordinator` Durable Object is keyed by LifeSpace `spc_*` and serializes invite revalidation, current LifeSpace membership count, and the final LifeSpace join call. It does not persist membership truth. LifeSpace remains authoritative for membership and permission; other generic LifeSpace Spaces are not subject to this product limit.

## 7. Normal Mini Program requests

```text
Mini Program
-> Authorization: Bearer <short-lived LifeSpace user token>
-> stable HomeMew Mini BFF route
-> fixed LifeSpace Identity/Core operation through an internal adapter
```

The shared Mini request client selects explicit HomeMew product routes only. The BFF adapter selects the current LifeSpace operation, parses/preserves standard LifeSpace envelopes and request IDs, enforces timeouts, and does not blindly retry non-idempotent writes.

`currentFamilyId` remains UI state only. LifeSpace Space membership and grant checks are authoritative.

## 8. Normal Web requests

```text
Browser
-> same-origin /api/lifespace/core/v1/* or /api/lifespace/identity/v1/*
-> HomeMew Web BFF resolves the current Access-bound application session
-> Authorization: Bearer <short-lived LifeSpace user token>
-> LifeSpace Core/Identity
```

The browser never receives the LifeSpace user bearer or the HomeMew-Web `lsa_*` application credential. The BFF is a narrow authenticated transport boundary; it does not translate LifeSpace authorization into a separate HomeMew server authorization model.

## 9. Media

- Current-user avatar: `PUT LifeSpace Identity /api/v1/me/avatar`.
- Family avatar: `PUT LifeSpace Core /api/v1/spaces/{spaceId}/avatar`, including the current Space `version` in multipart data.
- Household images do not use WeChat Cloud Storage.

Web uploads go through the same-origin BFF and preserve the LifeSpace multipart contract rather than storing media in HomeMew.

## 10. Data ownership

HomeMew-owned Durable Object storage may hold provider/application integration metadata such as the WeChat identity mapping and the Family Catalog (`spc_*` classification only). It must not become an authoritative household data store. Family Catalog entries classify a LifeSpace Space for HomeMew presentation; Space name, membership, authorization and household records remain LifeSpace truth.

The Web BFF may hold only short-lived browser application-session state and server-only application credentials; durable HomeMew application metadata is owned by the application backend. Neither may persist an Access-principal mapping, service-token/client-secret plaintext, a HomeMew integration permission table, or household business records.

Authoritative household data, service-principal state, credentials and authorization live in LifeSpace. Mini Program/browser storage is cache/UI state only.

For a HomeMew-created external system, the owning family Space is recorded as a HomeMew-namespaced binding in the LifeSpace Service Principal description (`homemew:v1:space=<spc_*>`) because the current LifeSpace Service Principal schema has no application metadata field. This is application ownership metadata stored on the authoritative LifeSpace principal, not a second HomeMew permission store. The user-facing description is stored after the marker and the BFF strips the marker before returning the DTO.

A Data Grant by itself is deliberately **not** treated as credential-management ownership. Data Grants express what the service may access; they do not prove which Space may rotate a globally usable credential for that Service Principal.

## 11. External systems

LifeSpace Core Kernel 0.15.0+ and Identity 0.5.0 provide the approved HomeMew external-system authority:

- Identity owns Service Principals, `lsp_pat_*` API Tokens and OAuth Client Credentials;
- Core owns Data Grants, Application × Model Access, reusable Eventing Webhook Endpoints, model/event subscription filters and delivery;
- model-collection Data Grants can target a published `modelKey` with `read`, `write` or `manage`;
- stable credential scopes remain `resources:read`, `resources:write`, and where needed `resources:manage`.

HomeMew Web uses a low-frequency list/detail information architecture:

```text
/settings/integrations
  -> external-system summary list

/settings/integrations/:integrationId
  -> external-system detail
       -> Authentication
       -> Event subscriptions
       -> future integration capabilities
```

The list page is intentionally compact and does not expose every editable setting. A family administrator enters a specific external system before changing credentials, Data Grants or integration behavior. Future synchronization rules, notification channels, MCP/Agent settings and similar external-system-specific capabilities must be added to this detail container instead of creating new top-level Settings entries.

Each HomeMew external system corresponds to one independent LifeSpace Service Principal with one explicit owning family Space binding. The external-system detail treats the following as child configuration of that same principal:

- **Authentication**: credential mode, active credential, controlled rotation/mode switching, family model Data Grants and direct LifeSpace API connection information;
- **Event push**: one HomeMew-managed Webhook Endpoint for this external system, with one callback URL/signing secret and selectable model/event subscription filters.

```text
current Access-authenticated family administrator
  -> HomeMew Web lsa_* exchanges Access assertion for profile:read + grants:manage / spaces:manage as required
  -> Core verifies current family Space manage authority

HomeMew integrations BFF
  -> verifies Service Principal HomeMew Space ownership binding
  -> separate LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL (lsa_*)
  -> Identity Service Principal / API Token / OAuth credential APIs

resulting service
  -> stable credential scopes
  ∩ integrations Application × Model Access
  ∩ current per-family model Data Grants
  -> LifeSpace Core business records

Event push
  -> managing HomeMew application context
  -> one Webhook Endpoint for current family Space + external-system Service Principal
  -> shared Webhook URL + signing secret
  -> Event Subscription filters select model + created/updated/deleted
  -> current subscriber Data Grant required for every selected model
  -> LifeSpace Eventing Webhook delivery
```

Rules:

- one HomeMew external system gets one independent Service Principal and one explicit owning family Space binding;
- steady state is exactly one authentication mode (`api_token` or `oauth_client_credentials`) and one active credential;
- the platform's 1:N credential storage is not exposed as normal multi-key management;
- rotation is create-new -> update external system -> verify -> explicitly complete; only during this transition may old and new credentials coexist;
- switching authentication mode uses the same controlled transition and may briefly have both modes active until completion; cancel revokes the new candidate and keeps the previous credential;
- API Token or Client Secret plaintext is returned once and may exist only in current React/module memory while being shown; it must never be persisted by HomeMew or placed in URLs/router history state;
- new integrations receive only explicit model-collection Grants, currently for `event`, `task`, and `day_record`;
- `wish` is not exposed to external systems in this first Web slice;
- disabling a system disables the Service Principal first, then attempts to revoke its current family Grants and all active API Token/OAuth credentials;
- a Data Grant from another Space does not transfer Service Principal or credential management rights to that Space;
- a migrated Service Principal without the HomeMew Space ownership binding may be surfaced read-only when the current family has a historical/current Grant to it, but HomeMew must not list its credential metadata, rotate/revoke credentials, edit it, or disable it until a controlled migration establishes ownership;
- a Service Principal explicitly bound to a different Space is never surfaced merely because the current Space also has a Data Grant to it;
- a migrated whole-Space `read/write/manage` Grant remains broader than per-model Grants and is surfaced explicitly; HomeMew must not claim a model is denied while that fallback Grant is active;
- a Webhook Endpoint owns transport/signing only and grants no model authority; HomeMew configures one Endpoint per external system in the current product UI, while LifeSpace may support multiple Endpoints for applications that genuinely need multiple destinations;
- an Event Subscription filter is not an authorization grant: Core requires the Endpoint subscriber Service Principal to hold a current `read`/`write`/`manage` Data Grant for the selected model (or equivalent whole-Space Grant);
- Core re-checks the subscriber Data Grant before matching and delivering events, so Grant revocation/expiry or HomeMew integration disable stops new event delivery without a duplicate HomeMew event-authority store;
- Webhook payloads remain reference-only; the same external system uses its Service Principal credential and current Data Grant to read full business data when needed;
- the browser never receives either the Web `lsa_*` or the integrations `lsa_*`;
- the Mini Program does not expose external-system administration or secret handling.

The integrations application must be separately registered/configured in LifeSpace and should have only the intended stable scope ceiling and Application × Model Access. The HomeMew Web application must allow the narrow on-demand manager scopes needed by external-system and subscription administration; the normal ambient browser session still does not request those elevated scopes.

The code may be deployed before the integrations application credential is installed. In that state `/health` reports `integrationsReady=false`, normal HomeMew Web continues to operate, and integration routes fail closed with `INTEGRATIONS_NOT_CONFIGURED`. After staging provisioning and E2E verification, the integrations credential should become a required deployment secret.

## 12. Migration/cutover rules

- Do not dual-write HomeMew Core and LifeSpace.
- Do not recreate the retired broad legacy `/api/v1/families/...` facade. The final Mini BFF may expose explicit HomeMew product routes, but never an arbitrary generic proxy or second business model.
- HomeMew production business data is authoritative in LifeSpace after the completed production cutover.
- HomeMew Web has no permanent dedicated staging release environment. The temporary Phase 4 review-window staging surface defined by `docs/decisions/2026-09-18-phase4-temporary-web-staging-validation.md` was retired after the successful Event v6 production cutover and Mini/Web smoke verification; normal releases use repository gates plus explicit production smoke verification.
- `apps/backend/` keeps the application-owned WeChat identity mapping; `apps/web/` never duplicates it.
- Production Web activation must not break the existing Mini Program `/api/v1/login/wechat` application-provider endpoint.
- The legacy HomeMew Core source is retired from the active repository. Any still-existing old HomeMew Worker/D1 resources remain frozen/read-only only for the explicit stabilization/rollback-evidence window and require a separate operations decision before physical deletion.

## 13. LifeSpace change boundary

If HomeMew discovers a missing platform capability, finish independent HomeMew work and document the gap. Any LifeSpace repository modification requires explicit user approval first and must then follow LifeSpace's own `AGENTS.md`.
