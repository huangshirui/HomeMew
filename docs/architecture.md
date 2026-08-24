# HomeMew System Architecture

## 1. Positioning

HomeMew is a household application built on LifeSpace. LifeSpace is the platform source of truth for Identity, Spaces/authorization, domain models, Actions, contracts, migrations and business data. HomeMew owns household product UX plus provider-specific application integration.

The legacy `apps/core` implementation remains in this repository only as a migration/reference source until it is explicitly retired; new HomeMew business behavior must not be added there.

## 2. Target context

```text
WeChat Mini Program
  ├─ wx.login code ───────────────> HomeMew Cloudflare application backend
  │                                  ├─ WeChat jscode2session
  │                                  ├─ Durable Object: openid -> LifeSpace usr_*
  │                                  └─ LifeSpace Identity trusted application exchange
  │
  ├─ profile/avatar + user token ─> LifeSpace Identity
  └─ household business + token ──> LifeSpace Core

HomeMew Web browser
  -> Cloudflare Access
  -> HomeMew Web Worker / same-origin BFF
      ├─ original Cf-Access-Jwt-Assertion
      ├─ dedicated HomeMew-Web lsa_* credential
      ├─ LifeSpace Identity Access principal exchange/linking
      └─ signed host-only HttpOnly application session
  -> LifeSpace Identity/Core

HomeMew-managed n8n / Agents / scripts
  -> dedicated LifeSpace Service Principal + lsp_pat_*
  -> HomeMew integrations application context
  -> model-scoped Data Grants for the intended family
  -> LifeSpace Core
```

There is no WeChat Cloud Development dependency and no permanent HomeMew compatibility BFF for normal business APIs. The HomeMew Web BFF is an application/browser trust and orchestration boundary only; it does not persist household business data or implement a second authorization model.

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

Unknown Access principals are explicit flows, never email merges:

```text
unlinked Access principal
  ├─ link existing LifeSpace account
  │    -> Web creates Identity one-time link challenge
  │    -> already-authenticated Mini Program confirms challenge
  │    -> Identity derives usr_* from Mini Program bearer
  │
  └─ create new LifeSpace account
       -> explicit Identity Access registration
       -> create usr_* + bind verified (iss, sub) atomically
```

The target user ID for account linking is never supplied by Web. Identity owns the Access-principal -> `usr_*` relationship.

The final Web domain is `homemew.aisr.online`. That hostname currently also carries the production Mini Program login endpoint through `homemew-backend-production`. A later controlled production Web cutover must preserve `/api/v1/login/wechat`, preferably by routing that application-provider endpoint from the Web front-door Worker to `apps/backend/` through an explicit service binding. Until that is proven in staging, the Web Worker uses an isolated staging hostname/Access application and does not take production Mini Program traffic.

## 6. Household model mapping

HomeMew keeps product-friendly terms in the UI but maps them explicitly at the client service boundary:

| HomeMew | LifeSpace |
|---|---|
| family | `Space(kind=family)` |
| family admin | Space `owner` / `admin` |
| writable member | Space `editor` |
| member reference in business models | Space Person |
| event | `event` model + Calendar capability |
| task | `task` model + Actions |
| day | `day_record` model + Temporal capability |
| wish | `wish` model + Actions |
| 喵一下 | Registry Creation Draft capability |

HomeMew services may expose `familyId`, `attendeeIds`, `assigneeIds` and similar product DTOs to pages, but translate them to Space IDs/Person IDs before calling LifeSpace.

## 7. Normal Mini Program requests

```text
Mini Program
-> Authorization: Bearer <short-lived LifeSpace user token>
-> LifeSpace Identity/Core
```

The shared request client selects Identity or Core explicitly, parses standard LifeSpace envelopes, propagates request IDs, serializes token refresh and does not blindly retry non-idempotent writes.

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

HomeMew-owned Durable Object storage may hold provider/application integration metadata such as the WeChat identity mapping. It must not become an authoritative household data store.

The Web BFF may hold only short-lived browser application-session state and server-only application credentials. It must not persist an Access-principal mapping, service-token plaintext, a HomeMew integration permission table, or household business records.

Authoritative household data, service-principal state, credentials and authorization live in LifeSpace. Mini Program/browser storage is cache/UI state only.

