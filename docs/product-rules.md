# HomeMew Product Rules

This document defines product and business rules that clients and Core must follow. API syntax is defined in `apps/core/openapi.yaml`; architecture boundaries are defined in `docs/architecture.md`.

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
- External systems use `day-records:read` and `day-records:write`; write requires read, and systems cannot use `subjectUserId=me`.
- Day records are lightweight time state, not household asset files. Models, costs, attachments, mileage triggers, and maintenance projects are out of scope.

## 8. Notifications

- Notifications are separate business records from events and tasks.
- A notification may reference an event or task as its source.
- Notification content, recipient, scheduled time, channel, delivery state, and read state are separate concerns.
- Core determines what is due and records state; n8n or another channel worker may perform delivery.
- Scheduled delivery uses service identity, not a permanent administrator identity.
- Notification deep links never bypass normal family authorization.
- Reminder configuration details are not yet part of the approved event/task MVP contract.

## 9. Mini Program behavior

- Login and external identity mapping occur through trusted WeChat Cloud Functions.
- After login, normal business API calls go directly from the Mini Program to Core with a short-lived user token.
- On a `401`, the client refreshes through the login Cloud Function and retries once.
- Writes are not blindly retried until idempotency support exists.
- The Mini Program stores `currentFamilyId` only as UI context; it is not an authorization credential.
- On startup, the client refreshes the family list and confirms that the cached current family is still accessible.
- Invitation links, event links, and task links require login and a fresh Core authorization check.

## 10. Agent and n8n behavior

- A user-initiated Agent action calls the normal business API under that user's HomeMew identity.
- A scheduled or system maintenance job calls a dedicated internal endpoint under a service identity.
- Service APIs are added only for system operations without a meaningful household actor; they do not duplicate every user API.
- Core owns business cleanup rules. n8n should trigger or consume controlled operations instead of directly editing D1 or implementing deletion rules independently.

## 11. Validation and consistency

- IDs are opaque strings with domain prefixes such as `usr_`, `fam_`, `evt_`, `tsk_`, `day_`, and `dyo_`.
- Attendee and assignee arrays contain unique user IDs.
- Creation/update of a parent record and its attendee/assignee relations is atomic.
- Resources requested under `/families/{familyId}/...` must be constrained to the same `familyId` in database queries.
- API responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "requestId" } }`.
- All responses return `x-request-id`.

## 12. External systems

- Only an active family administrator may create, edit, disable, delete, or
  rotate credentials for an external system.
- An external system belongs to one family, is not a member, and cannot manage
  users, members, invitations, family settings, or avatars.
- Available permissions are `family:read`, `events:read`, `events:write`,
  `tasks:read`, `tasks:write`, `day-records:read`, and `day-records:write`;
  write requires the matching read permission.
- Systems use the same event, task, and day-record resources as users.
  `attendeeId=me`, `assigneeId=me`, and `subjectUserId=me` are invalid for systems.
- Client secrets and API tokens are returned only at creation. Multiple active
  credentials may coexist for rotation; revocation is immediate.
- Deleting an integration is a soft deletion and does not delete events or
  tasks it created. Historical actor names remain available.
- Event/task creation, update, completion, reopening, and deletion record the
  true `user` or `system` actor.
