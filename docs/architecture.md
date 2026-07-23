# HomeMew System Architecture

## 1. Purpose

HomeMew is a household affairs assistant and productivity product. The initial deployment serves one primary household with at most eight members, while the data model supports users joining multiple households and creating at most three households.

Core is a unified API and data store shared by the WeChat Mini Program, WeCom application through n8n, the household display, HomeMew Agent, ALOHA, and future clients.

## 2. System context

```text
WeChat Mini Program
  ├─ login / identity / WeChat APIs ──> WeChat Cloud Functions
  └─ normal business API + user JWT ──> HomeMew Core

WeCom self-built application
  └─ messages ──> n8n / HomeMew Agent ──> HomeMew Core

Household display
  └─ read-only backend or narrowly scoped device credential ──> HomeMew Core

Scheduled jobs / notification delivery
  └─ service token ──> HomeMew Core internal API
```

## 3. Component responsibilities

### 3.1 HomeMew Core

Deployment: Cloudflare Worker using Hono and D1.

Responsibilities:

- HomeMew users
- Families and memberships
- Invitations
- Events and attendees
- Tasks and assignees
- Notifications and delivery state when implemented
- Authorization based on HomeMew identity and family membership
- Validation, business rules, audit fields, and optimistic concurrency
- Stable API contracts for every client

Core is the only source of truth for household business data.

Core does not:

- Authenticate an `openid` directly
- Store WeChat Mini Program `openid` or WeCom `userid` as the business user ID
- Expose D1 directly to clients
- Delegate household authorization to the Mini Program or n8n
- Store normal event/task data in WeChat Cloud Database

### 3.2 WeChat Cloud Functions

Responsibilities:

- Obtain a trustworthy Mini Program `openid` from the WeChat runtime
- Maintain the mapping from external WeChat identity to HomeMew internal user ID
- Create a HomeMew user through the protected internal Core API when first seen
- Issue short-lived user access tokens accepted by Core
- Call WeChat server-side APIs, such as Mini Program code generation or subscription-message APIs
- Store WeChat-specific configuration and identity mapping

Normal family, event, and task API calls should not be transparently proxied through Cloud Functions after login. The Mini Program calls Core directly with a short-lived user token.

### 3.3 WeChat Mini Program

Responsibilities:

- User-facing GUI for family, member, invitation, event, and task operations
- Call the login Cloud Function when no valid Core user token is available
- Call Core directly for normal business operations
- Treat Core responses as the source of truth
- Hide unavailable controls based on role for usability, while relying on Core for security
- Re-login and retry once after an expired-token response

The Mini Program may cache UI state and recent data, but must not become an independent business data store.

### 3.4 n8n and HomeMew Agent

Two execution modes must remain distinct.

User-initiated operation:

```text
User sends WeCom message
→ resolve WeCom userid to HomeMew user ID
→ obtain a short-lived user-context token
→ Agent calls normal Core API
→ Core applies the user's family permissions
```

System-initiated operation:

```text
Scheduled trigger
→ n8n uses service identity
→ calls dedicated internal/service API
→ Core applies service scope and owns cleanup/notification rules
```

A scheduled task must not permanently impersonate a household administrator.

### 3.5 Household display

The display is read-only. A static Cloudflare Pages application must not contain a long-lived service secret in browser JavaScript.

Preferred options:

- A small backend/Worker proxy with a narrowly scoped credential
- A short-lived device token issued by a trusted backend
- A public-display endpoint that returns only explicitly approved household summary data and is protected by a revocable device identity

## 4. Identity model

### 4.1 HomeMew internal identity

Core business records reference `users.id`, for example:

```text
usr_01JXYZ...
```

The current user is derived from the verified token subject, never from request body or query parameters.

### 4.2 External identity mapping

External mapping lives outside Core:

```text
(provider, app_id, external_user_id) → homemew_user_id
```

Examples:

- Mini Program: `external_user_id = openid`
- WeCom: `external_user_id = userid`

The same HomeMew user may be associated with multiple external identities.

### 4.3 User token

Current Core uses HS256 Bearer JWT. A normal token subject is a HomeMew `users.id`.

Target claims:

```json
{
  "sub": "usr_01JXYZ",
  "type": "user",
  "client_id": "wechat-miniprogram",
  "iss": "homemew-identity",
  "aud": "homemew-core",
  "iat": 1784680000,
  "exp": 1784683600,
  "jti": "tok_01JXYZ"
}
```

