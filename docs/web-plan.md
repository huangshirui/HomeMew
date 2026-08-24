# HomeMew Web Plan

## 1. Goal

Build the primary HomeMew Web application at `homemew.aisr.online` as a household product surface, not an enterprise admin dashboard.

The Web app combines normal household use and household-admin settings in one product. LifeSpace remains authoritative for Identity, Spaces/Data Grants, domain models and household data.

## 2. Product surfaces

- `apps/web/` -> HomeMew Web app (`homemew.aisr.online`)
- `apps/display/` -> dedicated household display (`homemew-display.aisr.online`, later phase)
- `apps/miniprogram/` -> WeChat Mini Program
- `apps/backend/` -> narrow trusted WeChat provider adapter only; it is not a HomeMew business Core

## 3. Information architecture

- `/` - Today / household home
- `/family` - family members and household profile
- `/settings` - household/application settings
- `/settings/integrations` - external-system management
- `/calendar` - household calendar
- `/tasks` - tasks
- `/days` - day records and anniversaries
- `/wishes` - wish pool

Desktop uses a persistent sidebar. Mobile uses a compact header and bottom navigation. The current delivery priority deliberately puts Family and Settings/Integrations ahead of Calendar/Tasks/Days/Wishes.

## 4. UX requirements

- Consumer household-product feel; avoid ERP/admin-template visual language.
- Warm, calm, readable and friendly; retain the HomeMew green identity without making every surface green.
- Responsive from phone width through large desktop.
- Accessibility first: semantic controls, keyboard-visible focus, sufficient contrast, reduced-motion friendly behavior.
- Do not show fake household data once a real LifeSpace surface is wired.

## 5. Technical baseline

Use a deliberately small SPA stack:

- React 19
- TypeScript
- Vite
- React Router in library/SPA mode
- Tailwind CSS
- local shadcn/ui-style primitives
- Lucide icons
- Cloudflare Vite plugin + Workers Static Assets
- pnpm workspace

Do not use Next.js / SSR / RSC for this signed-in household app. Add TanStack Query only when current React context/local-state patterns stop being sufficient. Add Schedule-X only when the real Calendar surface begins.

## 6. Cloudflare runtime and same-origin BFF boundary

HomeMew Web is a client-rendered SPA deployed as one Cloudflare Worker application with Workers Static Assets and an integrated thin Worker BFF.

```text
Browser
  -> homemew.aisr.online
       -> static React SPA
       -> /api/* Web trust/session boundary
            -> LifeSpace Identity/Core
```

The gateway keeps server-side credentials and LifeSpace user tokens out of browser JavaScript, validates exact Origin for state-changing requests, propagates request IDs and forwards authenticated requests to LifeSpace. It is not a second business Core, does not persist household records, and does not create a `/families/...` compatibility contract.

## 7. Authentication architecture

The final browser architecture is Cloudflare Access × LifeSpace Identity.

```text
Browser
  -> Cloudflare Access / SSO
  -> HomeMew Web Worker receives Cf-Access-Jwt-Assertion
  -> dedicated HomeMew-Web lsa_*
  -> LifeSpace Identity verifies Access JWT + registered audience
  -> Identity resolves (iss, sub) -> global usr_*
  -> short-lived HomeMew-Web-scoped LifeSpace user token
  -> signed host-only HttpOnly HomeMew session
```

Unknown Access principals use explicit link-existing or create-new flows. Email equality is never sufficient to merge identities and Web never submits a target LifeSpace user ID for linking.

Normal HomeMew browser sessions deliberately do not request `grants:manage`. Integration-management BFF operations perform a fresh Access -> LifeSpace exchange for the minimum `profile:read grants:manage` scope set, then Core independently requires current `manage` authority on the selected Space. This keeps household Grant administration out of the ambient browser application session.

## 8. Real household context

The Web must load the current user and accessible `Space(kind=family)` records from LifeSpace after the application session is established. `currentFamilyId` is only a browser UI preference; LifeSpace authorization remains authoritative.

Family/member management uses the current LifeSpace contracts directly through the same-origin proxy:

- list accessible family Spaces;
- switch current family locally;
- list members/Space Persons;
- invite members;
- update non-owner member roles;
- remove members subject to LifeSpace last-manager/owner rules.

No HomeMew database or duplicated authorization state is introduced.

## 9. External integrations — current top priority

LifeSpace Kernel 0.13.0 now supports model-collection Data Grants, closing the platform authorization gap that previously blocked least-privilege external-system issuance.

The HomeMew representation is:

```text
one external system
  = one LifeSpace Service Principal
  + one explicit owning family Space binding on that Principal
  + one or more lsp_pat_* Service API Tokens
  + per-family model-collection Data Grants

stable credential scopes
  = resources:read / resources:write

model identity and permission
  = Application × Model Access
  ∩ current model Data Grant
```

Do not restore legacy token scopes such as `events:write` or `tasks:read`.

