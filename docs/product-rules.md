# HomeMew Product Rules

This document defines HomeMew product and business rules. Current platform API syntax, authentication, authorization, IDs, model fields and runtime behavior are defined by the LifeSpace contracts/implementation; architecture boundaries and explicit HomeMew -> LifeSpace mappings are defined in `docs/architecture.md`. The legacy `apps/core/openapi.yaml` is migration/reference material only and is not a current platform contract.

## 1. Users

- Core identifies a person only by HomeMew internal `users.id`.
- WeChat Mini Program `openid` and WeCom `userid` are external identities and are mapped outside Core.
- A disabled user cannot access business data, but historical references remain.
- User profile fields in the first version are `displayName` and optional `avatarUrl`.

## 2. Families

- A user may create at most three active families.
- A family may contain at most eight active members.
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
- Joining must verify invitation state and the family's current active-member count in the same transactional operation that creates/reactivates membership and increments use count.
- An already active member is not added again.
- Invitation preview reveals only limited family information: family name, optional avatar, member count, expiry, and whether joining is possible.

## 5. Events

### 5.1 Core fields

Every event has common identity, family, content, attendee, status, audit, and
version fields. Its time fields are one of two mutually exclusive shapes:

- Timed: `isAllDay=false`, `startAt`, `endAt`, optional nullable
  `startTimezone`, and optional nullable `endTimezone`.
- All-day: `isAllDay=true`, `startDate`, and `endDateExclusive`.

### 5.2 Access and editing

- Every active family member may view, create, edit, and delete events.
- Event attendees must be active members of the same family when assigned.
- An event may have no attendees.
- The creator is not automatically added as an attendee unless included explicitly.
- The first version does not support external attendees or RSVP state.

### 5.3 Timed events

- `startAt` and `endAt` are RFC 3339 UTC strings ending in `Z`; Core stores and returns canonical millisecond-precision UTC.
- `endAt` must be later than `startAt`.
- `startTimezone` and `endTimezone` are independently nullable IANA display metadata and never participate in calculations.
- On create, an omitted endpoint timezone defaults to the family timezone while an explicit `null` remains `null`.
- On update, an omitted endpoint timezone is unchanged while an explicit `null` clears it.
- Changing the family timezone does not rewrite existing event display metadata.

### 5.4 All-day events

- `startDate` and `endDateExclusive` are date-only strings in `YYYY-MM-DD` format.
- The range is half-open: `[startDate, endDateExclusive)`.
- A one-day event on July 25 uses `startDate=2026-07-25` and `endDateExclusive=2026-07-26`.
- `endDateExclusive` must be later than `startDate`.
- Time-point and timezone fields are forbidden and all-day dates are never converted to UTC.
- Clients may show inclusive end dates in forms, but must convert to the exclusive Core representation.

### 5.5 Updates and deletion

- Updates require the version read by the client.
- Core increments `version` on every successful write.
- A stale update or delete is rejected with a conflict error.
- Deletion is soft deletion.
- If event cancellation is implemented, cancellation is distinct from deletion: a cancelled event remains visible with cancelled status.

### 5.6 Event list queries

- Every query supplies `startDate` and `endDateExclusive`; there is no implicit default range.
- An optional IANA `timezone` determines the viewing-day UTC bounds for timed events and defaults to the family timezone.
- Timed and all-day overlap checks both use half-open query ranges.
- Return events that overlap the requested range, not only events whose start falls inside it.
- Deleted events are excluded by default.
- Default ordering is ascending by start.
- The first version may filter by attendee and status.

### 5.7 Out of first scope

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
- Core increments version after successful writes.
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
- Wish content is a title, optional description, and optional date-only `desiredDate`. A wish is not a task and does not imply an execution deadline.
- The lifecycle is `open`, `claimed`, `fulfilled`, or `archived`. One wish has at most one current claimant, whose identity is visible to every family member.
- A member cannot claim their own wish. Only the current claimant may release a claim. The owner or current claimant may mark it fulfilled.
- Only the owner may edit, reopen, archive, restore, or soft-delete the wish. Reopening clears claim and fulfillment state.
- Archiving retains the previous lifecycle state. Restore returns to that state, except a claim held by a removed member restores as `open`.
- Removing or leaving the family immediately releases that member's unfinished claims and increments affected wish versions. Historical owner and fulfiller references remain.
- Every mutation uses optimistic concurrency. Archived wishes are read-only except for restore and soft deletion.
- Images, product links, budgets, comments, multiple claimants, and automatic task creation are outside the first version.

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
- After login, normal business API calls go directly from the Mini Program to Core with a short-lived user token.
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

