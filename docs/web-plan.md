# HomeMew Web Plan

## 1. Goal

Build the primary HomeMew Web application at `homemew.aisr.online` as a household product surface, not an enterprise admin dashboard.

The Web app combines normal household use and household-admin settings in one product. The separate household display remains a different runtime because its device identity and read-only authorization model differ from a normal signed-in user.

## 2. Product surfaces

- `apps/web/` -> HomeMew Web app (`homemew.aisr.online`)
- `apps/display/` -> dedicated household display (`homemew-display.aisr.online`, later phase)
- `apps/miniprogram/` -> WeChat Mini Program
- `apps/backend/` -> narrow trusted provider adapter only; it is not a HomeMew business Core

LifeSpace remains authoritative for Identity, Spaces/Grants, domain models and household data.

## 3. First Web information architecture

- `/` - Today / household home
- `/calendar` - household calendar
- `/tasks` - tasks
- `/days` - day records and anniversaries
- `/wishes` - wish pool
- `/family` - family members and household profile
- `/settings` - household/application settings
- `/settings/integrations` - external-system management when the required LifeSpace end-user provisioning capability exists

Desktop uses a persistent sidebar. Mobile uses a compact header and bottom navigation. Tablet adapts between the two without a separate codebase.

## 4. UX requirements

- Consumer household-product feel; avoid ERP/admin-template visual language.
- Warm, calm, readable and friendly; retain the HomeMew green identity without making every surface green.
- Responsive from phone width through large desktop.
- Fast common actions: see today, add event/task, check upcoming items, switch family.
- Accessibility first: semantic controls, keyboard-visible focus, sufficient contrast, reduced-motion friendly behavior.
- Dark mode is allowed later but is not a first-slice dependency.

## 5. Technical baseline

Use a deliberately small SPA stack:

- React 19
- TypeScript
- Vite
- React Router in library/SPA mode
- Tailwind CSS
- shadcn/ui conventions with local component source; add only primitives actually needed
- Lucide icons
- Cloudflare Vite plugin + Workers Static Assets
- pnpm workspace

Add TanStack Query when real LifeSpace server-state integration starts. Add Schedule-X when the Calendar page starts. Do not add Redux/Zustand or another global state library unless concrete client-state complexity proves it necessary.

## 6. Cloudflare runtime and same-origin BFF boundary

HomeMew Web is a client-rendered SPA deployed to a Cloudflare Worker with Workers Static Assets. `assets.not_found_handling` is `single-page-application` so client routes resolve to `index.html`.

Phase W1 is intentionally assets-only so the product shell can be developed without inventing authentication. Phase W2 adds a **thin same-origin Worker session/API gateway** under the same `homemew.aisr.online` deployment, consistent with the existing LifeSpace Web architecture decision:

```text
Browser
  -> homemew.aisr.online
       -> static React SPA
       -> /api/* thin Web session/API gateway
            -> LifeSpace Identity/Core
```

The gateway exists only to establish/hold the app-local browser session, keep server-side credentials and tokens out of frontend JavaScript, and forward authenticated requests to LifeSpace. It may validate exact Origin / CSRF protections and propagate LifeSpace request IDs.

It is **not** a compatibility or business BFF:

- it does not expose a second `/families/...` business contract;
- it does not persist Spaces, events, tasks, day records, wishes or other household business data;
- it does not duplicate LifeSpace authorization or model validation;
- it does not become another Core.

This preserves a single Cloudflare deployment unit while keeping browser authentication and credentials out of the SPA.

## 7. Authentication dependency

The approved target browser flow is centralized LifeSpace Identity using Authorization Code + PKCE / redirect SSO, with an Identity host-only session cookie at `auth.aisr.online` and an app-local host-only session cookie at `homemew.aisr.online`.

The current LifeSpace Identity public contract does not yet expose that approved browser authorization flow. It can issue short-lived app-scoped user tokens through trusted application exchange, but HomeMew must not repurpose that internal flow as browser login.

Therefore:

- do not invent production browser authentication inside HomeMew;
- do not expose `lsa_*`, service credentials or long-lived LifeSpace bearer tokens to browser JavaScript;
- keep W1 preview data clearly labelled and non-authoritative;
- define/implement the missing browser-auth capability in LifeSpace only after separate explicit approval;
- add the same-origin Worker session/API gateway in W2 together with that approved platform capability.

Development preview data must never be persisted as authoritative household data.

## 8. External integrations

HomeMew family admins should eventually manage integrations under `/settings/integrations`. LifeSpace authorization remains authoritative.

The existing platform gap for end-user provisioning of a new service principal plus credential must not be recreated as a HomeMew credential authority. Until the approved LifeSpace capability exists, the Web surface may explain that the function is unavailable but must not issue replacement credentials itself.

## 9. Delivery phases

### Phase W1 - foundation

- Convert `apps/web` from the old display placeholder into the real Web app.
- Create `apps/display` placeholder for the future device-oriented display.
- Add React/Vite/Cloudflare SPA runtime.
- Add responsive HomeMew App Shell and Today page.
- Add routes for Calendar, Tasks, Days, Wishes, Family and Settings.
- Add repository scripts and CI/typecheck/build coverage.

### Phase W2 - browser identity, same-origin gateway and family context

- Approve/implement the LifeSpace browser Authorization Code + PKCE contract separately.
- Register the HomeMew Web LifeSpace application with the least required model access.
- Add the thin same-origin Worker session/API gateway to the existing Web deployment.
- Establish host-only app session and CSRF/origin protections.
- Connect profile and accessible family/Space selection.
- Replace preview data with LifeSpace-backed queries through `/api/*`.

### Phase W3 - core household pages

- Calendar with Schedule-X and LifeSpace Calendar/event capability.
- Tasks with LifeSpace task Actions.
- Day records/anniversaries.
- Wishes.
- Family/member management.

### Phase W4 - household admin settings

- Family settings and permissions-aware controls.
- External integrations only after the required LifeSpace provisioning contract is approved.
- Diagnostics should expose request IDs without leaking tokens or secrets.

## 10. Non-goals

- SSR/SEO framework complexity for the signed-in household app.
- A second HomeMew business database.
- A permanent compatibility/business BFF or `/families/...` facade.
- A HomeMew-owned credential authority.
- Separate desktop/mobile Web codebases.
