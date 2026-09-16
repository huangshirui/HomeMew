# Mini Program runtime-call inventory and final BFF contract

Status: Phase 1 design baseline  
HomeMew source revision: `6106552311bbfc3d06a5f07a95b11fc0092f035c`  
LifeSpace source revision: `cd25c8bb0f88f503f5c7a4a48f90ffed53727c0a`  
Tracking: HomeMew #79  
Rollout plan: `docs/plans/2026-09-16-miniprogram-final-bff-rollout.md`

This document is the source-derived inventory and route/DTO design baseline for the one-time Mini Program migration. It is not an alternative LifeSpace Query or time specification. LifeSpace Specification, Runtime, and tests remain authoritative for Canonical Query, Sort, TemporalRange, Space, Identity, and authorization semantics.

## 1. Inventory method and completeness boundary

The inventory was generated from the current Mini source, not from historical documentation:

- every TypeScript source under `apps/miniprogram/miniprogram` was checked for service imports and direct network primitives;
- every file under `services/` was checked for `request`, `wx.request`, upload, target selection, and URL construction;
- startup (`app.ts`, launch page, stores, runtime bootstrap), invitation deep links, account linking, Creation Draft polling, avatar display/upload, and the About-page latency diagnostic were inspected explicitly;
- no page or store performs an unlisted network call; runtime calls are centralized in services, except that `activity.ts`, `auth.ts`, `media.ts`, and `core-latency.ts` intentionally use `wx.request` directly today.

Shared current behavior:

- authenticated calls carry the short-lived LifeSpace user bearer;
- `services/api.ts` retries one 401 after serialized HomeMew login refresh;
- write/action calls use `skipRetry` to avoid unsafe automatic replay;
- current target selection is `core | identity | backend`, with public base URLs cached by `config.ts`;
- domain responses are adapted to the existing Mini product DTOs in `types/index.ts`;
- user IDs exposed to Mini are translated to/from LifeSpace Space Person IDs in `lifespace.ts`.

## 2. Stable Mini BFF conventions

All final application routes below are under the HomeMew production origin.

- Public provider routes remain `/api/v1/login/wechat`.
- Stable application routes use `/api/v1/miniprogram/**`.
- Except login and cacheable avatar reads, routes require the LifeSpace user bearer.
- Success JSON uses `{ "data": ... }`; errors retain `{ "error": { "code", "message", "requestId" } }`.
- Cursor pages use `{ "items": [...], "nextCursor": string | null }`.
- IDs are opaque. Mini uses product names such as `familyId`, `attendeeIds`, `assigneeIds`, and `subjectUserId`; the BFF owns Space/Person translation.
- Writes and state actions preserve the current `version` optimistic-concurrency requirement.
- Query parameters are bounded product filters. The Mini never sends a Canonical Query AST, `modelKey`, arbitrary field/operator, upstream path, or upstream URL.
- Every returned `avatarUrl` is either null or a HomeMew BFF media URL. Returning a public LifeSpace asset URL is contract drift.
- Date values remain dates, instants remain instants, ranges remain half-open, and IANA timezone context is explicit where local-day or mixed temporal semantics require it.

The existing TypeScript product DTOs (`UserProfile`, `Family*`, `Event`, `Task`, `DayRecord`, `Wish`, and Creation Draft job types) are the initial Mini DTO shapes. Phase 1 implementation must move mapping into the BFF without changing page-visible semantics.

## 3. Complete route and adapter inventory

Legend:

- **Current** is the source-observed call before Phase 2.
- **Final** is the frozen Mini-facing route.
- **Adapter now** is the production-compatible LifeSpace target to implement first.
- **Phase 4** names a known adapter change; “unchanged” means no planned breaking change, not permanent coupling.

### 3.1 Provider, activity, Identity, and media

