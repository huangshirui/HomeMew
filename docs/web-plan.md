# HomeMew Web Plan

## 1. Goal

Build the primary HomeMew Web application at `homemew.aisr.online` as a household product surface, not an enterprise admin dashboard.

The Web app combines normal household use and household-admin settings in one product. The separate household display remains a different runtime because its device identity and read-only authorization model differ from a normal signed-in user.

## 2. Product surfaces

- `apps/web/` -> HomeMew Web app (`homemew.aisr.online`)
- `apps/display/` -> dedicated household display (`homemew-display.aisr.online`, later phase)
- `apps/miniprogram/` -> WeChat Mini Program
- `apps/backend/` -> narrow trusted WeChat provider adapter only; it is not a HomeMew business Core

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

Do not use Next.js / SSR / RSC for this signed-in household app.

Add TanStack Query when real LifeSpace server-state integration starts. Add Schedule-X when the Calendar page starts. Do not add Redux/Zustand or another global state library unless concrete client-state complexity proves it necessary. Prefer URL state, React Context and local UI/browser state first.

## 6. Cloudflare runtime and same-origin BFF boundary

HomeMew Web is a client-rendered SPA deployed as one Cloudflare Worker application with Workers Static Assets and an integrated thin Worker BFF.

```text
Browser
  -> homemew.aisr.online
       -> static React SPA
       -> /api/* thin Web session/API gateway
            -> LifeSpace Identity/Core
```

`assets.not_found_handling` is `single-page-application`. `assets.run_worker_first` explicitly sends `/api/*` and `/health` to the Worker before static-asset fallback.

The gateway exists only to establish/hold the app-local browser session, keep server-side credentials and LifeSpace user tokens out of frontend JavaScript, validate exact Origin / CSRF protections, propagate request IDs and forward authenticated requests to LifeSpace.

It is **not** a compatibility or business BFF:

- it does not expose a second `/families/...` business contract;
- it does not persist Spaces, events, tasks, day records, wishes or other household business data;
- it does not duplicate LifeSpace authorization or model validation;
- it does not become another Core.

## 7. Authentication architecture

The final browser architecture is **Cloudflare Access × LifeSpace Identity**, not Authorization Code + PKCE.

```text
Browser
  -> Cloudflare Access authentication / SSO
  -> HomeMew Web Worker receives Cf-Access-Jwt-Assertion
  -> Worker authenticates to LifeSpace Identity with dedicated HomeMew-Web lsa_*
  -> Identity independently verifies Access JWT signature / issuer / expiry / audience
  -> Identity resolves verified (iss, sub) -> global usr_*
  -> Identity issues short-lived HomeMew-Web-scoped LifeSpace user token
  -> Worker keeps that bearer in a signed host-only HttpOnly app session
  -> browser uses same-origin /api/* only
```

The app-local session is HMAC-authenticated and bound to a SHA-256 fingerprint of the current Access assertion. If the Access principal changes, the previous LifeSpace session cannot be reused.

Never expose `lsa_*`, service credentials or LifeSpace user bearer tokens to browser JavaScript.

Unknown Access principals use explicit Identity flows only:

- **link existing account**: Web creates a one-time Identity link challenge; an already-authenticated HomeMew client confirms it as its current LifeSpace user;
- **create new account**: Web explicitly registers a new LifeSpace user bound to the verified Access principal.

Email equality is never sufficient to merge identities and Web never submits the target LifeSpace user ID for linking.

## 8. External integrations

HomeMew family admins should eventually manage integrations under `/settings/integrations`. LifeSpace authorization remains authoritative.

The existing platform gap for end-user provisioning of a new service principal plus credential must not be recreated as a HomeMew credential authority. Until the approved LifeSpace capability exists, the Web surface may explain that the function is unavailable but must not issue replacement credentials itself.

## 9. Delivery phases

### Phase W1 - foundation — complete in code

- Convert `apps/web` from the old display placeholder into the real Web app.
- Create `apps/display` placeholder for the future device-oriented display.
- Add React/Vite/Cloudflare SPA runtime.
- Add responsive HomeMew App Shell and Today preview page.
- Add routes for Calendar, Tasks, Days, Wishes, Family and Settings.
- Add repository scripts and CI/typecheck/build coverage.

### Phase W2 - Access identity, same-origin gateway and family context — in progress

Completed in repository code:

- LifeSpace Identity 0.5.0 Access principal exchange/link/registration contract;
- thin HomeMew Web same-origin Worker BFF;
- host-only signed app session and exact-Origin protection;
- Access registration/link-challenge BFF routes;
- same-origin LifeSpace Core/Identity proxy;
- staging LifeSpace Web application/AUD provisioning script.

Remaining real staging rollout:

- deploy LifeSpace Identity schema v5 / contract 0.5.0 to staging;
- configure `ACCESS_TEAM_DOMAIN`;
- create/protect `homemew-web-staging.aisr.online` in Cloudflare Access and obtain its AUD;
- provision `app_homemew_web_staging` and install its dedicated `lsa_*` in the Web Worker secret store;
- install `WEB_SESSION_SECRET` and deploy the staging Web Worker;
- prove real Access exchange, explicit registration, link challenge and authenticated Core requests;
- then replace preview data with LifeSpace-backed profile/family/Space context.

### Phase W3 - core household pages

- Calendar with Schedule-X and LifeSpace Calendar/event capability.
- Tasks with LifeSpace task Actions.
- Day records/anniversaries.
- Wishes.
- Family/member management.
- Add TanStack Query when this real server-state integration begins.

### Phase W4 - household admin settings

- Family settings and permissions-aware controls.
- External integrations only after the required LifeSpace provisioning contract is approved.
- Diagnostics should expose request IDs without leaking tokens or secrets.

## 10. Production routing constraint

The final Web domain remains `homemew.aisr.online`, but that hostname currently serves the production Mini Program login endpoint through `homemew-backend-production`.

Do not transfer the production hostname to the Web Worker until the Web front-door can preserve `/api/v1/login/wechat` through an explicit HomeMew backend Service Binding/pass-through and the full Web Access path has passed staging verification.

The isolated first Web hostname is `homemew-web-staging.aisr.online`.

## 11. Non-goals

- SSR/SEO framework complexity for the signed-in household app.
- A second HomeMew business database.
- A permanent compatibility/business BFF or `/families/...` facade.
- A HomeMew-owned credential authority.
- Separate desktop/mobile Web codebases.
- Authorization Code + PKCE as a parallel LifeSpace browser login architecture while Cloudflare Access remains the approved long-term Web SSO layer.
