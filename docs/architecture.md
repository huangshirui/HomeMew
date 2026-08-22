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
  │                                  └─ LifeSpace Identity internal token exchange
  │
  ├─ profile/avatar + user token ─> LifeSpace Identity
  └─ household business + token ──> LifeSpace Core

HomeMew Web Browser
  └─ homemew.aisr.online
       ├─ React SPA static assets
       └─ same-origin /api/* session/API gateway
            └─ LifeSpace Identity/Core

n8n / Agents / other applications
  └─ their own LifeSpace application/service identity + Data Grants ─> LifeSpace
```

There is no WeChat Cloud Development dependency and no permanent HomeMew compatibility BFF for normal business APIs. The Web same-origin gateway is an authentication/session edge boundary, not a second business API or Core.

## 3. HomeMew Cloudflare application backend

`apps/backend/` is a narrow trusted adapter, not a second Core.

Responsibilities:

- receive a one-time `wx.login()` code;
- call the WeChat `jscode2session` server API with the server-only app secret;
- resolve and persist `openid -> LifeSpace user_id` in a HomeMew-owned SQLite-backed Durable Object;
- create a LifeSpace Identity user when the provider identity is first seen;
- authenticate as the registered HomeMew LifeSpace application using a server-only `lsa_*` credential;
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

## 4. Identity flow

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

The access token represents the LifeSpace user, has the HomeMew application as its authorized party, and carries only the scopes granted to that application. Token refresh repeats this flow with a fresh WeChat code.

The approved target browser flow is centralized LifeSpace Identity Authorization Code + PKCE / redirect SSO. Identity owns its host-only session cookie at `auth.aisr.online`; HomeMew Web owns a separate host-only app session cookie at `homemew.aisr.online`. The browser does not receive HomeMew application credentials or persistent service credentials.

The current LifeSpace Identity public contract does not yet expose that browser authorization flow. HomeMew must not substitute the trusted `/internal/v1/tokens` exchange as a browser login mechanism. The missing browser-auth contract requires a separately approved LifeSpace change.

## 5. Household model mapping

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

## 6. Normal Mini Program requests

```text
Mini Program
-> Authorization: Bearer <short-lived LifeSpace user token>
-> LifeSpace Identity/Core
```

The shared request client selects Identity or Core explicitly, parses standard LifeSpace envelopes, propagates request IDs, serializes token refresh and does not blindly retry non-idempotent writes.

`currentFamilyId` remains UI state only. LifeSpace Space membership and grant checks are authoritative.

## 7. Media

- Current-user avatar: `PUT LifeSpace Identity /api/v1/me/avatar`.
- Family avatar: `PUT LifeSpace Core /api/v1/spaces/{spaceId}/avatar`, including the current Space `version` in multipart data.
- Household images do not use WeChat Cloud Storage.

## 8. Data ownership

HomeMew-owned Durable Object storage may hold provider/application integration metadata such as the WeChat identity mapping. It must not become an authoritative household data store.

Authoritative household data and authorization live in LifeSpace. Mini Program storage is cache/UI state only.

The HomeMew Web session/API gateway may hold only application/session security state needed for the browser flow. It must not persist or become authoritative for household business records.

## 9. External systems

LifeSpace Data Grants are the target authorization mechanism for n8n, Agents, devices and other software principals.

The legacy HomeMew Mini Program also contains an administrator UI that creates “external systems” and issues API tokens/client secrets. At the time of this cutover, LifeSpace exposes Data Grant management but does not yet expose an equivalent end-user flow for provisioning a new service principal plus its credential. Do not recreate this as a HomeMew-only credential authority. Keep that surface unavailable until a separately approved LifeSpace capability is defined.

## 10. Migration/cutover rules

- Do not dual-write HomeMew Core and LifeSpace.
- Do not keep a permanent `/api/v1/families/...` facade in front of LifeSpace.
- Migrate data once, validate, then cut the Mini Program over.
- Staging and production HomeMew Workers use separate Durable Object namespaces and separate secrets.
- Production provider mapping and a production `lsa_*` credential are application secrets and must be established only during an explicitly authorized production cutover.
- The old HomeMew Core domain may continue to exist temporarily for rollback/reference, but post-cutover Mini Program business traffic must not use it.

## 11. LifeSpace change boundary

If HomeMew discovers a missing platform capability, finish independent HomeMew work and document the gap. Any LifeSpace repository modification requires explicit user approval first and must then follow LifeSpace's own `AGENTS.md`.

## 12. Web and display surfaces

`apps/web/` is the primary HomeMew browser application and is intended for `homemew.aisr.online`. It is a client-rendered React SPA deployed with Cloudflare Workers Static Assets. Normal household functions and household-admin settings live in the same Web product; household administration is authorized by the user's LifeSpace Space role and is not a separate platform-admin site.

Phase W1 is assets-only. Once the LifeSpace browser authorization contract exists, the same Cloudflare Web deployment gains a thin same-origin `/api/*` Worker session/API gateway. The gateway establishes the app-local browser session and forwards authenticated requests to LifeSpace Identity/Core. It keeps application credentials and server-side tokens out of frontend JavaScript, applies Origin/CSRF protections for cookie-authenticated writes, and propagates LifeSpace request IDs.

This gateway is not a compatibility or business BFF: it must not define a second household business contract, persist authoritative household data, duplicate LifeSpace model validation, or make authorization decisions that replace LifeSpace Space/Grant checks.

Until the browser-auth platform capability is separately approved and implemented, the Web app may contain clearly labelled preview data for UI development but must not invent production authentication or embed `lsa_*`/service credentials in browser code.

`apps/display/` is reserved for `homemew-display.aisr.online`. It remains separate because a household wall display/TV/Raspberry Pi should ultimately use a narrowly scoped device identity and read-only grants rather than a household administrator's long-lived browser session.

See `docs/web-plan.md` for the Web information architecture, technology baseline and delivery phases.
