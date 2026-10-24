# HomeMew Product Rules

This document defines HomeMew product and business rules. Current platform API syntax, authentication, authorization, IDs, model fields and runtime behavior are defined by the LifeSpace contracts/implementation; architecture boundaries and explicit HomeMew -> LifeSpace mappings are defined in `docs/architecture.md`. The legacy `apps/core/openapi.yaml` is migration/reference material only and is not a current platform contract.

## 1. Users

- Core identifies a person only by HomeMew internal `users.id`.
- WeChat Mini Program `openid` and WeCom `userid` are external identities and are mapped outside Core.
- A disabled user cannot access business data, but historical references remain.
- User profile fields in the first version are `displayName` and optional `avatarUrl`.

## 2. Families

- A user may create at most three active families.
- A family may contain at most eight active members. This is a HomeMew product invariant, not a LifeSpace Space invariant.
- The creator automatically becomes an administrator.
- A family may have multiple administrators.
- A family has an IANA default timezone; new families default to `Asia/Shanghai`.
- A family must always retain at least one active administrator.
- Archived families are read-only when family archival is implemented.
- Physical deletion of a family is not part of the MVP.
- Family avatars are uploaded through the dedicated Core multipart endpoint. Clients cannot set arbitrary family avatar URLs through family create or profile update requests.
- Core stores only the family avatar R2 object key and derives the public `avatarUrl` returned to clients.

## 3. Family membership and roles

Roles:

- `admin`: may manage family profile, invitations, members, external credentials, and all household business data.
- `member`: may read household data and create, edit, complete, and delete events/tasks, but may not manage the family, members, invitations, or credentials.

Rules:

- Only active members may access a family's data.
- The client may hide controls based on role, but Core is the authority.
- The final administrator cannot be demoted, removed, or leave.
- An administrator cannot remove themselves through the member-removal endpoint; they use the leave endpoint after ensuring another administrator exists.
- Removed memberships remain as history and may be reactivated when the user joins again.

## 4. Invitations

- Only administrators create, list, or revoke invitations.
- An invitation is represented by a random temporary code or a QR/Mini Program code containing the same join path.
- Core stores only a hash of the invitation code, not the plaintext.
- Plaintext code is returned only when the invitation is created.
- Invitations have an expiry time, maximum uses, current use count, and revocation state.
- Every HomeMew join path must pass through the per-family HomeMew join coordinator. The coordinator serializes the complete critical section, rechecks the invite target and current authoritative LifeSpace membership immediately before join, and rejects a new ninth active member. LifeSpace remains the membership/invite authority; HomeMew stores no member-list copy.
- An already active member is not added again.
- Invitation preview reveals only limited family information: family name, optional avatar, member count, expiry, and whether joining is possible. Its capacity result is UX guidance; the coordinator rechecks capacity at commit time.

## 5. Events

### 5.1 LifeSpace truth and HomeMew projections

Every Event has common identity, family/Space, content, attendee, status, audit, and version fields. The current LifeSpace Event resource has one authoritative time field: required `when: temporal_range`.

`when` has exactly two product-relevant variants:

- Timed: `{ kind: "instant", start, endExclusive }`.
- All-day: `{ kind: "date", start, endExclusive }`.

The old LifeSpace split Calendar fields (`isAllDay`, `startAt`, `endAt`, endpoint timezone fields, `startDate`, `endDateExclusive`) are historical platform transport and are not current Event truth.

The reviewed Mini Program intentionally keeps a stable HomeMew-owned Event DTO that may expose `isAllDay`, timed `startAt/endAt`, all-day `startDate/endDateExclusive`, and nullable timezone presentation fields. The Mini BFF deterministically maps that application DTO to/from LifeSpace `when`; those DTO fields do not recreate a second Event model or become LifeSpace authority.

### 5.2 Access and editing

- Every active family member may view, create, edit, and delete events.
- Event attendees must be active members of the same family when assigned.
- An event may have no attendees.
- The creator is not automatically added as an attendee unless included explicitly.
- The first version does not support external attendees or RSVP state.

### 5.3 Timed events