| Source / product operation | Current target, method, path, DTO/auth | Final HomeMew route and Mini DTO | Adapter now | Phase 4 |
| --- | --- | --- | --- | --- |
| `auth.callLogin`; launch, refresh, activity bootstrap | HomeMew backend, `POST /api/v1/login/wechat`; WeChat code -> `LoginResponse`; public | Keep `POST /api/v1/login/wechat`; response stops treating Core/Identity public URLs as Mini configuration in Phase 2 | Existing `HOMEMEW_BACKEND` provider flow and LifeSpace token exchange | Unchanged |
| `activity.sendMiniProgramActivity`; every `App.onShow`, once/local day | HomeMew backend, `POST /api/v1/activity/me`, `{channel:"miniprogram"}`; bearer | Keep `POST /api/v1/activity/me`; no domain DTO | Existing HomeMew backend activity handler | Unchanged |
| `users.getCurrentUser`; launch/store and family helpers | Identity, `GET /api/v1/me`; `UserProfile`; bearer | `GET /api/v1/miniprogram/me`; `UserProfile` with rewritten avatar URL | Identity `GET /api/v1/me` | Unchanged |
| `users.updateCurrentUser`; profile setup | Identity, `PATCH /api/v1/me`; `UpdateCurrentUserRequest -> UserProfile`; bearer | `PATCH /api/v1/miniprogram/me`; same product DTOs | Identity `PATCH /api/v1/me` | Unchanged |
| `media.uploadAvatar`; profile setup | Identity, multipart `PUT /api/v1/me/avatar`; `AvatarUploadResult`; bearer, one 401 refresh | multipart `PUT /api/v1/miniprogram/me/avatar`; `{avatarUrl}` using HomeMew media URL | Identity `PUT /api/v1/me/avatar` | Unchanged |
| User avatar display from profile/member/person DTOs | Browser image GET to Identity `/assets/users/{userId}/avatar`; public | `GET /api/v1/miniprogram/media/users/{userId}/avatar`; binary/cache headers; public opaque asset read | Identity `GET /assets/users/{userId}/avatar` | Unchanged |
| `account-link.confirmWebAccessLink`; account-link page | Identity, `POST /api/v1/me/access-link-challenges/{challengeId}/confirm`; no body; bearer | `POST /api/v1/miniprogram/me/access-link-challenges/{challengeId}/confirm`; void | Same Identity route | Unchanged |
| `media.uploadFamilyAvatar`; family create/edit | Core `GET /api/v1/spaces/{id}` for version, then multipart `PUT /api/v1/spaces/{id}/avatar`; bearer | multipart `PUT /api/v1/miniprogram/families/{familyId}/avatar`; version is a multipart field; `{avatarUrl,version}` | Core Space GET only if caller omitted version during transition, then Core avatar PUT; final Mini write DTO should carry version | Unchanged |
| Family avatar display from family/invite DTOs | Browser image GET to Core `/assets/spaces/{spaceId}/avatar`; public | `GET /api/v1/miniprogram/media/families/{familyId}/avatar`; binary/cache headers; public opaque asset read | Core `GET /assets/spaces/{spaceId}/avatar` | Unchanged |

### 3.2 Families, members, and invitations

