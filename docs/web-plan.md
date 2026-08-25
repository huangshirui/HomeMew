# HomeMew Web Plan

## 1. Goal

Build the primary HomeMew Web application at `homemew.aisr.online` as a household product surface, not an enterprise admin dashboard.

The Web app combines normal household use and household-admin settings in one product. LifeSpace remains authoritative for Identity, Spaces/Data Grants, domain models and household data.

## 2. Product surfaces

- `apps/web/` -> HomeMew Web app (`homemew.aisr.online`)
- `apps/display/` -> dedicated household display (`homemew-display.aisr.online`, later phase)
- `apps/miniprogram/` -> WeChat Mini Program
- `apps/backend/` -> narrow trusted WeChat provider adapter only; it is not a HomeMew business Core

External-system administration is Web-only per `docs/decisions/2026-08-24-external-integrations-web-only.md`.

## 3. Information architecture

- `/` - Today / household home
- `/family` - family members and household profile
- `/settings` - household/application settings
- `/settings/integrations` - external-system management
- `/calendar` - household calendar
- `/tasks` - tasks
- `/days` - day records and anniversaries
- `/wishes` - wish pool
- `/more` - compact mobile hub for lower-frequency product areas

Desktop uses a persistent sidebar and keeps all primary household areas visible.

Mobile deliberately keeps the bottom bar to five high-frequency entries rather than mirroring the desktop sidebar:

```text
今天 / 日程 / 待办 / 日子 / 更多
```

`更多` contains the lower-frequency `许愿池 / 家庭与成员 / 设置` entry points. This keeps Wishes reachable without overcrowding the mobile bottom navigation and keeps Family/Settings out of the high-frequency task path.

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

Do not use Next.js / SSR / RSC for this signed-in household app. Add TanStack Query only when current React context/local-state patterns stop being sufficient.

Schedule-X remains the intended richer Calendar renderer, but it is not a correctness prerequisite. The current Calendar surface first proves and converges LifeSpace range/CRUD/time semantics with the existing UI primitives; the richer renderer belongs after staging acceptance.

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

An unknown Access principal only links an existing HomeMew/LifeSpace user through the Mini Program confirmation flow. HomeMew Web does not expose LifeSpace Access registration or create a new user. Email equality is never sufficient to merge identities and Web never submits a target LifeSpace user ID for linking.

Normal HomeMew browser sessions deliberately do not request `grants:manage`. Integration-management BFF operations perform a fresh Access -> LifeSpace exchange for the minimum `profile:read grants:manage` scope set, then Core independently requires current `manage` authority on the selected Space. This keeps household Grant administration out of the ambient browser application session.

## 8. Real household context

The Web loads the current user and accessible `Space(kind=family)` records from LifeSpace after the application session is established. `currentFamilyId` is only a browser UI preference; LifeSpace authorization remains authoritative.

Family/member management uses the current LifeSpace contracts directly through the same-origin proxy:

- create or join the first family;
- list accessible family Spaces;
- switch current family locally;
- list members/Space Persons;
- invite members;
- update non-owner member roles;
- remove members subject to LifeSpace last-manager/owner rules.

No HomeMew database or duplicated authorization state is introduced.

## 9. External integrations

LifeSpace Kernel 0.13.0 supports model-collection Data Grants and LifeSpace Identity owns Service Principals plus both API Token and OAuth Client Credentials authentication.

The HomeMew representation is:

```text
one external system
  = one LifeSpace Service Principal
  + one explicit owning family Space binding on that Principal
  + exactly one authentication mode at steady state
      - api_token
      - oauth_client_credentials
  + exactly one active credential at steady state
  + per-family model-collection Data Grants

stable credential scopes
  = resources:read / resources:write

model identity and permission
  = Application × Model Access
  ∩ current model Data Grant
```

Do not restore legacy token scopes such as `events:write` or `tasks:read`.

The owning family binding and Data Grants solve different problems:

- the binding says which HomeMew family may manage the Principal and its globally usable credential;
- Data Grants say what the service may access in a Space;
- receiving a Data Grant from another Space must never transfer credential-management ownership to that Space.

Because the current LifeSpace Service Principal schema has no application metadata field, HomeMew stores this binding as a namespaced marker inside the authoritative LifeSpace Principal description: `homemew:v1:space=<spc_*>`. The BFF strips that marker from user-facing DTOs and preserves it on edits. HomeMew does not create a second ownership database.

The current HomeMew Web surface supports:

- list HomeMew-bound external systems for the current family;
- surface migrated unbound systems read-only when the current family has a historical/current Grant to them;
- never expose credential metadata or destructive credential controls for an unbound migrated Principal;
- create one Service Principal for one family and write the ownership binding at creation;
- choose `none/read/write` for `event`, `task`, and `day_record`;
- choose exactly one authentication mode: fixed API Token or OAuth 2.0 Client Credentials;
- show API Token / Client Secret plaintext exactly once and never persist it in browser storage;
- expose one active credential at steady state rather than arbitrary multi-key management;
- rotate with create-new -> update external system -> verify -> explicit complete;
- cancel a failed rotation by revoking only the candidate and retaining the previous credential;
- use the same controlled transition when switching authentication mode;
- edit name/description/model Grants;
- disable a Service Principal first, then revoke its current family Grants and all active API Token/OAuth credentials.