- `when.kind=instant` stores absolute RFC 3339 instants in `start` and `endExclusive`.
- `endExclusive` must be later than `start`.
- Event timezone is not persisted as part of the LifeSpace TemporalRange truth.
- HomeMew Web uses the selected family's IANA timezone as viewing/editor context when projecting instants into local date/time controls and converting edited local values back to instants.
- Changing the family timezone changes projection only; it does not rewrite stored Event instants.
- Mini-facing nullable start/end timezone fields are compatibility/presentation data only. They must not be treated as authoritative platform time semantics.
- HomeMew Web and Mini Event editors preserve the existing elapsed duration when the user changes the **start** time or start date: move the end forward/backward by the same instant delta (including midnight rollover), instead of leaving the end fixed or imposing an arbitrary one-hour end. When editing all-day start dates, preserve the calendar-day span (inclusive display end); do not convert date-only ranges through UTC instants. Editing the **end** directly never modifies the start. Invalid/nonexistent local time input falls back to normal save-time validation rather than fabricating instants.

### 5.4 All-day events

- `when.kind=date` stores date-only `start` and `endExclusive` in `YYYY-MM-DD` format.
- The range is half-open: `[start, endExclusive)`.
- A one-day event on July 25 uses `start=2026-07-25` and `endExclusive=2026-07-26`.
- `endExclusive` must be later than `start`.
- All-day dates are never converted to UTC instants.
- Clients may show an inclusive end date in forms, but must convert it to the exclusive LifeSpace TemporalRange end on submission.

### 5.5 Updates and deletion

- Updates require the version read by the client.
- LifeSpace increments `version` on every successful write.
- A stale update or delete is rejected with a conflict error.
- Deletion is soft deletion.
- If event cancellation is implemented, cancellation is distinct from deletion: a cancelled event remains visible with cancelled status.

### 5.6 Event list queries

- Current Web and platform-aware consumers use LifeSpace Canonical Query, not legacy Calendar GET range parameters.
- A calendar window filters `when` with `overlaps` and a `local_date_window` value carrying `startDate`, `endDateExclusive`, and IANA `timezone`.
- `context.viewingTimezone` carries the viewing timezone when TemporalRange ordering/projection requires it.
- Timed and all-day overlap checks both use half-open interval semantics.
- Return events that overlap the requested range, not only events whose start falls inside it.
- Deleted events are excluded by default; HomeMew calendar views normally filter `status=active`.
- Calendar ordering is ascending by `when` for the selected viewing timezone.
- The first version may filter by attendee and status.
- Mini callers continue using the stable HomeMew query DTO; the BFF lowers it to the active LifeSpace Canonical Query without exposing Canonical Query structure to the Mini Program.

### 5.7 Location compatibility during the coordinated release

The published LifeSpace Event model currently owns `location: string | null`; the approved target is one canonical nullable `location` object with required `name` and optional `address`/WGS84 `coordinates`. This is a breaking LifeSpace Model Registry migration, **not** a new HomeMew business model.

The Mini Program retains its stable `location: string | null` Event DTO; its BFF maps text to canonical `{name}` on writes and reads `location.name` after the platform cutover. HomeMew Web accepts either upstream representation, and preserves an existing rich Location only if its name has not changed. No service silently geocodes a name or copies previous coordinates to another named place. Search by explicit Location name remains part of LifeSpace's declared Event search semantics.

The trusted Web Worker `LIFESPACE_EVENT_LOCATION_FORMAT` records the *deployed upstream* representation (`string` before cutover, `location` afterwards), per environment. It is never a Mini/browser-selected option and must change only during the reviewed LifeSpace/HomeMew release process in `docs/decisions/2026-10-24-event-location-coordinated-release.md`.

### 5.8 Out of first scope

- Recurrence rules
- Exception dates
- External attendees
- RSVP
- Attachments and comments
- External calendar synchronization
- Per-attendee reminders

## 6. Tasks

### 6.1 Core fields

A task contains:

- `id`
- `familyId`
- `name`
- optional `description`
- optional date-only `dueDate`
- status
- assignees
- completion audit fields
- creation/update audit fields
- `version`

### 6.2 Access and editing

- Every active family member may view, create, edit, complete, reopen, and delete tasks.
- Assignees must be active members of the same family when assigned.
- A task may have no assignee and then represents a shared household task.
- Any active family member may complete a task, including a member who is not assigned.

### 6.3 Due date