| Source / product operation | Current target, method, path, DTO/auth | Final HomeMew route and Mini DTO | Adapter now | Phase 4 |
| --- | --- | --- | --- | --- |
| `families.listMyFamilies`; launch/store | Core `GET /api/v1/me/spaces`, then members GET per family; `FamilyListItem[]`; bearer | `GET /api/v1/miniprogram/families`; `{items: FamilyListItem[]}` | Core me/spaces plus bounded member-count enrichment; rewrite avatars | Unchanged |
| `families.createFamily`; family/create | Identity me GET plus Core `POST /api/v1/spaces`; `CreateFamilyRequest -> CreateFamilyResult`; bearer | `POST /api/v1/miniprogram/families`; same product DTOs | Identity me + Core create Space `kind=family` | Unchanged |
| `families.getFamily`; detail/edit/members | Core Space GET + members GET + Core me GET; `FamilyDetail`; bearer | `GET /api/v1/miniprogram/families/{familyId}`; `FamilyDetail` | Same bounded Core composition | Unchanged |
| `families.isFamilyOwner`; detail | Members GET + Identity me GET; boolean used only by UI | No separate route: `FamilyDetail.currentUserRole` is authoritative UI capability hint; authorization remains Core-owned | Derived while composing family detail | Unchanged |
| `families.updateFamily`; family/edit | Core Space GET then `PATCH /api/v1/spaces/{id}`; `UpdateFamilyRequest -> FamilySummary`; bearer | `PATCH /api/v1/miniprogram/families/{familyId}`; body includes `version`; `FamilySummary` | Core Space PATCH | Unchanged |
| `families.closeFamily`; family/detail | Core Space GET then `POST /api/v1/spaces/{id}/close`; bearer | `POST /api/v1/miniprogram/families/{familyId}/close`; `{version}`; void | Core Space close | Unchanged |
| `families.leaveFamily`; family/detail | Core `POST /api/v1/spaces/{id}/leave`; bearer | `POST /api/v1/miniprogram/families/{familyId}/leave`; void | Same Core route | Unchanged |
| `families.listFamilyMembers` / shared `getSpaceMembers`; all assignment/person mapping pages | Core `GET /api/v1/spaces/{id}/members`; `FamilyMember[]`; bearer | `GET /api/v1/miniprogram/families/{familyId}/members`; `{items: FamilyMember[]}` | Core members; map roles and Person IDs; rewrite avatars | Unchanged |
| `families.updateMemberRole`; members page | Core `PATCH /api/v1/spaces/{id}/members/{userId}`; product role + current member version; bearer | `PATCH /api/v1/miniprogram/families/{familyId}/members/{userId}`; `UpdateMemberRoleRequest + version -> {userId,role}` | Core member PATCH; admin/member -> admin/editor | Unchanged |
| `families.removeFamilyMember`; members page | Core `DELETE /api/v1/spaces/{id}/members/{userId}`; `{version}`; bearer | Same method at `/api/v1/miniprogram/families/{familyId}/members/{userId}`; void | Core member DELETE | Unchanged |
| `families.createInvite`; invites page | Core `POST /api/v1/spaces/{id}/invites`; `CreateInviteRequest -> InviteCreated`; bearer | `POST /api/v1/miniprogram/families/{familyId}/invites`; same product DTOs and HomeMew join path | Core invite create | Unchanged |
| `families.listInvites`; invites page | Core `GET /api/v1/spaces/{id}/invites`; `InviteListItem[]`; bearer | `GET /api/v1/miniprogram/families/{familyId}/invites`; `{items}` | Core invite list | Unchanged |
| `families.revokeInvite`; invites page | Core `POST /api/v1/spaces/{id}/invites/{inviteId}/revoke`; bearer | Same action under `/api/v1/miniprogram/families/{familyId}/invites/{inviteId}/revoke`; void | Same Core action | Unchanged |
| `families.previewInvite`; `family/join?code=` deep link/manual entry | Core `POST /api/v1/space-invites/preview` with token; `InvitePreview`; bearer | `POST /api/v1/miniprogram/family-invites/preview`; `{code} -> InvitePreview` | Core preview with token; rewrite family avatar | Unchanged |
| `families.joinFamilyByCode`; join deep link | Identity me GET then Core `POST /api/v1/space-invites/join` with token/displayName; `JoinFamilyResult`; bearer | `POST /api/v1/miniprogram/family-invites/join`; `{code} -> JoinFamilyResult` | Identity me + Core join; BFF owns displayName composition | Unchanged |

### 3.3 Events

All Event routes return the existing `Event` product union. The Mini contract keeps `isAllDay` as a presentation discriminator; it is not asserted as LifeSpace storage truth.

