# HomeMew User and Family Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete first-version HomeMew user, family, membership, and invitation Core API described by the approved design.

**Architecture:** Hono route modules authenticate requests and validate HTTP input, focused domain services enforce permissions and state transitions, and repositories execute D1 queries. Cross-table writes use D1 atomic batches; tests exercise the Worker against the local D1 database.

**Tech Stack:** TypeScript 5.9, Hono 4, Cloudflare Workers, D1/SQLite, Vitest with Cloudflare Workers pool, Web Crypto HS256 JWT.

---

## File Map

- Create `apps/core/migrations/0002_create_user_family_schema.sql`: business tables, constraints, and indexes.
- Create `apps/core/src/auth.ts`: HS256 JWT verification and Hono authentication middleware.
- Create `apps/core/src/errors.ts`: typed API/domain errors and HTTP mapping.
- Create `apps/core/src/ids.ts`: prefixed identifiers and invitation codes.
- Create `apps/core/src/validation.ts`: JSON field validation shared by routes.
- Create `apps/core/src/repositories.ts`: D1 reads and atomic writes.
- Create `apps/core/src/services/users.ts`: user use cases.
- Create `apps/core/src/services/families.ts`: family and membership use cases.
- Create `apps/core/src/services/invites.ts`: invitation lifecycle and join use cases.
- Create `apps/core/src/routes/users.ts`: `/me` and internal-user routes.
- Create `apps/core/src/routes/families.ts`: family and member routes.
- Create `apps/core/src/routes/invites.ts`: invitation routes.
- Modify `apps/core/src/env.ts`: JWT secret binding and authenticated request variables.
- Modify `apps/core/src/app.ts`: middleware, dependency composition, and route mounting.
- Create `apps/core/test/helpers.ts`: JWT generation and isolated test-data helpers.
- Create `apps/core/test/auth.test.ts`: authentication contract tests.
- Create `apps/core/test/users.test.ts`: user endpoint tests.
- Create `apps/core/test/families.test.ts`: family and member behavior tests.
- Create `apps/core/test/invites.test.ts`: invitation behavior tests.
- Modify `apps/core/.dev.vars.example`, `apps/core/README.md`, and `README.md`: configuration and API documentation.

### Task 1: Schema and shared primitives

**Files:** migration, `errors.ts`, `ids.ts`, `validation.ts`, `env.ts`, and `test/schema.test.ts`.

- [ ] Write `schema.test.ts` that queries `sqlite_master` and `PRAGMA` metadata to require all four tables, the unique `(family_id, user_id)` index, foreign keys, and enum checks.
- [ ] Run `corepack pnpm --filter @homemew/core test -- schema.test.ts`; expect failure because the tables do not exist.
- [ ] Add migration `0002_create_user_family_schema.sql` with the exact columns and constraints from the design, plus indexes for family creator, active memberships, and invite hash/family lookups.
- [ ] Add `ApiError(code, message, status)`, prefixed random ID generation, invitation code generation, and strict string/nullable-URL/integer validators.
- [ ] Run the schema test and existing `index.test.ts`; expect both to pass.
- [ ] Commit with `feat: add user and family schema`.

### Task 2: JWT authentication

**Files:** `auth.ts`, `env.ts`, `app.ts`, `test/helpers.ts`, and `test/auth.test.ts`.

- [ ] Write failing tests for missing Bearer token, malformed token, bad HS256 signature, expired token, missing `sub`, normal-user denial on internal scope, and valid user/internal claims.
- [ ] Run `corepack pnpm --filter @homemew/core test -- auth.test.ts`; expect `401`/`403` assertions to fail because routes and middleware are absent.
- [ ] Implement base64url parsing, HS256 verification with Web Crypto, `exp` validation, and `sub`/`scope` claim extraction. Never accept `alg: none` or non-HS256 headers.
- [ ] Add user and internal middleware that set `currentUserId` and scopes in Hono variables; leave `/health` and `/api/v1/status` public.
- [ ] Route all `ApiError` instances through the standard error envelope while retaining request IDs.
- [ ] Run authentication and existing tests; expect all to pass.
- [ ] Commit with `feat: authenticate Core API tokens`.

### Task 3: Users API

