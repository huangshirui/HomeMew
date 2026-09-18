# HomeMew Mini Program Agent Instructions

This file applies to `apps/miniprogram/`. Read `/AGENTS.md`, `/docs/architecture.md`, `/docs/product-rules.md`, accepted decisions under `/docs/decisions/`, this application's README, and the current LifeSpace contract relevant to the task before making changes.

## Architecture

The Mini Program is a HomeMew UI client, not a business backend.

### Login

```text
Mini Program
-> wx.login()
-> HomeMew Cloudflare application backend
-> WeChat jscode2session (server-side appsecret)
-> openid -> LifeSpace usr_* mapping in HomeMew Durable Object
-> LifeSpace Identity /internal/v1/tokens using server-only lsa_*
-> short-lived LifeSpace user token
-> Mini Program
```

The mapping Durable Object is keyed per WeChat application identity and uses SQLite-backed Durable Object storage. Do not create a dedicated HomeMew D1 only for the login mapping.

Do not use `wx.cloud.init`, `wx.cloud.callFunction`, WeChat Cloud Database, or WeChat Cloud Storage as an application dependency. Never expose WeChat `appsecret` or the LifeSpace application credential in client code.

### Normal requests

The accepted `2026-09-16-miniprogram-final-bff-boundary` decision supersedes the Event-only/two-path target from 2026-09-15.

After the one-time migration, all normal Mini runtime dependencies use the stable HomeMew application contract:

```text
Mini Program
-> Authorization: Bearer <short-lived LifeSpace user token>
-> explicit HomeMew Mini BFF product route
-> fixed current LifeSpace Identity/Core operation through Cloudflare Service Binding
```

Mini code must not select public LifeSpace base URLs, Identity/Core wire paths, Canonical Query AST, generic `modelKey` routes, or the old/new Event representation. Those details belong to BFF adapters. The login route remains a HomeMew provider route and may delegate to `apps/backend`.

The BFF is an application contract/anti-corruption boundary, not a second business Core. Household-domain adapters must not persist household business data, duplicate LifeSpace authorization, accept arbitrary upstream URLs/paths, expose a generic model proxy, or become a generic `/api/v1/*` proxy. Separately accepted HomeMew-owned application capabilities may use bounded ephemeral orchestration state without becoming domain truth.


## Product surface boundary

The Mini Program is intentionally the lightweight, high-frequency household client. External-system administration is an advanced capability and is Web-only.

Do not add Mini Program pages, settings, service adapters, credential buffers, or secret-display flows for Service Principals, Data Grants, API Tokens, OAuth Client Credentials, n8n/Agent integration setup, credential rotation, or integration disable/revoke operations. These belong to HomeMew Web `/settings/integrations`.

The Mini Program may display audit actors that happen to be external systems when returned by LifeSpace business models, but it must not manage those external systems or their credentials.

## Source of truth

- Platform API/auth/model behavior: `huangshirui/LifeSpace`.
- HomeMew product/UX and Mini BFF contract behavior: this repository.
- Legacy `apps/core/openapi.yaml` is not the current Mini Program platform contract after the LifeSpace cutover.
- If LifeSpace lacks a required durable platform capability, identify the exact gap and obtain explicit approval before modifying LifeSpace. Do not hide a missing platform capability inside BFF persistence or authorization logic.

## Product mapping

- family -> LifeSpace `Space(kind=family)`
- HomeMew admin -> Space `owner`/`admin`
- ordinary writable member -> Space `editor`
- member references used by models -> Space Person IDs
- profile/family/member/invitation/business operations -> explicit HomeMew Mini BFF routes -> current LifeSpace contracts
- event -> stable HomeMew Event DTO -> BFF adapter -> LifeSpace `event` + Calendar/Temporal semantics
- task -> stable HomeMew Task DTO -> BFF adapter -> LifeSpace `task` + Actions
- day -> stable HomeMew Day DTO -> BFF adapter -> LifeSpace `day_record` + Temporal capability
- wish -> stable HomeMew Wish DTO -> BFF adapter -> LifeSpace `wish` + Actions
- 喵一下 -> currently offline and not registered as a Mini page; any future draft interpretation/job contract is owned by the HomeMew BFF and requires a separate accepted re-enable decision

The UI may keep names such as `familyId`, `attendeeIds` and `assigneeIds`; service adapters/BFF mappings must translate them explicitly to current LifeSpace semantics where needed.

## Shared request client

All authenticated requests must use the shared request layer. It must:

- attach the Bearer token;
- call only explicit HomeMew application routes for normal runtime behavior; never accept or select a LifeSpace base URL/path;
- parse standard `{ data }` / `{ error }` envelopes;
- retain request IDs for diagnostics;
- handle timeouts;
- serialize token refresh so concurrent requests do not trigger multiple refreshes;
- refresh through `wx.login()` + HomeMew Cloudflare backend;
- never blindly retry non-idempotent writes.

## State and authorization

`currentFamilyId` is UI state only. LifeSpace authorization is authoritative. Client and BFF role checks may control presentation/validation convenience only and must not become authority.

At startup, refresh authentication, load the current user and accessible family Spaces, validate the cached family, then select/restore an accessible family.

## Time and concurrency

Follow the active HomeMew BFF contract and underlying LifeSpace semantics:

- timed event instants use RFC 3339 UTC;
- all-day ranges are half-open date ranges;
- date-only values such as task due dates are not converted to UTC instants;
- use the appropriate IANA timezone for household/viewing calculations;
- pass current resource `version` for operations that require optimistic concurrency;
- on version conflict, reload and ask the user to review rather than silently overwrite.

The BFF translates the stable Mini Event DTO to the current LifeSpace `when: temporal_range` Event contract while preserving observable Mini semantics. The retired split Calendar fields are historical upstream compatibility only and must not be reintroduced as an active adapter path.

## Local storage

Allowed: short-lived token, token expiry, current family/Space ID, non-secret service URLs, UI preferences and temporary cache.

Never persist backend credentials, WeChat secrets, LifeSpace `lsa_*`, or an alternate authoritative copy of household data.

## Local development

The Mini Program remains native TypeScript. Do not introduce uni-app, Taro, React, Vue or another framework without an explicit architecture decision.

From `apps/miniprogram/`:

```bash
npm install
npm run typecheck
npm run build
npm run watch
```

`project.config.json` must not configure a cloud-function root after the cutover. Compiled Mini Program JS remains generated locally and must not be committed.

## Definition of done

A Mini Program change is complete only when it follows the accepted HomeMew application boundary and current LifeSpace semantics, uses the shared auth/request path, contains no backend secrets, handles expiry/errors/concurrency, updates affected HomeMew docs/tests, and does not silently reintroduce a second business backend.