- `dueDate` is optional.
- When present, it is `YYYY-MM-DD` only.
- It is not a UTC timestamp and must not be shifted because of timezone conversion.
- Overdue is a derived UI/query condition: task is pending and `dueDate` is before the household's current date.

### 6.4 Status

Supported domain statuses:

- `pending`
- `completed`
- `cancelled` when cancellation is implemented

Completing sets `completedAt` and `completedBy`.

Reopening sets status to `pending` and clears completion fields.

The first version has one task-level completion state. It does not track completion separately for each assignee.

### 6.5 Updates and deletion

- Updates require the current version.
- Core increments version after every successful write.
- A stale write is rejected with a conflict error.
- Deletion is soft deletion.

### 6.6 Task list queries

- Pending tasks are the default view.
- Tasks may be filtered by status, assignee, and due-date range.
- Default ordering puts dated pending tasks in ascending due-date order and undated tasks after dated tasks.
- Deleted tasks are excluded.

### 6.7 Out of first scope

- Subtasks
- Priority and labels
- Recurring tasks
- Dependencies
- Attachments and comments
- Per-assignee completion

## 7. Day records

- A day record is one of `elapsed`, `countdown`, or `cycle`; its kind cannot be changed.
- `anchorDate` is date-only. It means the latest occurrence for elapsed/cycle and the target date for countdown.
- Elapsed and cycle anchors cannot be later than today in the family's IANA timezone. Countdown targets may be in the past.
- Creating elapsed or cycle also creates an initial occurrence. Countdown records have no occurrence history.
- A manual occurrence must be later than the current anchor and no later than the family's today. It atomically advances the anchor, audit actor, and version.
- Cycle `nextDueDate` is maintained only by Core as `anchorDate + cycleDays`.
- Reminder thresholds may be null. Countdown today/past and cycle due/overdue still require attention without an advance threshold.
- Past countdowns remain critical until a household member archives them.
- Any active member may read, create, edit, record, archive, restore, and soft-delete day records. Archived records are read-only except for restore and delete.
- `subjectUserId`, when set or changed, must be an active member of the same family; historical references remain after membership removal.
- HomeMew-managed external systems access the LifeSpace `day_record` model through stable `resources:read` / `resources:write` credential scopes plus the corresponding model-scoped Data Grant; they do not use legacy `day-records:*` scopes, and they cannot use user-relative `subjectUserId=me` semantics.
- Day records are lightweight time state, not household asset files. Models, costs, attachments, mileage triggers, and maintenance projects are out of scope.

## 8. Wishes

- A wish belongs to the active family member who creates it. Clients cannot create a wish for another member.
- Every active family member may read the family's wishes. System and service principals cannot use wish routes in the first version.
- Wish content is a title, optional description, and optional date-only `desiredDate`. A wish is an aspiration, not a task, and does not imply an execution commitment or deadline.
- The business lifecycle has exactly two states: `open` and `fulfilled`.
- Any user that passes the normal LifeSpace Space/Application/Grant/model write authorization boundary and resolves to a Space Person may mark an `open` wish fulfilled. Fulfillment records `fulfilledAt`.
- The same authorized writers may `reopen` a fulfilled wish only as a correction; reopening returns it to `open` and clears `fulfilledAt`.
- Only the wish owner may edit its content or soft-delete it.
- Claiming and archiving are deliberately not part of the Wish business model. There is no `claimed`, claimant, claim/unclaim, `archived`, archive/restore, or `fulfilledByPersonId` workflow.
- The actor who performs a state transition remains available through normal LifeSpace audit data; that actor is not asserted to be the real-world person who made the wish happen.
- Every mutation uses optimistic concurrency. Soft deletion is a technical/data-management lifecycle and is not a Wish business state.
- HomeMew Mini Program gives successful creation and fulfillment restrained, warm Micro-interactions; reopening remains intentionally quiet because it is a correction.
- Images, product links, budgets, comments, and automatic task creation are outside the first version.

## 9. Notifications

- Notifications are separate business records from events and tasks.
- A notification may reference an event or task as its source.
- Notification content, recipient, scheduled time, channel, delivery state, and read state are separate concerns.
- Core determines what is due and records state; n8n or another channel worker may perform delivery.
- Scheduled delivery uses service identity, not a permanent administrator identity.
- Notification deep links never bypass normal family authorization.
- Reminder configuration details are not yet part of the approved event/task MVP contract.