Core validates the HS256 signature and requires `sub`, `type`, `iss`, `aud`, `iat`, and `exp`. Tokens may live for at most one hour. User tokens use `type: user` and `aud: homemew-core`; service tokens use `type: service` and `aud: homemew-core-internal`. Internal endpoints additionally require the `internal` scope.

### 4.4 Service token

A service token represents software, not a household member.

Target example:

```json
{
  "sub": "svc_n8n",
  "type": "service",
  "scope": "notifications:read notifications:update maintenance:run",
  "iss": "homemew-identity",
  "aud": "homemew-core",
  "exp": 1784683600
}
```

Service endpoints must check explicit scopes and must not run `activeUser()` against a service subject.

The current `scope: internal` mechanism is an MVP capability used by `POST /api/v1/internal/users`. Fine-grained service scopes and additional service endpoints are planned architecture.

## 5. Authorization model

Authorization has two layers.

### 5.1 Caller identity and scope

- Verify the Bearer token
- Determine whether the caller is a user or service when typed tokens are implemented
- Check required service scope for internal endpoints

### 5.2 Family business permission

For user operations:

- Read/write family data: active membership required
- Family settings, invitations, and member administration: `admin` role required
- The last administrator cannot be removed, demoted, or leave

Every family-scoped query must constrain both resource ID and `family_id`.

## 6. API layout

```text
/health                         unauthenticated deployment probe
/api/v1/status                  unauthenticated API/D1 probe
/api/v1/me                      authenticated user API
/api/v1/families/...            authenticated family business API
/api/v1/family-invites/...      authenticated invitation join API
/api/v1/internal/...            trusted service API
```

Do not duplicate all user APIs under `/internal`. Add internal endpoints only for system operations that have no meaningful acting household user, such as pending notification delivery, delivery result updates, and controlled maintenance jobs.

## 7. Mini Program request flow

### 7.1 First launch

```text
Mini Program calls login Cloud Function
→ Cloud Function gets openid
→ mapping lookup misses
→ Cloud Function calls POST /api/v1/internal/users with trusted service token
→ Core creates usr_xxx
→ Cloud Function stores openid → usr_xxx
→ Cloud Function signs short-lived user token
→ Mini Program calls GET /api/v1/me
→ Mini Program calls GET /api/v1/me/families
```

### 7.2 Returning launch

```text
Restore local token
→ refresh through login Cloud Function if missing/expiring
→ GET /api/v1/me
→ GET /api/v1/me/families
→ restore a still-valid current family
→ fetch household data in parallel
```

### 7.3 Expired token

```text
Core returns 401
→ one coordinated login refresh
→ retry original request once
```

Writes must not be blindly retried unless idempotency is supported.

## 8. Data ownership and storage

- D1 stores Core relational data.
- R2 may store future attachments or images.
- WeChat Cloud Database stores only WeChat-specific identity mapping and configuration required by Cloud Functions.
- Client local storage stores short-lived token metadata and UI preferences, not authoritative household records.

## 9. Time semantics

- Timed events use RFC 3339 date-time values with explicit offset and retain an IANA timezone.
- Core may normalize instants to UTC internally.
- All-day events use date-only half-open ranges: `[start, end)`.
- Task `due` is date-only and follows household calendar semantics; it is not a timestamp.
- Every family has an IANA default timezone, initially `Asia/Shanghai` unless selected at creation. Date-only event query bounds are interpreted in that family timezone.

## 10. Concurrency and deletion

Events and tasks use integer `version` for optimistic concurrency. Clients submit the version they read; Core rejects stale writes with a conflict error.

Events and tasks are soft-deleted using `deleted_at` and `deleted_by`. Normal list/detail endpoints exclude deleted rows.

## 11. Deployment

- Core: Cloudflare Workers, deployed by GitHub Actions and Wrangler CLI
- Database: Cloudflare D1, with remote migrations applied before Worker deployment
- Mini Program: WeChat Mini Program with WeChat Cloud Development for Cloud Functions
- Household display: Cloudflare Pages, with a protected data access path
- n8n: handles WeCom message integration, Agent orchestration, scheduled jobs, and channel delivery

## 12. Planned evolution

Near-term:

- Implement event and task contracts documented in OpenAPI
- Add fine-grained service identity and scope middleware
- Add notification model and internal delivery endpoints
- Generate TypeScript types or SDK from OpenAPI
- Add OpenAPI validation and contract checks to CI

Explicitly out of the first event/task scope:

- Recurring events and exception dates
- External event attendees and RSVP
- Recurring tasks, subtasks, labels, priorities, comments, and attachments
- Per-assignee completion state
- External calendar synchronization
