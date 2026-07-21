# HomeMew Event and Task API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved HomeMew family event and task models and first-version APIs with membership authorization, optimistic concurrency, filtering, cursor pagination, and soft deletion.

**Architecture:** Add focused event and task route/domain modules on top of Hono and D1, plus small shared family-access and pagination helpers. Keep existing APIs compatible while moving only reusable authorization helpers out of the current business module. Use real D1 integration tests in the Cloudflare Vitest pool and implement every behavior through red-green-refactor cycles.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, D1/SQLite migrations, Vitest, pnpm, Wrangler

---

## File map

- Create `apps/core/migrations/0003_create_event_task_schema.sql`: event/task tables, constraints, indexes, and schema version.
- Create `apps/core/src/family-access.ts`: active-user, active-membership, and related-member validation.
- Create `apps/core/src/pagination.ts`: strict limit and opaque cursor helpers.
- Create `apps/core/src/events.ts`: event routes, validation, persistence, mapping, and concurrency.
- Create `apps/core/src/tasks.ts`: task routes, validation, persistence, mapping, actions, and concurrency.
- Create `apps/core/test/events.test.ts`: event API integration coverage.
- Create `apps/core/test/tasks.test.ts`: task API integration coverage.
- Create `apps/core/test/pagination.test.ts`: cursor unit coverage.
- Modify `apps/core/src/business.ts`: import shared access helpers without changing existing HTTP behavior.
- Modify `apps/core/src/app.ts`: register event and task routes.
- Modify `apps/core/src/validation.ts`: exact date, nullable text, arrays, timezone, and numeric query validators.
- Modify `apps/core/src/ids.ts`: allow/use `evt` and `tsk` ID prefixes.
- Modify `apps/core/test/schema.test.ts`: assert new tables, constraints, indexes, and schema version.
- Modify `apps/core/test/helpers.ts`: reusable family/member fixtures.
- Modify `apps/core/README.md` and `README.md`: API, migration, time, filtering, and version documentation.

### Task 1: D1 schema and resource IDs

**Files:**
- Create: `apps/core/migrations/0003_create_event_task_schema.sql`
- Modify: `apps/core/src/ids.ts`
- Modify: `apps/core/test/schema.test.ts`

- [ ] **Step 1: Write failing schema and ID tests**

Add assertions that `schema_metadata` is `3`, all four tables exist, the two join tables reject duplicate pairs, event rows reject mixed/missing time shapes, status/version checks work, and generated IDs match `/^evt_/` and `/^tsk_/`.

```ts
expect(await schemaVersion()).toBe("3");
expect(await tableNames()).toEqual(expect.arrayContaining([
  "events", "event_attendees", "tasks", "task_assignees",
]));
expect(createId("evt")).toMatch(/^evt_/);
expect(createId("tsk")).toMatch(/^tsk_/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `corepack pnpm --filter @homemew/core test -- schema.test.ts`

Expected: FAIL because migration 0003 and the new tables do not exist.

- [ ] **Step 3: Add the migration and ID prefixes**

Create the four approved tables. The event table must enforce exactly one time shape:

```sql
CHECK (
  (is_all_day = 0 AND start_at IS NOT NULL AND end_at IS NOT NULL
    AND start_date IS NULL AND end_date IS NULL AND end_at > start_at)
  OR
  (is_all_day = 1 AND start_at IS NULL AND end_at IS NULL
    AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date > start_date)
),
CHECK (version >= 1)
```

Add foreign keys, unique pair keys, the approved family/time/status/deleted/user indexes, and update `schema_metadata` to `3`. Extend the `createId` prefix type with `"evt" | "tsk"` if it is currently a closed union.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `corepack pnpm --filter @homemew/core test -- schema.test.ts`

Expected: PASS with the new migration applied.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/migrations/0003_create_event_task_schema.sql apps/core/src/ids.ts apps/core/test/schema.test.ts
git commit -m "feat: add event and task schema"
```

### Task 2: Shared authorization, validation, and cursor primitives