For a HomeMew-created external system, the owning family Space is recorded as a HomeMew-namespaced binding in the LifeSpace Service Principal description (`homemew:v1:space=<spc_*>`) because the current LifeSpace Service Principal schema has no application metadata field. This is application ownership metadata stored on the authoritative LifeSpace principal, not a second HomeMew permission store. The user-facing description is stored after the marker and the BFF strips the marker before returning the DTO.

A Data Grant by itself is deliberately **not** treated as credential-management ownership. Data Grants express what the service may access; they do not prove which Space may rotate a globally usable credential for that Service Principal.

## 11. External systems

LifeSpace Kernel 0.13.0 and Identity 0.5.0 provide the approved HomeMew external-system authority:

- Identity owns Service Principals and `lsp_pat_*` / OAuth service credentials;
- Core owns Data Grants and Application × Model Access;
- model-collection Data Grants can target a published `modelKey` with `read`, `write` or `manage`;
- stable credential scopes remain `resources:read`, `resources:write`, and where needed `resources:manage`.

The HomeMew Web route `/settings/integrations` is therefore a real LifeSpace-backed surface rather than a HomeMew credential authority.

```text
current Access-authenticated family administrator
  -> HomeMew Web lsa_* exchanges Access assertion for profile:read + grants:manage
  -> Core verifies current family Space manage authority

HomeMew integrations BFF
  -> verifies Service Principal HomeMew Space ownership binding
  -> separate LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL (lsa_*)
  -> Identity self-service Service Principal / Token APIs

resulting service
  -> stable token scopes
  ∩ integrations Application × Model Access
  ∩ current per-family model Data Grants
  -> LifeSpace Core
```

Rules:

- one HomeMew external system gets one independent Service Principal and one explicit owning family Space binding;
- a Data Grant from another Space does not transfer Service Principal or Token management rights to that Space;
- Token plaintext is returned once and must never be persisted by HomeMew;
- new integrations receive only explicit model-collection Grants, currently for `event`, `task`, and `day_record`;
- `wish` is not exposed to external systems in this first Web slice;
- disabling a system disables the Service Principal first, then attempts to revoke its current family Grants and active Tokens;
- a migrated Service Principal without the HomeMew Space ownership binding may be surfaced read-only when the current family has a historical/current Grant to it, but HomeMew must not list its Token metadata, rotate/revoke credentials, edit it, or disable it until a controlled migration establishes ownership;
- a Service Principal explicitly bound to a different Space is never surfaced merely because the current Space also has a Data Grant to it;
- a migrated whole-Space `read/write/manage` Grant remains broader than per-model Grants and is surfaced explicitly; HomeMew must not claim a model is denied while that fallback Grant is active;
- the browser never receives either the Web `lsa_*` or the integrations `lsa_*`.

The integrations application must be separately registered/configured in LifeSpace and should have only the intended stable scope ceiling and Application × Model Access. The HomeMew Web application must allow on-demand `grants:manage`; the normal ambient browser session still does not request it.

The code may be deployed before the integrations application credential is installed. In that state `/health` reports `integrationsReady=false`, normal HomeMew Web continues to operate, and integration routes fail closed with `INTEGRATIONS_NOT_CONFIGURED`. After staging provisioning and E2E verification, the integrations credential should become a required deployment secret.

## 12. Migration/cutover rules

- Do not dual-write HomeMew Core and LifeSpace.
- Do not keep a permanent `/api/v1/families/...` facade in front of LifeSpace.
- HomeMew production business data is authoritative in LifeSpace after the completed production cutover.
- Staging and production HomeMew Workers use separate Durable Object namespaces, application credentials, Access applications/audiences and session secrets.
- `apps/backend/` keeps the application-owned WeChat identity mapping; `apps/web/` never duplicates it.
- Production Web activation must not break the existing Mini Program `/api/v1/login/wechat` application-provider endpoint.
- The old HomeMew Core/D1 remains frozen/read-only only for the explicit stabilization/rollback-evidence window and must not receive new normal writes.

## 13. LifeSpace change boundary

If HomeMew discovers a missing platform capability, finish independent HomeMew work and document the gap. Any LifeSpace repository modification requires explicit user approval first and must then follow LifeSpace's own `AGENTS.md`.