The owning family binding and Data Grants solve different problems:

- the binding says which HomeMew family may manage the Principal and its globally usable credentials;
- Data Grants say what the service may access in a Space;
- receiving a Data Grant from another Space must never transfer credential-management ownership to that Space.

Because the current LifeSpace Service Principal schema has no application metadata field, HomeMew stores this binding as a namespaced marker inside the authoritative LifeSpace Principal description: `homemew:v1:space=<spc_*>`. The BFF strips that marker from user-facing DTOs and preserves it on edits. HomeMew does not create a second ownership database.

The first HomeMew Web surface supports:

- list HomeMew-bound external systems for the current family;
- surface migrated unbound systems read-only when the current family has a historical/current Grant to them;
- never expose token metadata or destructive credential controls for an unbound migrated Principal;
- create one Service Principal for one family and write the ownership binding at creation;
- choose `none/read/write` for `event`, `task`, and `day_record`;
- issue a long-lived opaque `lsp_pat_*` Service API Token by default;
- show credential plaintext exactly once and never persist it in browser storage;
- list non-secret credential metadata for bound Principals;
- rotate by creating a replacement before revoking the old token;
- revoke individual tokens;
- edit name/description/model Grants;
- disable a Service Principal first, then revoke its current family Grants and active tokens.

Service-principal/token lifecycle uses a dedicated HomeMew integrations LifeSpace application credential held only by the Web Worker:

```text
LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL=lsa_...
```

It must be a separate application context from the HomeMew Web browser application and should have only the stable service scope ceiling required by HomeMew integrations. Core Application × Model Access for that application should allow only the HomeMew models intentionally exposed to external systems.

The current UI does not create whole-Space Grants for new integrations. A migrated integration that still has a whole-Space `read/write/manage` Grant is surfaced explicitly as legacy broad authority; the UI does not pretend model-level `none` can narrow that fallback Grant. Fine-grained edits stay blocked for that integration until the broad Grant is deliberately reviewed/migrated.

A migrated Principal without the HomeMew Space ownership binding is also read-only. It cannot be safely “claimed” merely because a current Space has a Grant to it, because the same Principal may have authority in another Space. Establishing that ownership requires a controlled migration that can prove the one-family invariant.

## 10. Delivery phases

### W1 — foundation — complete

React/Vite/Cloudflare SPA, responsive shell, routes, repository scripts and CI.

### W2 — Access identity and staging runtime — complete

- LifeSpace Identity Access principal exchange/link/registration;
- HomeMew same-origin Worker BFF;
- signed host-only application session;
- explicit account linking/registration UI;
- isolated `homemew-web-staging.aisr.online` Access application;
- staging LifeSpace application/AUD/credential provisioning;
- staging Worker deployment and real Access -> LifeSpace session verification.

### W3 — minimum real household administration — complete

- real current user + family Space context;
- family switcher;
- member list;
- invite, role update and removal;
- enough household administration to select the target family for integrations.

### W4 — external integrations — current

Platform prerequisite is complete in LifeSpace Kernel 0.13.0: model-collection Data Grants are supported.

HomeMew implementation scope:

- bounded integration BFF orchestration using current Access user proof + dedicated integrations `lsa_*`;
- explicit family-Space management ownership binding for each HomeMew-created Service Principal;
- read-only handling for migrated unbound Principals;
- integration list/create/edit/disable;
- fixed API Token create/list/rotate/revoke;
- per-model read/write permission editor for `event`, `task`, `day_record`;
- one-time secret handling and deny-path tests;
- staging provisioning of the dedicated integrations application credential and Web app `grants:manage` ceiling;
- real n8n/curl staging E2E.

The code is safe to deploy before the integrations credential exists: normal HomeMew Web remains available, `/health` reports `integrationsReady=false`, and integration endpoints fail closed with `INTEGRATIONS_NOT_CONFIGURED`. Once staging is provisioned and verified, make the integration credential a required deployment secret.

### W5 — household domain pages — deferred

- Calendar + Schedule-X + LifeSpace event capability;
- Tasks;
- Day records/anniversaries;
- Wishes.

## 11. Production routing constraint

The final Web domain remains `homemew.aisr.online`, but that hostname currently serves the production Mini Program login endpoint through `homemew-backend-production`.

Do not transfer the production hostname to the Web Worker until the Web front-door preserves `/api/v1/login/wechat` through an explicit backend Service Binding/pass-through and the full Web path has passed staging verification.

The isolated first Web hostname remains `homemew-web-staging.aisr.online`.

## 12. Non-goals

- SSR/SEO framework complexity for the signed-in household app.
- A second HomeMew business database.
- A permanent compatibility/business BFF.
- A HomeMew-owned credential authority.
- Separate desktop/mobile Web codebases.
- Broad Space-wide external-system access as a shortcut around model-grant authorization.
- Treating possession of a Data Grant as authority to rotate a Service Principal's global credentials.