**Files:** `repositories.ts`, `services/users.ts`, `routes/users.ts`, `app.ts`, and `test/users.test.ts`.

- [ ] Write failing tests for internal user creation, invalid creation source/input, `GET /me`, `PATCH /me`, missing user, disabled user, and `GET /me/families` returning only active memberships with role/member count.
- [ ] Run `corepack pnpm --filter @homemew/core test -- users.test.ts`; expect route-not-found failures.
- [ ] Implement user repository records and user service methods. Internal creation accepts only `wechat_miniprogram`, `wecom`, `admin`, or `other`; profile update permits only `displayName` and `avatarUrl`.
- [ ] Implement and mount `/api/v1/internal/users`, `/api/v1/me`, and `/api/v1/me/families` routes.
- [ ] Ensure disabled users are rejected before normal business handlers execute.
- [ ] Run user, auth, and existing tests; expect all to pass.
- [ ] Commit with `feat: add Core user APIs`.

### Task 4: Families API

**Files:** `repositories.ts`, `services/families.ts`, `routes/families.ts`, and `test/families.test.ts`.

- [ ] Write failing tests for family creation, automatic admin membership, three-active-family creation limit, family detail membership isolation, profile update admin-only behavior, and active member counts.
- [ ] Run `corepack pnpm --filter @homemew/core test -- families.test.ts`; expect route-not-found failures.
- [ ] Implement atomic family plus creator-membership creation, active-family counting, member-authorized detail reads, and admin-authorized updates.
- [ ] Mount `POST/GET/PATCH /api/v1/families...` routes with strict input validation.
- [ ] Run family and prior tests; expect all to pass.
- [ ] Commit with `feat: add family APIs`.

### Task 5: Membership administration

**Files:** `repositories.ts`, `services/families.ts`, `routes/families.ts`, and `test/families.test.ts`.

- [ ] Add failing tests for member listing, admin promotion/demotion, ordinary-member denial, missing/removed member handling, last-admin protection, self-removal denial, soft removal, ordinary-member leave, admin leave with another admin, and final-admin leave denial.
- [ ] Run the focused family tests; expect failures for missing routes and behavior.
- [ ] Implement membership lookup/list/update, active-admin counting, soft removal audit fields, and leave behavior.
- [ ] Mount members `GET/PATCH/DELETE` routes and `/leave`; return `204` without a body for remove/leave.
- [ ] Run family and all prior tests; expect all to pass.
- [ ] Commit with `feat: manage family memberships`.

### Task 6: Invitations

**Files:** `repositories.ts`, `services/invites.ts`, `routes/invites.ts`, and `test/invites.test.ts`.

- [ ] Write failing tests for admin-only creation/list/revoke, default and explicit limits, one-time plaintext return, stored SHA-256 hash, preview disclosure boundary, revoked/expired/exhausted errors, duplicate joining, eight-member limit, atomic use count, and restoration of removed membership as `member`.
- [ ] Run `corepack pnpm --filter @homemew/core test -- invites.test.ts`; expect route-not-found failures.
- [ ] Implement secure `HM-XXXX-XXXX` generation, SHA-256 hashing, status normalization, invite repositories, admin operations, safe preview, and join validation in the specified order.
- [ ] Use one D1 batch for membership insert/update and invitation count increment; condition updates so exhausted invitations cannot be consumed.
- [ ] Mount family invitation management and public-code invitation routes behind user authentication.
- [ ] Run invitation and all prior tests; expect all to pass.
- [ ] Commit with `feat: add family invitation lifecycle`.

### Task 7: Documentation and full verification

**Files:** `.dev.vars.example`, `apps/core/README.md`, `README.md`, and any test/implementation files found deficient by the full gate.

- [ ] Document `JWT_SECRET`, user/internal JWT claims, external identity boundary, migrations, endpoint list, and local request examples.
- [ ] Run `corepack pnpm test`; expect every Vitest file to pass.
- [ ] Run `corepack pnpm typecheck`; expect zero TypeScript errors.
- [ ] Run `corepack pnpm build`; expect Wrangler dry-run success.
- [ ] Run `git diff --check`; expect no whitespace errors.
- [ ] Review the approved design line by line and add a failing regression test before fixing any uncovered behavior.
- [ ] Commit with `docs: document user and family APIs`.