- Only a current family administrator may manage HomeMew external integrations. The client role check is UX only; the Web BFF must obtain an on-demand LifeSpace user token with `grants:manage`, and LifeSpace Core must verify current `manage` authority on the selected family `Space(kind=family)` before any integration-management operation proceeds.
- One HomeMew external system maps to one LifeSpace Service Principal and one explicit owning family Space. The service is not a Space member and receives no user/member/invitation/family-settings/avatar administration authority by default.
- Credential scope names are stable platform scopes, currently `resources:read` and `resources:write`. Model permission is not encoded as legacy scopes such as `events:write`, `tasks:read`, or `day-records:write`.
- The first HomeMew Web integration editor exposes `none`, `read`, or `write` for LifeSpace models `event`, `task`, and `day_record`. Effective data access remains Service Principal ∩ credential scope ∩ Application × Model Access ∩ current model-scoped Data Grant.
- `write` permission implies that the issued credential also carries `resources:read`; Data Grants still independently determine which model collection may be read or written in the target Space.
- HomeMew does not create a whole-Space Grant for a new external system. A migrated whole-Space `read`, `write`, or `manage` Grant is broader fallback authority and must be shown explicitly; the UI must not claim model-level `none` is effective while that broad Grant remains active.
- A Data Grant proves what a service may access; it does **not** prove which Space owns the Service Principal or may rotate its globally usable credentials. Every HomeMew-created Principal therefore carries an explicit owning-Space binding stored as HomeMew-namespaced application metadata on the authoritative LifeSpace Principal. With the current LifeSpace schema this is encoded in the description as `homemew:v1:space=<spc_*>` and stripped from the user-facing description by the BFF.
- Another Space receiving a Data Grant to the same `svc_*` does not gain Token creation/revocation, Principal editing, or disable rights. A Principal explicitly bound to another Space is not surfaced as manageable merely because the current Space has granted it data access.
- A migrated Principal without the HomeMew owning-Space binding may be shown read-only when the current family has a current or historical Grant to it, but HomeMew must not expose its Token metadata, rotate/revoke its credentials, edit it, disable it, or automatically claim it. Ownership migration requires a controlled process that can prove the intended one-family ownership invariant.
- Service Principal and Token lifecycle operations run only on the server with a dedicated HomeMew integrations LifeSpace application credential. Browser code never receives either `lsa_*` application credential or LifeSpace user Bearer tokens.
- `lsp_pat_*` plaintext is returned only when created. HomeMew may render it once in current in-memory UI state but must not persist it in localStorage, sessionStorage, a HomeMew database, logs, analytics, or telemetry. Multiple active Tokens may coexist to support create-new-then-revoke-old rotation; revocation is immediate.
- Disabling an integration disables its Service Principal first, then attempts to revoke active Tokens and current-family Data Grants. If cleanup partially fails, the Principal remains disabled so the fail-safe state removes effective service access until cleanup is repaired.
- Systems use the same LifeSpace event, task, and day-record resources as users. User-relative aliases such as `attendeeId=me`, `assigneeId=me`, or `subjectUserId=me` are invalid for service principals where the active LifeSpace contract does not define them.
- `wish` is not exposed to service principals in the first HomeMew Web external-integration slice.
- HomeMew Eventing configuration uses one Webhook Endpoint per external system in the current product UI. The Endpoint owns the shared callback URL and signing secret; selecting 日程 or 待办 only creates/enables a model/event filter under that Endpoint and never creates another secret.
- Endpoint test, enable/disable, signing-secret rotation and delivery history are configured once for the external system, not repeated per model.
- An Event Subscription filter grants no data authority; the Service Principal must retain the corresponding current model Data Grant and LifeSpace re-checks current authority before delivery.
- Disabling or deleting an integration does not delete historical events, tasks, or day records it created. Audit fields preserve the true service principal as actor where the LifeSpace model supports actor audit.

## 14. AI creation drafts

- Interpretation classifies text as `event`, `task`, `day_record`, or `wish`.
  When the kind is genuinely ambiguous and the request has no `targetKind`, the
  response is exactly `choose_kind` with two to four unique `candidateKinds`.
  It contains no confidence score. After the user chooses, the client repeats
  the request with the original text and that `targetKind`; a ready result must
  use the requested kind.
- A ready result contains the complete draft shape for exactly one kind,
  `missingFields`, and `warnings`. `missingFields` names values that the client
  must ask the user to supply or confirm. A nullable scalar set to `null` means
  unknown, invalid, ambiguous, or inapplicable; Core and clients must not turn
  it into an invented default. Arrays are always present and may be empty.
- Member names are resolved only against active members of the requested
  family. The provider sees display names with temporary request-scoped
  references, not HomeMew user IDs. Duplicate display names must not be guessed:
  even a unique temporary reference for a member whose display name is shared
  is treated as ambiguous and omitted from the ID array. Each ambiguous or
  unresolved reference produces `AMBIGUOUS_MEMBER` or `UNRESOLVED_MEMBER`, and
  leaves the corresponding field missing for user review. Unambiguous resolved
  IDs are de-duplicated.
- Event draft dates and `HH:mm` times are local calendar values interpreted
  in the request's `viewingTimezone`. Timed drafts keep start and end date/time
  fields; all-day drafts use the half-open `startDate`/`endDateExclusive` range
  and clear timed fields. Relative task due dates, day-record anchors, and wish
  desired dates are interpreted in the family timezone and remain date-only.
  Family-local today governs day-record rules. Invalid or impossible inferred
  values become `null` with a warning; they are not silently shifted.
- A local event wall time in a nonexistent spring-forward gap or ambiguous
  fall-back fold cannot be represented unambiguously. Core clears the affected
  `startTime` or `endTime`, adds that field to `missingFields`, and emits
  `INVALID_INFERRED_VALUE`; it never shifts the time or chooses a fold
  arbitrarily.
- Interpretation is ephemeral and never creates, updates, or reserves a Core
  record. The user must review the result and submit it through the existing
  create endpoint, whose normal authorization and validation remain decisive.
- The route is limited per authenticated user to 10 requests per 60 seconds.
  Clients should correct `INVALID_REQUEST`; wait before
  retrying `AI_RATE_LIMITED`; and present an explicit retry for provider
  unavailable, invalid-response, or timeout errors. `AI_NOT_CONFIGURED` is an
  operator condition. Core does not retry the provider automatically, and a
  client must not turn an interpretation retry into a blind create retry.