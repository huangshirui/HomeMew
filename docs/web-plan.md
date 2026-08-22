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

## 6. Cloudflare runtime

HomeMew Web is a client-rendered SPA deployed to Cloudflare Workers Static Assets. `assets.not_found_handling` is `single-page-application` so client routes resolve to `index.html`.

The first slice is assets-only. Do not add a generic Web BFF. Normal authenticated household API traffic must call LifeSpace Identity/Core using the LifeSpace user token once browser authentication exists.

A Worker handler may be introduced later only for a narrow trusted responsibility that cannot safely run in the browser; it must not become a compatibility Core.

## 7. Authentication dependency

The current LifeSpace Identity contract can issue short-lived app-scoped user tokens through trusted application exchange, but it does not yet expose an approved browser login/OAuth authorization-code flow for HomeMew Web.

Therefore:

- do not invent production browser authentication inside HomeMew;
- do not reuse a permanent service/application credential in browser code;
- build the Web UI/runtime and LifeSpace client boundary independently;
- define the missing browser-auth capability as a LifeSpace platform follow-up before real user data is connected.

Development preview data must be clearly marked as preview-only and must never be persisted as authoritative household data.

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

### Phase W2 - browser identity and family context

- Approve/implement the LifeSpace browser-auth contract separately.
- Register the HomeMew Web LifeSpace application with the least required model access.
- Connect profile and accessible family/Space selection.
- Replace preview data with LifeSpace-backed queries.

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
- A permanent `/families/...` compatibility BFF.
- A HomeMew-owned credential authority.
- Separate desktop/mobile Web codebases.