## 10. Mini Program behavior

- Login and external identity mapping occur through trusted WeChat Cloud Functions.
- After login, every normal Mini Program runtime call uses the stable HomeMew Mini BFF contract with the short-lived LifeSpace user bearer. The BFF maps product DTOs deterministically to the active LifeSpace contract; LifeSpace remains authoritative for identity, model, Space/Grant and policy checks.
- On a `401`, the client refreshes through the login Cloud Function and retries once.
- Writes are not blindly retried until idempotency support exists.
- The Mini Program stores `currentFamilyId` only as UI context; it is not an authorization credential.
- On startup, the client refreshes the family list and confirms that the cached current family is still accessible.
- Invitation links, event links, and task links require login and a fresh Core authorization check.

## 11. Agent and n8n behavior

- A user-initiated Agent action calls the normal business API under that user's HomeMew identity.
- A scheduled or system maintenance job calls a dedicated internal endpoint under a service identity.
- Service APIs are added only for system operations without a meaningful household actor; they do not duplicate every user API.
- Core owns business cleanup rules. n8n should trigger or consume controlled operations instead of directly editing D1 or implementing deletion rules independently.

## 12. Validation and consistency

- IDs are opaque strings with domain prefixes such as `usr_`, `fam_`, `evt_`, `tsk_`, `day_`, `dyo_`, and `wsh_`.
- Attendee and assignee arrays contain unique user IDs.
- Creation/update of a parent record and its attendee/assignee relations is atomic.
- Resources requested under `/families/{familyId}/...` must be constrained to the same `familyId` in database queries.
- API responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "requestId" } }`.
- All responses return `x-request-id`.

## 13. External systems

- Only a current family administrator may manage HomeMew external systems. Client role checks are UX only; HomeMew Web must obtain the narrow LifeSpace manager authority required for each operation, and LifeSpace remains authoritative for Space/model authorization.
- A HomeMew External System is an application-owned capability container with an opaque `ext_*` ID and exactly one owning HomeMew family / LifeSpace Space. Creating it records only `displayName`, optional `description`, owning Space and audit metadata; it does **not** create any LifeSpace identity, credential, Data Grant or Webhook.
- External System container metadata is stored in the HomeMew backend Durable Object layer. HomeMew may persist LifeSpace identity references such as `servicePrincipalId` and `agentId`, but must not persist credential plaintext, LifeSpace user bearers, Data Grant copies, Webhook signing secrets or a duplicate authorization table.
- Binding/unbinding `servicePrincipalId` and `agentId` uses compare-and-swap semantics so concurrent capability setup/removal cannot silently overwrite a newer binding.
- The current capability areas are **Service Access**, **Agent Access**, and **Event Push**. Service Access and Agent Access are independent: either may exist without the other, and creating one must not create the other.

### 13.1 Service Access

- Enabling Service Access creates one LifeSpace Service Principal owned by the canonical HomeMew Application, one selected authentication mode at steady state, and model-scoped Data Grants for the current family.
- Credential scope names are stable platform scopes, currently `resources:read` and `resources:write`. Model permission is not encoded as legacy scopes such as `events:write`, `tasks:read`, or `day-records:write`.
- HomeMew exposes `none`, `read`, or `write` for LifeSpace models `event`, `task`, and `day_record`. Effective service data access remains Service Principal ∩ credential scope ∩ Application × Model Access ∩ current model-scoped Data Grant.
- `write` implies `resources:read` + `resources:write` at the credential ceiling; Data Grants independently determine which model collections may actually be read or written.
- HomeMew does not create a whole-Space Grant for new Service Access. A migrated whole-Space `read`, `write`, or `manage` Grant is broader fallback authority and must be shown explicitly before model-level permissions can be represented as authoritative.
- LifeSpace Service Principal ownership metadata still uses the existing HomeMew namespaced description marker (`homemew:v1:space=<spc_*>`) for the bounded legacy Service orchestration path. This marker proves which family may manage that globally usable `svc_*`; it does not make the Service Principal the External System container.
- One selected authentication mode is active at steady state: Service API Token or OAuth Client Credentials. Rotation may temporarily create a second credential, then explicitly completes by revoking the old credential or cancels by revoking the candidate.
- Credential plaintext is returned only at creation. HomeMew may render it once in current in-memory UI state but must not persist it in localStorage, sessionStorage, HomeMew storage, logs, analytics, telemetry or URLs.
- Removing Service Access disables the Service Principal first, then revokes current-family Data Grants and active service credentials. It also removes Event Push resources bound to that Service Principal before the External System clears its `servicePrincipalId` reference. Agent Access is unaffected.

### 13.2 Agent Access

- Enabling Agent Access creates one LifeSpace Agent identity (`agt_*`) owned by the canonical HomeMew Application, an Agent API credential (`lsp_agt_*`) and optional direct model-scoped Agent Data Grants for the current family.
- Agent API credential scope is only the technical read/write ceiling. Direct Agent Data Grants determine what `Principal=Agent / Actor=Agent` may access without a user delegation; all direct permissions may be `none` when the Agent is intended to operate only through explicit User Delegation.
- Agent Access is bound directly by the External System container (`ext_* -> agt_*`). HomeMew must not store the Agent ID inside a Service Principal description and must not require a Service Principal in order to create an Agent.
- Agent credential plaintext is returned only at creation/rotation and follows the same no-persistence rule as service credential plaintext.
- Removing Agent Access revokes current-family Agent Data Grants and active Agent API credentials before clearing `agentId`. Service Access and Event Push are unaffected. Historical Agent identity rows may remain in LifeSpace for audit.

### 13.3 Event Push

- Event Push is a separate HomeMew capability, not another name for Service Access. It uses LifeSpace Webhook Endpoint + Event Subscription resources and HomeMew does not persist the Webhook signing secret.
- The current LifeSpace Eventing contract requires a Webhook Endpoint to reference a subscriber Service Principal whose current model-read authority is re-checked before delivery. Therefore HomeMew currently requires Service Access before Event Push can be configured. This is an explicit platform dependency; HomeMew must not create a hidden `svc_*` merely to make Event Push look independent.
- HomeMew currently exposes one Webhook Endpoint per External System/Service Access pair: one callback URL, one signing secret, one endpoint-level enable/disable state, one test action and one combined delivery history.
- 日程 and 待办 are selectable Event Subscription filters under that Endpoint. Selecting a model does not create another Webhook or another signing secret.
- An Event Subscription grants no data authority. The subscriber Service Principal must retain the corresponding current model-read Data Grant and LifeSpace re-checks current Application × Model Access and current Grant state before delivery.

### 13.4 Compatibility and history

- The older implementation where the Service Principal ID itself was used as the HomeMew External System ID is a bounded compatibility path only. New UI and new production setup use `ext_*` containers.
- Disabling/removing an access capability does not delete historical household records it created. LifeSpace audit/history preserves the actual actor identity where supported.
- The External System container itself is retained when individual capabilities are removed; physical deletion of the container is not part of this slice.

Detailed decision: `docs/decisions/2026-10-09-external-system-capability-container.md`.

## 14. 喵一下 / AI creation drafts

- “喵一下”当前下线：Mini 不注册该页面，Web/Mini 都不展示入口或占位卡片；现存历史页面与 LifeSpace Creation Draft 客户端代码不是当前运行契约。
- 未来若重新启用，文本解释、模型/provider 编排、限流与临时 draft-job 生命周期由有界 HomeMew BFF 能力负责，不再使用或扩展 LifeSpace Registry Creation Draft capability。
- 重新启用前必须有独立的 Accepted Decision 和 Mini-facing contract，明确稳定 DTO、任务生命周期/存储、provider trust、滥用防护、可观测性、成员解析、时间语义和失败处理；不得从休眠代码反推新契约。
- AI 草稿只属于应用编排，不是家庭业务事实。用户必须先审阅；确认后的 Event、Task、Day Record 或 Wish 仍通过各自的 HomeMew Mini BFF 产品路由写入 LifeSpace，并由 LifeSpace 执行最终授权、校验与持久化。
- 该边界不得演变为通用 AI proxy、任意上游代理或第二个 HomeMew business Core。

详细决定见 `docs/decisions/2026-09-16-meow-bff-ownership-and-temporary-offline.md`。