**Files:**
- Create: `apps/core/src/family-access.ts`
- Create: `apps/core/src/pagination.ts`
- Create: `apps/core/test/pagination.test.ts`
- Modify: `apps/core/src/business.ts`
- Modify: `apps/core/src/validation.ts`
- Modify: `apps/core/test/business.test.ts`

- [ ] **Step 1: Write failing primitive tests**

Cover valid/invalid cursor round trips, wrong cursor resource/sort, limit defaults and bounds, exact `YYYY-MM-DD`, offset-required date-times, valid/invalid IANA zones, duplicate string IDs, nullable descriptions, and existing family endpoints after access-helper extraction.

```ts
const cursor = encodeCursor({ v: 1, resource: "events", sort: "start_asc", key: "2026-07-25", id: "evt_1" });
expect(decodeCursor(cursor, "events", "start_asc")).toMatchObject({ id: "evt_1" });
expect(() => decodeCursor(cursor, "tasks", "due_asc")).toThrowError(/cursor/i);
expect(exactDate("2026-07-25", "due")).toBe("2026-07-25");
expect(() => exactDate("2026-7-25", "due")).toThrow();
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `corepack pnpm --filter @homemew/core test -- pagination.test.ts business.test.ts`

Expected: FAIL because cursor and new validators do not exist.

- [ ] **Step 3: Implement minimal shared helpers**

Expose these interfaces:

```ts
export async function requireActiveUser(env: Bindings, userId: string): Promise<UserRow>;
export async function requireFamilyMember(env: Bindings, familyId: string, userId: string): Promise<MemberRow>;
export async function requireFamilyAdmin(env: Bindings, familyId: string, userId: string): Promise<MemberRow>;
export async function requireRelatedMembers(env: Bindings, familyId: string, userIds: string[], kind: "attendee" | "assignee"): Promise<void>;
export function parseLimit(value: string | undefined): number;
export function encodeCursor(value: CursorPayload): string;
export function decodeCursor(value: string, resource: CursorResource, sort: string): CursorPayload;
```

Use URL-safe base64 JSON, require `v === 1`, reject unknown shapes, and never interpolate cursor values into SQL identifiers. Move the three existing access functions from `business.ts` and import them there.

- [ ] **Step 4: Run focused and existing tests and verify GREEN**

Run: `corepack pnpm --filter @homemew/core test -- pagination.test.ts business.test.ts auth.test.ts`

Expected: PASS with existing HTTP behavior unchanged.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/family-access.ts apps/core/src/pagination.ts apps/core/src/validation.ts apps/core/src/business.ts apps/core/test/pagination.test.ts apps/core/test/business.test.ts
git commit -m "refactor: share family access and request validation"
```

### Task 3: Event creation and detail reads

**Files:**
- Create: `apps/core/src/events.ts`
- Create: `apps/core/test/events.test.ts`
- Modify: `apps/core/src/app.ts`
- Modify: `apps/core/test/helpers.ts`

- [ ] **Step 1: Write failing event creation/detail tests**

Cover authentication, non-member denial, timed and all-day creation, UTC storage, response timezone offset, trimmed/length-limited text, invalid time/date/timezone, end-before-start, duplicate attendees, non-member attendees, empty attendees, atomic association writes, correct audit users, family-bound detail lookup, and removed-attendee response filtering.

```ts
const response = await request(`/api/v1/families/${family.id}/events`, member.token, {
  method: "POST",
  body: JSON.stringify({
    summary: " 足球训练 ", start: "2026-07-25T16:00:00+08:00",
    end: "2026-07-25T18:00:00+08:00", isAllDay: false,
    timezone: "Asia/Shanghai", attendeeIds: [member.id], location: "浦东足球公园",
  }),
});
expect(response.status).toBe(201);
expect((await response.json<EventEnvelope>()).data).toMatchObject({ summary: "足球训练", version: 1 });
```

- [ ] **Step 2: Run event tests and verify RED**

Run: `corepack pnpm --filter @homemew/core test -- events.test.ts`

Expected: FAIL with route-not-found responses.

- [ ] **Step 3: Implement POST and GET detail**

Register:

```ts
POST /api/v1/families/:familyId/events
GET  /api/v1/families/:familyId/events/:eventId
```

Normalize timed input using `new Date(value).toISOString()`, preserve all-day dates, store event plus attendees in one `DB.batch`, and map creator/updater/active attendees to the approved DTO. Query detail with `id`, `family_id`, and `deleted_at IS NULL` together.

- [ ] **Step 4: Run event and regression tests and verify GREEN**

Run: `corepack pnpm --filter @homemew/core test -- events.test.ts business.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/events.ts apps/core/src/app.ts apps/core/test/events.test.ts apps/core/test/helpers.ts
git commit -m "feat: create and read family events"
```

### Task 4: Event updates, deletion, filtering, and pagination

**Files:**
- Modify: `apps/core/src/events.ts`
- Modify: `apps/core/test/events.test.ts`

- [ ] **Step 1: Write failing mutation and list tests**

Cover partial PATCH, required version, stale conflict, full-record validation, all-day switching requirements, attendee replace/preserve behavior, conditional soft delete, wrong-family not-found behavior, default active status, explicit cancelled status, timed/all-day overlap boundaries, paired range parameters, 366-day limit, `attendeeId=me`, active-member attendee filtering, stable mixed event ordering, `limit + 1`, next cursor, second page, and malformed cursor.

```ts
expect(await patchEvent({ summary: "比赛", version: 1 })).toMatchObject({ version: 2 });
expect((await patchEvent({ summary: "旧写入", version: 1 }, 409)).error.code).toBe("EVENT_VERSION_CONFLICT");
expect(await listEvents("start=2026-07-25&end=2026-07-26")).toContainEqual(expect.objectContaining({ id: overlapping.id }));
```

- [ ] **Step 2: Run event tests and verify RED**

Run: `corepack pnpm --filter @homemew/core test -- events.test.ts`

Expected: FAIL for missing PATCH, DELETE, and list behavior.

- [ ] **Step 3: Implement event mutation and list routes**

Register GET list, PATCH, and DELETE. Use conditional version updates and distinguish not-found from same-family version conflicts. For attendee replacement, batch the conditional update, delete, and inserts. Build list predicates only from enumerated filters; fetch `limit + 1`; use normalized start key plus ID for cursor ordering.

- [ ] **Step 4: Run event tests and verify GREEN**

Run: `corepack pnpm --filter @homemew/core test -- events.test.ts`

Expected: PASS for all event behaviors.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/events.ts apps/core/test/events.test.ts
git commit -m "feat: update list and delete family events"
```

### Task 5: Task creation, detail reads, and updates

**Files:**
- Create: `apps/core/src/tasks.ts`
- Create: `apps/core/test/tasks.test.ts`
- Modify: `apps/core/src/app.ts`

- [ ] **Step 1: Write failing task CRUD tests**

Cover authentication, family membership, trimmed name, nullable/strict due, description length, duplicate/non-member assignees, public tasks with no assignee, atomic inserts, family-bound detail reads, partial updates, `due: null`, required/stale version, assignee replace/preserve, direct status rejection, active assignee mapping, and soft deletion.

```ts
const created = await createTask({ name: " 购买足球鞋 ", due: "2026-07-25", assigneeIds: [member.id] });
expect(created).toMatchObject({ name: "购买足球鞋", status: "pending", version: 1 });
expect(await updateTask(created.id, { due: null, version: 1 })).toMatchObject({ due: null, version: 2 });
```

- [ ] **Step 2: Run task tests and verify RED**

Run: `corepack pnpm --filter @homemew/core test -- tasks.test.ts`

Expected: FAIL with route-not-found responses.

- [ ] **Step 3: Implement task POST, detail GET, PATCH, and DELETE**

Use a task DTO mapper parallel to events. Create task plus assignees in a batch; PATCH with optimistic version and optional assignee replacement; reject `status` in generic PATCH; soft-delete with query version and audit user.

- [ ] **Step 4: Run task tests and verify GREEN**

Run: `corepack pnpm --filter @homemew/core test -- tasks.test.ts`

Expected: PASS for CRUD behaviors.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/tasks.ts apps/core/src/app.ts apps/core/test/tasks.test.ts
git commit -m "feat: add family task CRUD"
```

