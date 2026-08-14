# HomeMew System Architecture

## 1. Positioning

HomeMew is a household application built on LifeSpace. LifeSpace is the platform source of truth for Identity, Spaces/authorization, domain models, Actions, contracts, migrations and business data. HomeMew owns household product UX plus provider-specific application integration.

The legacy `apps/core` implementation remains in this repository only as a migration/reference source until it is explicitly retired; new HomeMew business behavior must not be added there.

## 2. Target context

```text
WeChat Mini Program
  ├─ wx.login code ───────────────> HomeMew Cloudflare application backend
  │                                  ├─ WeChat jscode2session
  │                                  ├─ HomeMew D1: openid -> LifeSpace usr_*
  │                                  └─ LifeSpace Identity internal token exchange
  │
  ├─ profile/avatar + user token ─> LifeSpace Identity
  └─ household business + token ──> LifeSpace Core

n8n / Agents / other applications
  └─ their own LifeSpace application/service identity + Data Grants ─> LifeSpace
```

There is no WeChat Cloud Development dependency and no permanent HomeMew compatibility BFF for normal business APIs.

## 3. HomeMew Cloudflare application backend

`apps/backend/` is a narrow trusted adapter, not a second Core.

Responsibilities:

- receive a one-time `wx.login()` code;
- call the WeChat `jscode2session` server API with the server-only app secret;
- resolve and persist `openid -> LifeSpace user_id` in a small HomeMew-owned D1;
- create a LifeSpace Identity user when the provider identity is first seen;
- authenticate as the registered HomeMew LifeSpace application using a server-only `lsa_*` credential;
- request a short-lived LifeSpace user token and return it to the Mini Program.

It must not persist Spaces/families, events, tasks, day records, wishes or duplicate LifeSpace authorization.

Required secrets/configuration:

- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `LIFESPACE_APPLICATION_CREDENTIAL`
- `LIFESPACE_IDENTITY_URL`
- `LIFESPACE_CORE_URL`
- D1 binding `DB`

The Mini Program never receives `openid`, the WeChat app secret, or the LifeSpace application credential.

## 4. Identity flow

```text
Mini Program
-> wx.login()
-> POST HomeMew /api/v1/login/wechat { code }
-> WeChat jscode2session
-> trusted openid
-> lookup HomeMew D1 mapping
-> if absent: POST LifeSpace Identity /internal/v1/users
-> POST LifeSpace Identity /internal/v1/tokens
-> { accessToken, expiresAt, coreApiUrl, identityApiUrl }
```

The access token represents the LifeSpace user, has the HomeMew application as its authorized party, and carries only the scopes granted to that application. Token refresh repeats this flow with a fresh WeChat code.

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

HomeMew-owned D1 may store provider/application integration metadata such as the WeChat identity mapping. It must not become an authoritative household data store.

Authoritative household data and authorization live in LifeSpace. Mini Program storage is cache/UI state only.

## 9. External systems

LifeSpace Data Grants are the target authorization mechanism for n8n, Agents, devices and other software principals.

The legacy HomeMew Mini Program also contains an administrator UI that creates “external systems” and issues API tokens/client secrets. At the time of this cutover, LifeSpace exposes Data Grant management but does not yet expose an equivalent end-user flow for provisioning a new service principal plus its credential. Do not recreate this as a HomeMew-only credential authority. Keep that surface unavailable until a separately approved LifeSpace capability is defined.

## 10. Migration/cutover rules

- Do not dual-write HomeMew Core and LifeSpace.
- Do not keep a permanent `/api/v1/families/...` facade in front of LifeSpace.
- Migrate data once, validate, then cut the Mini Program over.
- Production provider mapping and a production `lsa_*` credential are application secrets and must be established only during an explicitly authorized production cutover.
- The old HomeMew Core domain may continue to exist temporarily for rollback/reference, but post-cutover Mini Program business traffic must not use it.

## 11. LifeSpace change boundary

If HomeMew discovers a missing platform capability, finish independent HomeMew work and document the gap. Any LifeSpace repository modification requires explicit user approval first and must then follow LifeSpace's own `AGENTS.md`.