| Source / product operation | Current target, method, path, DTO/auth | Final HomeMew route and Mini DTO | Adapter now | Phase 4 |
| --- | --- | --- | --- | --- |
| `events.fetchEventsPage/listEvents`; Events and Home pages | Existing Event-only BFF `GET /api/v1/miniprogram/spaces/{id}/events`; date window/timezone/attendee/status/q/cursor/limit; `EventsPage`; bearer | `GET /api/v1/miniprogram/families/{familyId}/events`; product query `startDate,endDateExclusive,timezone,attendeeId?,status?,q?,cursor?,limit?`; `EventsPage` | Current Event Calendar compatibility query using explicit UTC/date bounds and `calendarStart:asc` | Canonical Event query using `when` TemporalRange, explicit `context.viewingTimezone`, half-open local window, stable sort/cursor |
| `events.getEvent`; detail/edit/deep detail navigation | Existing Event BFF GET record; `Event`; bearer | `GET /api/v1/miniprogram/families/{familyId}/events/{eventId}`; `Event` | Current split Calendar resource -> product DTO | `when` TemporalRange -> identical product DTO |
| `events.createEvent`; edit/batch helper | Existing Event BFF POST; `CreateEventRequest` currently lowered client-side to Person IDs; bearer | `POST /api/v1/miniprogram/families/{familyId}/events`; product `CreateEventRequest` with user IDs | BFF maps users -> Persons and product time union -> current split fields | BFF maps same product time union -> `when: temporal_range` |
| `events.updateEvent`; edit | Existing Event BFF PATCH; `UpdateEventRequest`; bearer | PATCH final record route; same product DTO/version | Same current split mapping | Same frozen request -> TemporalRange mapping |
| `events.deleteEvent`; detail | Existing Event BFF DELETE with `{version}`; bearer | DELETE final record route; void | Current generic record delete | Unchanged generic delete |
| `events.createEventsBatch` | Client orchestration: bounded concurrent calls to create Event | No batch wire route required; keep client orchestration over final create route so per-item errors/progress remain stable | Same create adapter | Same frozen create adapter |

### 3.4 Tasks

| Source / product operation | Current target, method, path, DTO/auth | Final HomeMew route and Mini DTO | Adapter now / Phase 4 |
| --- | --- | --- | --- |
| `tasks.listTasks`; Tasks, Completed, Home | Core Canonical `POST .../models/task/records/query`; status/assignee/due bounds/include-no-due/q/sort; currently drains up to 50 pages into `Task[]`; bearer | `GET /api/v1/miniprogram/families/{familyId}/tasks`; bounded product params `status,assigneeId,dueDateFrom,dueDateTo,includeNoDue,q,sort,cursor,limit`; page DTO | Lower deterministically to Canonical search + nested filter + explicit sort + cursor. Phase 4 unchanged |
| `tasks.getTask` | Core generic record GET; `Task`; bearer | GET `.../tasks/{taskId}`; `Task` | Generic task record; unchanged |
| `tasks.createTask` | Core collection POST; `CreateTaskRequest -> Task`; bearer | POST tasks collection; same product DTO | user IDs -> Person IDs; unchanged |
| `tasks.updateTask` | Core record PATCH; `UpdateTaskRequest -> Task`; bearer | PATCH task record; same product DTO/version | user IDs -> Person IDs; unchanged |
| `tasks.deleteTask` | Core record DELETE `{version}`; bearer | DELETE task record; void | Unchanged |
| `tasks.completeTask/reopenTask` | Core POST `.../actions/complete|reopen` `{version}`; `Task`; bearer | POST `.../tasks/{taskId}/complete|reopen`; `Task` | Fixed action mapping; unchanged |

### 3.5 Day Records