### Task 6: Task completion, reopen, filters, sorting, and pagination

**Files:**
- Modify: `apps/core/src/tasks.ts`
- Modify: `apps/core/test/tasks.test.ts`

- [ ] **Step 1: Write failing action and list tests**

Cover completion audit fields, any-member completion, already-completed, stale version, reopen from completed, already-pending, clearing completion audit, reopen of persisted cancelled rows, default pending status, multi-status parsing, invalid status, `assigneeId=me`, due range boundaries, `includeNoDue`, all four sorts, no-due-last for both due directions, stable ID tie-breaks, cursor page traversal, and malformed/mismatched cursor.

```ts
const completed = await action(task.id, "complete", { version: 1 });
expect(completed).toMatchObject({ status: "completed", version: 2, completedBy: { userId: member.id } });
const reopened = await action(task.id, "reopen", { version: 2 });
expect(reopened).toMatchObject({ status: "pending", completedAt: null, completedBy: null, version: 3 });
```

- [ ] **Step 2: Run task tests and verify RED**

Run: `corepack pnpm --filter @homemew/core test -- tasks.test.ts`

Expected: FAIL for missing action and list behavior.

- [ ] **Step 3: Implement actions and list**

Register:

```ts
GET  /api/v1/families/:familyId/tasks
POST /api/v1/families/:familyId/tasks/:taskId/complete
POST /api/v1/families/:familyId/tasks/:taskId/reopen
```

Use conditional status/version updates. Whitelist sort clauses; encode cursor fields matching each sort; always append ID tie-breaking. For due sorts use a null-rank expression so null remains last in both directions.

- [ ] **Step 4: Run task tests and verify GREEN**

Run: `corepack pnpm --filter @homemew/core test -- tasks.test.ts`

Expected: PASS for all task behaviors.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/tasks.ts apps/core/test/tasks.test.ts
git commit -m "feat: add task actions and list filters"
```

### Task 7: Documentation and contract review

**Files:**
- Modify: `apps/core/README.md`
- Modify: `README.md`
- Modify: tests or implementation only when a newly written regression test exposes a design gap

- [ ] **Step 1: Review the approved design against routes and tests**

Check every requirement in `docs/superpowers/specs/2026-07-21-event-task-api-design.md` and record each against an existing test. If a behavior is uncovered, add a failing regression test before changing production code.

- [ ] **Step 2: Document the delivered contract**

Document migration 0003, the 10 CRUD routes plus complete/reopen actions, JWT/family authorization, timed/all-day formats, exclusive event end, due-date format, optimistic `version`, soft deletion, default filters, cursor opacity, and request examples.

- [ ] **Step 3: Run documentation-adjacent tests**

Run: `corepack pnpm --filter @homemew/core test -- events.test.ts tasks.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add README.md apps/core/README.md apps/core/test apps/core/src
git commit -m "docs: document event and task APIs"
```

### Task 8: Full verification and completion review

**Files:** Any implementation/test file found deficient must first receive a failing regression test.

- [ ] **Step 1: Run the complete test suite**

Run: `corepack pnpm test`

Expected: all Vitest files and tests pass with zero failures.

- [ ] **Step 2: Run TypeScript checks**

Run: `corepack pnpm typecheck`

Expected: all three TypeScript projects exit 0 with zero errors.

- [ ] **Step 3: Run the Worker dry-run build**

Run: `$env:WRANGLER_LOG_PATH='C:\tmp\homemew-wrangler'; corepack pnpm build`

Expected: Wrangler dry-run exits 0 and writes the Worker bundle to `apps/core/dist`.

- [ ] **Step 4: Check the patch and repository state**

Run: `git diff --check; git status --short; git log --oneline --decorate -10`

Expected: no whitespace errors, only intentional generated/untracked output if any, and all planned commits present.

- [ ] **Step 5: Review requirement coverage**

Re-read the design and confirm every acceptance criterion has fresh test or command evidence. Do not claim completion for any unmet item.
