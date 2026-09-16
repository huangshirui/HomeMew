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
- HomeMew product terminology, UX and application-specific identity/provider/BFF mapping: this repository.
- The legacy HomeMew business Core was retired from the active repository on 2026-08-26 after the completed LifeSpace production migration/cutover. Git history is the archive; do not recreate a HomeMew business Core or treat historical HomeMew OpenAPI/migrations as the current platform contract.

When HomeMew needs a durable platform capability LifeSpace does not provide, do not hide that gap in HomeMew persistence or authorization logic. Identify the exact platform gap and obtain explicit approval before modifying LifeSpace. A bounded stateless application DTO/compatibility adapter is allowed when an accepted HomeMew decision explicitly places release-lag compatibility at the application boundary.

## Mandatory architecture rules

- HomeMew household business data lives in LifeSpace, not in a HomeMew database or WeChat Cloud Database.
- HomeMew “family” maps to LifeSpace `Space(kind=family)`.
- HomeMew users map to LifeSpace Identity users; member-facing domain references map through Space Person IDs where the LifeSpace contract requires them.
- The Mini Program's normal runtime contract is the **final bounded HomeMew Mini BFF** defined by `docs/decisions/2026-09-16-miniprogram-final-bff-boundary.md` and tracked by `docs/plans/2026-09-16-miniprogram-final-bff-rollout.md`. After the one-time migration it must not address public LifeSpace Identity/Core URLs or wire paths directly.
- Mini household-domain adapters are stateless application adaptation only: explicit HomeMew product routes may translate request/response DTOs, deterministically lower product filters/sorts to the active LifeSpace Canonical Query contract, and forward the current LifeSpace user bearer. A separately accepted HomeMew-owned application capability may own bounded ephemeral orchestration state, but it must not persist household business truth, duplicate LifeSpace authorization, accept arbitrary upstream URLs/paths, expose a generic model proxy, or become a generic `/api/v1/*` proxy.
- The 2026-09-15 Event-only BFF decision is historical where it conflicts with the final boundary. Event remains the first compatibility-sensitive model, but the next reviewed Mini release moves every current direct LifeSpace runtime dependency behind the final HomeMew contract.
- A small HomeMew Cloudflare application backend handles WeChat provider trust: `wx.login` code exchange, `openid -> LifeSpace user_id` mapping, and exchange of the server-only LifeSpace application credential for a short-lived user token. It remains separate from household business-data ownership.
- The WeChat identity mapping is stored in a SQLite-backed Durable Object keyed per WeChat application identity; do not provision a dedicated HomeMew D1 merely for this mapping.
- Never expose WeChat `appsecret`, LifeSpace `lsa_*` application credentials, service credentials, signing keys, or other backend secrets to Mini Program code.
- External-system administration is an advanced Web-only capability. Follow `docs/decisions/2026-08-24-external-integrations-web-only.md`: do not add Service Principal, Data Grant, API Token, OAuth Client Credentials, credential rotation/revocation, or n8n/Agent integration-management surfaces back to the Mini Program.
- A HomeMew external system has one authentication mode and one active credential at steady state. Temporary multiple credentials are permitted only inside the controlled Web credential-rotation flow described by the accepted decision.
- Do not reintroduce WeChat Cloud Development as an application dependency.
- Do not recreate the retired HomeMew business Core or a broad permanent `/families/...` compatibility backend. Product DTO adaptation belongs at explicit HomeMew client/BFF boundaries and stays narrow.
- LifeSpace authorization is authoritative. Client/BFF role checks are UX/validation only.
- Do not trust a client-provided user ID as the actor; the verified LifeSpace token defines the principal.

## Platform change boundary

A task in this repository must not modify LifeSpace unless the user has explicitly approved that platform change. If a required capability is missing:

1. finish all independent HomeMew work that can be done safely;
2. describe the missing LifeSpace contract/capability and why a HomeMew-only persistence/authorization workaround would be wrong;
3. wait for explicit approval before changing LifeSpace;
4. after approval, follow LifeSpace's own `AGENTS.md` before any LifeSpace write.

