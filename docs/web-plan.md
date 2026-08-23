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

External-system management under `/settings/integrations` is the next primary feature after the minimum family/member context needed to select and administer a household.

Target first UX:

- create one external system for one family;
- issue a long-lived opaque `lsp_pat_*` Service API Token by default;
- show credential plaintext exactly once;
- list non-secret credential metadata;
- rotate by creating a replacement before revoking the old token;
- disable an external system and revoke its Data Grants/credentials;
- OAuth `client_credentials` remains an optional later/advanced mode, not the default for owner-controlled n8n/scripts.

LifeSpace already owns Service Principals, opaque Service API Tokens and Space Data Grant lifecycle. HomeMew must not recreate a credential authority.

The remaining platform gap is **model/collection-scoped Data Grants**. The current product grant creation API creates a Space-wide grant, which is too broad for HomeMew permissions such as `event:write`, `task:read`, or no `day_record` access. External-token issuance must remain unavailable until LifeSpace can express that fine-grained current-state authorization.

The preferred target is a dedicated HomeMew integrations application context rather than reusing the browser application's service authority. This keeps external-system Application × Model Access independent from the Web UI application and supports least privilege.

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

### W3 — minimum real household administration — current

- real current user + family Space context;
- family switcher;
- member list;
- invite, role update and removal;
- enough household administration to select the target family for integrations.

### W4 — external integrations — next and highest priority

- LifeSpace model/collection-scoped Data Grant capability;
- dedicated HomeMew integrations application/service authority;
- HomeMew Web BFF orchestration that verifies the current family administrator with the user session, then manages service principals/credentials server-side;
- integration list/create/edit/disable;
- fixed API Token create/list/rotate/revoke;
- per-model read/write permission editor;
- real n8n/curl staging E2E.

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
- Broad Space-wide external-system access as a shortcut around missing model-grant support.
