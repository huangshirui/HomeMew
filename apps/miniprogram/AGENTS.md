# HomeMew Mini Program Agent Instructions

This file applies to `apps/miniprogram/`. Read `/AGENTS.md`, `/docs/architecture.md`, `/docs/product-rules.md`, this application's README, and the current LifeSpace contract relevant to the task before making changes.

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

```text
Mini Program
-> Authorization: Bearer <short-lived LifeSpace user token>
-> LifeSpace Identity or Core
```

Do not add a transparent HomeMew `/families/...` proxy/BFF. HomeMew product terms are adapted explicitly in `miniprogram/services/` to LifeSpace APIs.

## Source of truth

- Platform API/auth/model behavior: `huangshirui/LifeSpace`.
- HomeMew product/UX behavior: this repository.
- Legacy `apps/core/openapi.yaml` is not the current Mini Program platform contract after the LifeSpace cutover.
- If LifeSpace lacks a required capability, identify the exact gap and obtain explicit approval before modifying LifeSpace. Do not invent a permanent client or BFF workaround.

## Product mapping

- family -> LifeSpace `Space(kind=family)`
- HomeMew admin -> Space `owner`/`admin`
- ordinary writable member -> Space `editor`
- member references used by models -> Space Person IDs
- event -> `event` + Calendar capability
- task -> `task` + Actions
- day -> `day_record` + Temporal capability
- wish -> `wish` + Actions
- 喵一下 -> Registry Creation Drafts

The UI may keep names such as `familyId`, `attendeeIds` and `assigneeIds`; service adapters must translate them to platform fields such as Space IDs and Person IDs.

## Shared request client

All authenticated requests must use the shared request layer. It must:

- attach the Bearer token;
- choose LifeSpace Identity/Core explicitly;
- parse standard success/error envelopes;
- retain request IDs for diagnostics;
- handle timeouts;
- serialize token refresh so concurrent requests do not trigger multiple refreshes;
- refresh through `wx.login()` + HomeMew Cloudflare backend;
- never blindly retry non-idempotent writes.

## State and authorization

`currentFamilyId` is UI state only. LifeSpace authorization is authoritative. Client role checks only control presentation.

At startup, refresh authentication, load the current user and accessible family Spaces, validate the cached family, then select/restore an accessible family.

## Time and concurrency

Follow LifeSpace contract semantics:

- timed event instants use RFC 3339 UTC;
- all-day ranges are half-open date ranges;
- date-only values such as task due dates are not converted to UTC instants;
- use the appropriate IANA timezone for household/viewing calculations;
- pass current resource `version` for operations that require optimistic concurrency;
- on version conflict, reload and ask the user to review rather than silently overwrite.

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

A Mini Program change is complete only when it follows the LifeSpace contract, uses the shared auth/request path, contains no backend secrets, handles expiry/errors/concurrency, updates affected HomeMew docs/tests, and does not silently reintroduce a second business backend.