## HomeMew application backend

`apps/backend/` is intentionally narrow. It may store application/provider metadata such as the WeChat identity mapping and HomeMew application-usage state accepted by explicit decisions, but it must not become another business Core.

Allowed responsibilities include:

- exchanging a WeChat `wx.login` code with the WeChat server API;
- maintaining `openid -> usr_*` mapping in a HomeMew-owned Durable Object;
- authenticating to LifeSpace Identity with the HomeMew server-only application credential;
- requesting short-lived LifeSpace user tokens;
- HomeMew application-usage/activity state covered by accepted decisions;
- other trusted application/provider capabilities if explicitly required later.

It must not persist families/Spaces, events, tasks, day records, wishes, or duplicate LifeSpace authorization logic.

The production HomeMew Web/front-door Worker may host bounded public Mini BFF routes when an accepted decision requires application-contract isolation. Such routes still follow the same no-business-persistence/no-duplicate-authority rule.

## Domain mapping

Use explicit product-to-platform mappings:

- family -> Space (`kind=family`)
- family admin -> Space `owner`/`admin`
- ordinary writable HomeMew member -> Space `editor`
- Mini family/member/profile/business operations -> explicit HomeMew Mini BFF product routes -> current LifeSpace Identity/Core contracts
- event -> stable HomeMew Mini Event DTO -> BFF adapter -> LifeSpace `event`; HomeMew Web tracks the current LifeSpace Event contract through its Web boundary
- task -> HomeMew Mini Task DTO -> BFF adapter -> LifeSpace `task` model + Actions
- day -> HomeMew Mini Day DTO -> BFF adapter -> LifeSpace `day_record` model + Temporal capability
- wish -> HomeMew Mini Wish DTO -> BFF adapter -> LifeSpace `wish` model + Actions
- 喵一下 -> currently offline; any future interpretation/draft-job capability is HomeMew BFF-owned application orchestration, not a LifeSpace Registry contract; durable confirmed records still use the normal LifeSpace-backed product routes

HomeMew page DTOs may preserve product-friendly names such as `familyId`, but platform IDs and fields must be translated explicitly at the client/BFF service boundary rather than represented as another authoritative backend model.

## Authentication behavior

The Mini Program stores only the short-lived user token, expiry and non-secret service base URLs. Token refresh uses a fresh `wx.login()` code and the HomeMew Cloudflare application backend.

After the one-time migration, authenticated normal runtime requests use one explicit application path:

```text
Mini Program
  -> Authorization: Bearer <LifeSpace user token>
  -> stable HomeMew Mini BFF route
  -> fixed current LifeSpace Identity/Core operation through Cloudflare Service Binding
```

The separate HomeMew login route performs WeChat provider trust and LifeSpace token exchange. It is part of the application boundary, not permission to expose LifeSpace wire addressing to Mini code.

The BFF forwards rather than replaces user authority. LifeSpace performs the authoritative model/Space/policy checks.

The Mini shared request layer targets only the stable HomeMew routes for normal runtime behavior. The BFF must parse and preserve standard `{ "data": ... }` / `{ "error": ... }` envelopes, preserve request IDs, handle timeouts, serialize token refresh, and never blindly retry non-idempotent writes.

## Data and time rules

Follow the active LifeSpace model/capability semantics and accepted HomeMew BFF projection. In particular, preserve UTC instant semantics, date-only values, half-open all-day event ranges, IANA timezone handling, Space Person references and optimistic concurrency/version requirements. A BFF representation change must not silently change those observable semantics.

## Repository discipline

- Keep dependencies minimal.
- Do not recreate a HomeMew business Core or reintroduce migration/cutover-only contracts and workflows into active repository paths.
- Do not place authoritative household data in HomeMew backend storage, Mini Program storage, or WeChat Cloud Database.
- Update HomeMew architecture/decision docs and affected client tests whenever the application mapping changes.
- Important architectural decisions must be appended to the ALOHA & HomeMew engineering log.