Service-principal/credential lifecycle uses a dedicated HomeMew integrations LifeSpace application credential held only by the Web Worker:

```text
LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL=lsa_...
```

It is a separate application context from the HomeMew Web browser application and has only the stable service scope ceiling required by HomeMew integrations. Core Application × Model Access for that application allows only the HomeMew models intentionally exposed to external systems.

The current UI does not create whole-Space Grants for new integrations. A migrated integration that still has a whole-Space `read/write/manage` Grant is surfaced explicitly as legacy broad authority; the UI does not pretend model-level `none` can narrow that fallback Grant. Fine-grained edits stay blocked for that integration until the broad Grant is deliberately reviewed/migrated.

A migrated Principal without the HomeMew Space ownership binding is also read-only. It cannot be safely “claimed” merely because a current Space has a Grant to it, because the same Principal may have authority in another Space. Establishing that ownership requires a controlled migration that can prove the one-family invariant.

## 10. Delivery phases

### W1 — foundation — complete

React/Vite/Cloudflare SPA, responsive shell, routes, repository scripts and CI.

### W2 — Access identity and staging runtime — complete

- LifeSpace Identity Access principal exchange and proof-backed link challenge;
- HomeMew same-origin Worker BFF;
- signed host-only application session;
- existing-account linking UI; HomeMew Web intentionally does not expose Access registration;
- isolated `homemew-web-staging.aisr.online` Access application;
- staging LifeSpace application/AUD/credential provisioning;
- staging Worker deployment and real Access -> LifeSpace session verification.

### W3 — minimum real household administration — complete

- real current user + family Space context;
- first-family create/join onboarding;
- family switcher;
- member list;
- invite, role update and removal;
- enough household administration to select the target family for integrations.

### W4 — external integrations — complete and staging accepted

Completed and verified through the real staging chain:

- bounded integration BFF orchestration using current Access user proof + dedicated integrations `lsa_*`;
- explicit family-Space management ownership binding for each HomeMew-created Service Principal;
- read-only handling for migrated unbound Principals;
- `event`, `task`, `day_record` model-scoped Data Grants;
- API Token and OAuth Client Credentials authentication modes;
- one active credential at steady state with controlled complete/cancel rotation;
- one-time plaintext handling;
- direct LifeSpace Core household API guidance including the current `spaceId`;
- real n8n/curl allowed read/write verification;
- deny-path verification for ungranted access;
- credential rotation/revocation verification;
- Service Principal disable verification.

Staging provisioning now supplies the dedicated integrations application and its model ceiling. After E2E acceptance, `LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL` was promoted from optional/fail-closed to a required `homemew-web-staging` runtime secret; staging deployment fails if it or either base Web runtime secret is absent.

### W5 — household domain pages — first real-data pass complete

Implemented directly against LifeSpace through the same-origin BFF:

- Calendar: 42-cell visible-grid overlap query, timed/all-day event CRUD, family-local display, independent endpoint timezone preservation, Space Person attendees and optimistic version concurrency;
- Tasks: pending/completed, overdue/today/upcoming/undated grouping, search, CRUD, complete/reopen Actions, assignees;
- Days: elapsed/countdown/cycle records, LifeSpace Temporal computed state, CRUD, archive/restore and an in-product date/note record-occurrence dialog;
- Wishes: open/claimed/fulfilled/archived views, owner edit/delete and lifecycle Actions;
- Home/Today: real family-local events, due/overdue tasks, Temporal attention and quick task completion; all preview/fake household data removed.

Remaining product polish is primarily richer Calendar presentation (Schedule-X after staging acceptance) plus general responsive/empty/error-state refinement.

### W6 — staging acceptance and product convergence — current

Completed during W6 so far:

- keep `main` continuously deployable to `homemew-web-staging.aisr.online`;
- make deployment output report runtime readiness without exposing secret values;
- complete W4 real service-credential E2E and promote integrations runtime to a required staging prerequisite;
- fix first-family onboarding so a linked existing HomeMew user with no accessible family can create/join a family;
- fix deterministic integration-editor reject states;
- converge Days occurrence entry and Calendar visible-range/timezone correctness;
- establish Web-only external integration administration with one-mode/one-active-credential steady state;
- keep the mobile bottom bar to five high-frequency entries and move Wishes/Family/Settings into a dedicated More hub.

Remaining W6 work:

- run/finish real household CRUD/action acceptance through Cloudflare Access across Calendar/Tasks/Days/Wishes/Home;
- continue responsive/empty/error-state and interaction convergence;
- only after staging acceptance, add the richer Calendar renderer if it improves the product without changing LifeSpace semantics;
- only after staging acceptance, design the production front-door cutover that preserves Mini Program backend routes.

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
- External-system administration in the Mini Program.
- Normal multi-key management for one external system.
