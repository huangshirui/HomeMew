# HomeMew Mini Program Agent Instructions

This file applies to all work under `apps/miniprogram/`.

Before changing Mini Program code, read these files in order:

1. `/AGENTS.md`
2. `/docs/architecture.md`
3. `/docs/product-rules.md`
4. `/apps/core/openapi.yaml`
5. `/apps/miniprogram/README.md`

## Source of truth

Use the following priority when information conflicts:

1. `/apps/core/openapi.yaml` defines the Core API contract.
2. `/docs/product-rules.md` defines product and permission rules.
3. `/docs/architecture.md` defines system boundaries and request flows.
4. Core automated tests define verified runtime behavior.
5. Core source code is implementation detail.
6. Mini Program UI code must not redefine business rules.

Every Core route in OpenAPI contains `x-homemew-status`:

- `implemented`: the route is available and may be integrated.
- `planned`: the contract is approved but the route is not yet available.

Do not call, mock as completed, or present a `planned` route as deployed unless the current task explicitly asks for a temporary mock or for the Core implementation as well.

## Product role

The HomeMew Mini Program is the primary graphical client for household members. It provides:

- WeChat login and HomeMew identity initialization;
- creation, joining, switching, and management of households;
- household member and invitation management;
- event and task interfaces;
- landing pages opened from notifications;
- conventional forms and detail pages that complement the HomeMew Agent.

The Mini Program is not an independent business backend.

All household business data belongs in HomeMew Core. Do not store authoritative families, members, invitations, events, tasks, or notifications in the WeChat cloud database.

## Architecture boundary

Use the following request flow.

### Login and identity initialization

```text
Mini Program
→ WeChat cloud function
→ obtain trusted openid from the WeChat runtime
→ resolve openid to HomeMew user_id
→ create the Core user when required
→ issue a short-lived HomeMew user JWT
→ return the JWT to the Mini Program
```

The external identity mapping is maintained outside Core.

Core only knows HomeMew internal user IDs. Never send `openid` or Enterprise WeChat `userid` to ordinary Core business APIs.

### Normal business requests

```text
Mini Program
→ Authorization: Bearer <short-lived user JWT>
→ Cloudflare Worker Core API
```

After login, ordinary user, family, member, invitation, event, and task requests should call Core directly unless the architecture document is explicitly changed.

Do not add transparent cloud-function proxy wrappers for every Core API merely because cloud functions are available.

### WeChat server capabilities

Use cloud functions for capabilities that require trusted WeChat server credentials or context, including:

- obtaining trusted `openid`;
- maintaining external identity mappings;
- issuing HomeMew JWTs;
- calling WeChat server APIs;
- generating Mini Program codes;
- subscription-message operations;
- decrypting WeChat-protected data.

Never expose the following to Mini Program code:

- `JWT_SECRET` or any JWT signing private key;
- Core service tokens;
- n8n credentials;
- WeChat `appsecret`;
- Enterprise WeChat secrets.

## Authentication behavior

The Mini Program stores only a short-lived user access token and its expiry time.

For authenticated Core requests:

```http
Authorization: Bearer <accessToken>
```

The JWT `sub` represents the HomeMew internal `users.id`.

Implement one shared request client that:

- attaches the Bearer token;
- parses Core success envelopes as `{ "data": ... }`;
- parses errors as `{ "error": { "code", "message", "requestId" } }`;
- handles network timeouts;
- handles `401` by running the login cloud function and retrying the original request once;
- prevents concurrent requests from triggering multiple simultaneous login refreshes;
- returns typed application errors instead of silently swallowing failures.

Do not automatically retry non-idempotent writes unless the Core contract supports an idempotency key for that operation.

Examples of writes that must not be blindly retried:

- create family;
- join family;
- create invitation;
- create event;
- create task;
- complete or reopen task.

## User and family context

Treat `currentFamilyId` as UI state only, never as proof of authorization.

At startup:

1. obtain or refresh the HomeMew user token;
2. call `GET /api/v1/me`;
3. call `GET /api/v1/me/families`;
4. verify that the locally cached family still exists in the returned list;
5. select the only family automatically, restore the previous valid family, or show a family selector.

If the cached family is no longer accessible, remove it from local state and do not keep displaying cached family business data.

The Core must remain responsible for checking active family membership and administrator permissions.

Front-end role checks only control visibility and interaction. They are not security controls.

## Permission rules

Ordinary active family members may:

- view family information and members;
- view, create, update, and delete household events;
- view, create, update, complete, reopen, and delete household tasks;
- leave the family.

Family administrators additionally may:

- edit family information;
- create and revoke invitations;
- promote or demote administrators;
- remove members.

Ordinary members must not see administrator-only controls, but all write calls must still rely on Core authorization.

## API integration rules

Never infer Core fields from a page mockup or create a client-only variation of a Core resource.

Before implementing a request:

1. find the operation in `/apps/core/openapi.yaml`;
2. confirm `x-homemew-status` is `implemented`;
3. follow the documented path, query, request body, response envelope, nullable fields, and error codes;
4. use HomeMew IDs, not display names, as identifiers;
5. keep API DTOs separate from page view models when formatting is needed.

Do not manually duplicate the full Core contract across multiple service files.

Prefer a single typed API layer organized by domain, for example:

```text
miniprogram/services/
  api.ts
  auth.ts
  users.ts
  families.ts
  events.ts
  tasks.ts
```

If generated TypeScript definitions become available, use them as the source for request and response types. Until then, define types from OpenAPI and keep them in one dedicated location.

## Invitation flow

Invitation codes are temporary credentials.

Do not:

- print complete invitation codes in production logs;
- include them in analytics payloads;
- retain them longer than required;
- expose family member lists or business data before authentication and Core authorization.

Joining flow:

```text
login
→ GET /api/v1/family-invites/{code}
→ show limited family preview
→ explicit user confirmation
→ POST /api/v1/family-invites/{code}/join
→ refresh GET /api/v1/me/families
→ select the joined family
```

Treat `ALREADY_FAMILY_MEMBER` as a recoverable navigation state and guide the user into the family instead of showing only a technical error.

## Event rules

Follow these domain rules when the event routes become implemented:

- an event belongs to exactly one family;
- `summary` is required;
- attendees are selected by HomeMew `userId` and must be active family members;
- an event may have no attendees;
- timed events use explicit timezone-aware datetimes and an IANA timezone;
- all-day events use date values;
- all-day event end dates are exclusive in the API;
- the UI may display inclusive dates but must convert them correctly before submission;
- edits and deletes use the contract's version field to prevent silent concurrent overwrites;
- do not implement recurring events until the contract explicitly supports them.

When a version conflict occurs, reload the latest object and ask the user to review it. Never silently overwrite another member's change.

## Task rules

Follow these domain rules when the task routes become implemented:

- a task belongs to exactly one family;
- `name` is required;
- `due` is nullable and has date-only granularity;
- assignees are selected by HomeMew `userId` and must be active family members;
- a task may have no assignees and then represents a shared family task;
- the task has one overall status, not one completion status per assignee;
- any active family member may complete or reopen a task in the first version;
- edits, completion, reopening, and deletion use the contract's version field;
- overdue is a derived UI state, not a stored Core status.

Do not add subtasks, labels, priority, recurrence, comments, or per-assignee completion unless the product rules and OpenAPI are updated first.

## Page and state design

Recommended first-version navigation:

```text
Home
Events
Tasks
Me
```

Keep page state explicit:

- authentication state;
- current user;
- available families;
- current family;
- role in current family;
- page-specific loading, empty, error, and submitting states.

Do not require every Home module to succeed before displaying the page. Family summary, events, and tasks should be able to load and fail independently.

Avoid a global store for transient form fields. Preserve unsent form input across temporary network errors or page interruptions when practical.

## WeChat UX requirements

All mutations must prevent duplicate taps while submitting.

Require explicit confirmation before:

- deleting an event or task;
- removing a family member;
- leaving a family;
- revoking an invitation.

Use user-facing messages for expected errors, including:

- login expired;
- permission denied;
- family member limit reached;
- family creation limit reached;
- invitation expired, revoked, exhausted, or invalid;
- content deleted or unavailable;
- version conflict.

Do not expose raw internal exception text to users. Preserve `requestId` for diagnostics.

## Local storage

Allowed local state includes:

- short-lived access token;
- token expiration time;
- current family ID;
- selected date or simple UI preferences;
- temporary cached API data.

Local cache is never authoritative.

Do not persist:

- service credentials;
- signing secrets;
- raw WeChat secrets;
- permanent copies of household data as an alternative data store.

## Technology and scope

The current intended first-version approach is a native WeChat Mini Program with TypeScript and WeChat cloud functions.

Do not introduce uni-app, Taro, React, Vue, or another cross-platform framework without an explicit architecture decision.

Keep dependencies minimal. Prefer native components and platform APIs for the MVP.

The current `apps/miniprogram` directory may still be a placeholder. When initializing it, preserve this file and document:

- local development commands;
- cloud environment configuration;
- required non-secret environment values;
- build and type-check commands;
- how to run or test cloud functions.

## Change discipline

When a Mini Program task reveals that the Core contract is missing or unsuitable:

1. do not invent a hidden client workaround;
2. identify the exact missing Core capability;
3. update the product rules or architecture when the behavior changes;
4. update OpenAPI before relying on the new contract;
5. implement or request the Core change;
6. only then integrate the Mini Program.

When a change affects an existing Core operation, update all affected client types, tests, and error handling in the same change where practical.

## Definition of done

A Mini Program feature is complete only when:

- it follows the documented architecture boundary;
- it calls only implemented Core routes;
- requests and responses match OpenAPI;
- authentication expiry and errors are handled;
- family permissions are represented correctly in the UI;
- loading, empty, failure, and duplicate-submit states are covered;
- no secrets or authoritative business data are placed in the client;
- relevant documentation and tests are updated.