| Source / product operation | Current target, method, path, DTO/auth | Final HomeMew route and Mini DTO | Adapter now / Phase 4 |
| --- | --- | --- | --- |
| `day-records.listDayRecords/listAttentionDayRecords`; Days and Home | Core compatibility collection GET with kind/status/subjectPersonId/attentionOnly/sort/limit/cursor; `Page<DayRecord>`; bearer | `GET /api/v1/miniprogram/families/{familyId}/day-records`; product params `kind,status,subjectUserId,attentionOnly,sort,cursor,limit`; page DTO | Current Temporal capability route and computed fields. If upstream moves to Canonical Query, only adapter changes |
| `getDayRecord` | Core generic record GET; `DayRecord`; bearer | GET record route; same DTO | Unchanged |
| `createDayRecord/updateDayRecord` | Core generic POST/PATCH; product DTO lowered `subjectUserId -> subjectPersonId`; bearer | POST collection / PATCH record; same product DTO/version | Same mapping; unchanged |
| `deleteDayRecord` | Core generic DELETE `{version}`; bearer | DELETE record; void | Unchanged |
| `listDayRecordOccurrences` | Core GET `.../occurrences?cursor&limit`; page of occurrences; bearer | GET `.../day-records/{id}/occurrences`; same page DTO | Same temporal capability route; unchanged |
| `createDayRecordOccurrence` | Core record GET then POST `.../actions/record-occurrence`; product result adds previous date/interval; bearer | POST `.../occurrences`; `CreateDayRecordOccurrenceRequest -> CreateDayRecordOccurrenceResult` | BFF composes previous record and action result; unchanged |
| `archiveDayRecord/restoreDayRecord` | Core POST fixed actions with version; `DayRecord`; bearer | POST `.../archive|restore`; same DTO | Fixed action mapping; unchanged |

### 3.6 Wishes

| Source / product operation | Current target, method, path, DTO/auth | Final HomeMew route and Mini DTO | Adapter now / Phase 4 |
| --- | --- | --- | --- |
| `wishes.listWishes`; Wishes list | Core Canonical query; status/owner/date bounds/sort/cursor/limit; `Page<Wish>`; bearer | `GET /api/v1/miniprogram/families/{familyId}/wishes`; same bounded product params/page DTO | Lower to Canonical filters/sort/cursor; unchanged |
| `getWish` | Core generic record GET; `Wish`; bearer | GET record route | Unchanged |
| `createWish` | Core collection POST, owner=current Person; `CreateWishRequest -> Wish`; bearer | POST collection; same product DTO | BFF resolves current Person; unchanged |
| `updateWish/deleteWish` | Core record PATCH / DELETE with version; bearer | PATCH / DELETE final record route | Unchanged |
| `fulfillWish/reopenWish` | Core POST fixed actions with version; `Wish`; bearer | POST `.../fulfill|reopen`; same DTO | Unchanged |

### 3.7 Dormant Meow history and active diagnostics

| Source / product operation | Current target, method, path, DTO/auth | Final HomeMew route and Mini DTO | Adapter now / Phase 4 |
| --- | --- | --- | --- |
| `createCreationDraftJob`; dormant Meow page | Historical Core `POST /api/v1/spaces/{id}/creation-drafts`; bearer | **No active final route.** Meow is offline and the page is not registered | Do not implement a LifeSpace adapter. Future HomeMew BFF-owned orchestration requires a separate accepted contract |
| `getCreationDraftJob`; dormant polling | Historical Core GET draft | **No active final route** | Historical only; excluded from Phase 2 migration |
| `chooseCreationDraftKind`; dormant selection | Historical Core POST `.../choose-model` | **No active final route** | Historical only; excluded from Phase 2 migration |
| `core-latency.runCoreLatencyTest`; About page | Direct public Core GET `/health`, GET `/api/v1/status`, and authenticated task Canonical query, three samples; exposes `coreBaseUrl` | `POST /api/v1/miniprogram/diagnostics/lifespace-core`; bounded diagnostic DTO with target label, upstream health/status/business samples, no URL/path; bearer. Mini measures end-to-end request time and supplies local `networkType` only for display | BFF probes only fixed Core binding endpoints and one authorized limit-1 task query for the selected family | Event Phase 4 irrelevant; diagnostic remains bounded |

## 4. Query lowering matrix

