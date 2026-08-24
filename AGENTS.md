# HomeMew Agent Instructions

HomeMew is the household product/application layer. **LifeSpace is the platform system of record** for Identity, Spaces/Grants, domain models, platform contracts, migrations, and platform deployment configuration.

## Read before making changes

1. `docs/architecture.md`
2. `docs/product-rules.md`
3. Accepted decisions under `docs/decisions/` that apply to the surface being changed
4. The README and nested `AGENTS.md` for the HomeMew surface being changed
5. The current LifeSpace contracts/implementation relevant to the change (read-only unless the user separately authorizes a LifeSpace change)
6. Relevant tests and implementation files

Accepted decisions are binding for their explicitly scoped topic and supersede older conflicting planning/reference wording until that wording is synchronized.

## Sources of truth

- Platform API paths, schemas, authentication, authorization, models, Actions, migrations and runtime behavior: `huangshirui/LifeSpace`.
- HomeMew product terminology, UX and application-specific identity/provider mapping: this repository.
- `apps/core/` is legacy HomeMew Core retained only for migration/reference until explicitly removed. Do not add new business behavior there and do not treat its OpenAPI as the current platform contract.

When HomeMew needs a capability LifeSpace does not provide, do not invent a hidden compatibility backend. Identify the exact platform gap and obtain explicit approval before modifying LifeSpace.

## Mandatory architecture rules

- HomeMew household business data lives in LifeSpace, not in a HomeMew database or WeChat Cloud Database.
- HomeMew “family” maps to LifeSpace `Space(kind=family)`.
- HomeMew users map to LifeSpace Identity users; member-facing domain references map through Space Person IDs where the LifeSpace contract requires them.
- The Mini Program calls LifeSpace Identity/Core directly for normal authenticated requests.
- A small HomeMew Cloudflare application backend handles WeChat provider trust only: `wx.login` code exchange, `openid -> LifeSpace user_id` mapping, and exchange of the server-only LifeSpace application credential for a short-lived user token.
- The WeChat identity mapping is stored in a SQLite-backed Durable Object keyed per WeChat application identity; do not provision a dedicated HomeMew D1 merely for this mapping.
- Never expose WeChat `appsecret`, LifeSpace `lsa_*` application credentials, service credentials, signing keys, or other backend secrets to Mini Program code.
- External-system administration is an advanced Web-only capability. Follow `docs/decisions/2026-08-24-external-integrations-web-only.md`: do not add Service Principal, Data Grant, API Token, OAuth Client Credentials, credential rotation/revocation, or n8n/Agent integration-management surfaces back to the Mini Program.
- A HomeMew external system has one authentication mode and one active credential at steady state. Temporary multiple credentials are permitted only inside the controlled Web credential-rotation flow described by the accepted decision.
- Do not reintroduce WeChat Cloud Development as an application dependency.
- Do not add a permanent `/families/...` compatibility BFF in front of LifeSpace. Product DTO adaptation belongs at explicit HomeMew client/application boundaries.
- LifeSpace authorization is authoritative. Client role checks are UX only.
- Do not trust a client-provided user ID as the actor; the verified LifeSpace token defines the principal.

## Platform change boundary

A task in this repository must not modify LifeSpace unless the user has explicitly approved that platform change. If a required capability is missing:

1. finish all independent HomeMew work that can be done safely;
2. describe the missing LifeSpace contract/capability and why a HomeMew-only workaround would be wrong;
3. wait for explicit approval before changing LifeSpace;
4. after approval, follow LifeSpace's own `AGENTS.md` before any LifeSpace write.

## HomeMew application backend

`apps/backend/` is intentionally narrow. It may store application/provider metadata such as the WeChat identity mapping, but it must not become another business Core.

Allowed responsibilities include:

- exchanging a WeChat `wx.login` code with the WeChat server API;
- maintaining `openid -> usr_*` mapping in a HomeMew-owned Durable Object;
- authenticating to LifeSpace Identity with the HomeMew server-only application credential;
- requesting short-lived LifeSpace user tokens;
- other trusted WeChat server capabilities if explicitly required later.

It must not persist families/Spaces, events, tasks, day records, wishes, or duplicate LifeSpace authorization logic.

## Domain mapping

Use explicit product-to-platform mappings:

- family -> Space (`kind=family`)
- family admin -> Space `owner`/`admin`
- ordinary writable HomeMew member -> Space `editor`
- event -> LifeSpace `event` model + Calendar capability
- task -> LifeSpace `task` model + Actions
- day -> LifeSpace `day_record` model + Temporal capability
- wish -> LifeSpace `wish` model + Actions
- 喵一下 -> LifeSpace Registry Creation Draft capability

HomeMew page DTOs may preserve product-friendly names such as `familyId`, but platform IDs and fields must be translated explicitly at the service boundary rather than represented as a second backend contract.

## Authentication behavior

The Mini Program stores only the short-lived user token, expiry and non-secret service base URLs. Token refresh uses a fresh `wx.login()` code and the HomeMew Cloudflare application backend.

Normal requests:

```text
Mini Program
  -> Authorization: Bearer <LifeSpace user token>
  -> LifeSpace Identity or Core
```

The shared request layer must parse standard `{ "data": ... }` / `{ "error": ... }` envelopes, preserve request IDs, handle timeouts, serialize token refresh, and never blindly retry non-idempotent writes.

## Data and time rules

Follow the active LifeSpace model/capability contract. In particular, preserve UTC instant semantics, date-only values, half-open all-day event ranges, IANA timezone handling, Space Person references and optimistic concurrency/version requirements.

## Repository discipline

- Keep dependencies minimal.
- Do not add new behavior to legacy `apps/core` as part of normal HomeMew feature work.
- Do not place authoritative household data in HomeMew backend storage, Mini Program storage, or WeChat Cloud Database.
- Update HomeMew architecture/product docs and affected client tests whenever the application mapping changes.
- Important architectural decisions must be appended to the ALOHA & HomeMew engineering log.