| Mini product route | Product inputs | Canonical lowering |
| --- | --- | --- |
| Tasks | `q`, status, assignee user, due bounds, include-null, sort | `search.text`; AND status/Person contains; due range optionally OR `isNull`; one explicit sort; cursor page |
| Wishes | status, owner user, desired-date bounds, sort | AND scalar/date filters with Person translation; one explicit sort; cursor page |
| Events after #234 | local date window, timezone, attendee user, status, q | search + AND filters including translated attendee and TemporalRange local-date-window; `context.viewingTimezone`; `when ASC`; cursor page |
| Day Records | current bounded temporal filters | Use current capability contract first; if/when lowered to Canonical Query, preserve the same product meanings and computed-field authority |

The BFF must use LifeSpace-supported field/operator combinations and pass the current user bearer so LifeSpace remains the authorization authority. It must not post-filter or re-sort paginated results in a way that breaks cursor semantics.

## 5. Transport and deployment evidence

Verified production Worker service names:

| HomeMew binding | LifeSpace production service | Purpose |
| --- | --- | --- |
| `LIFESPACE_CORE` | `lifespace-core` | Space, model, Core media, diagnostics |
| `LIFESPACE_IDENTITY` | `lifespace-identity` | user profile/avatar and access-link confirmation |
| existing `HOMEMEW_BACKEND` | `homemew-backend-production` | login/activity provider functions |

LifeSpace Core itself binds `IDENTITY` to `lifespace-identity`. HomeMew must not infer that internal binding name as its own API.

The BFF binding adapter must preserve bearer, method/body/multipart bytes, status, response/error envelope, request ID, cache headers for media, and explicit timeout behavior. There is no client-selected upstream and no generic fallback proxy.

## 6. Contract-test slice before implementation

The first implementation PR after this inventory must add failing contract/boundary tests for:

1. only the fixed route families above are accepted;
2. unknown model keys, upstream URLs, and arbitrary upstream paths are rejected;
3. bearer and request ID propagate to Core/Identity bindings;
4. error status/envelope and optimistic-concurrency conflict survive translation;
5. user IDs translate to Person IDs for attendees/assignees/subjects/owners;
6. Task/Wish/Event product filters lower to exact Canonical semantics and stable explicit sort;
7. Date/Instant, half-open Event windows, and timezone context are preserved;
8. old and new Event upstream fixtures produce the same Mini `Event` DTO;
9. all avatar URLs are rewritten to HomeMew media routes and media proxy routes are bounded;
10. multipart upload remains byte-correct and version-aware;
11. login/activity remain routed to the existing backend binding;
12. a source boundary test rejects public LifeSpace addressing in production Mini code after Phase 2.

## 7. HomeMew Web staging retirement plan

Within Phase 1, remove the HomeMew Web staging workflow and staging-only Wrangler configuration/resources after confirming none is referenced by production deployment. Mark `docs/web-staging-acceptance.md` historical/retired and update any remaining operational references. Do not remove or rename LifeSpace staging.

The replacement gate is:

`local tests/typecheck/build -> CI -> explicit production deployment -> production smoke`.

## 8. Inventory conclusions

- All active normal Mini network behavior is now accounted for; no page-local hidden API family was found. The source inventory also records dormant Meow calls so they are not mistaken for active migration scope.
- The final boundary contains more than domain CRUD: startup refresh, activity, account linking, avatars, asset reads, invite deep links, and diagnostics must migrate together. Dormant Meow/Creation Draft calls are explicitly excluded while the surface is offline.
- Event-only BFF code is a precursor, not the final route layout.
- No Mini-facing route needs Canonical AST, `modelKey`, Space Person IDs, public LifeSpace URLs, or TemporalRange wire shape.
- This design introduces no new platform semantics. It applies the accepted 2026-09-16 boundary to the current source inventory.

## 9. 2026-09-16 scope correction: Meow offline

The accepted `2026-09-16-meow-bff-ownership-and-temporary-offline` decision supersedes the Creation Draft route rows above as active design. They remain in this source-derived inventory only as historical evidence of the calls found during inspection. The current Mini package exposes no Meow page or entry, Phase 1 implements no LifeSpace Creation Draft adapter, and Phase 2 must not migrate those dormant calls. Any future Meow contract is a separate HomeMew BFF-owned capability.
