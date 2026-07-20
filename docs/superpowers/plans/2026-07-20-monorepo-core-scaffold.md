# HomeMew Monorepo Core Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pnpm workspace with a deployable Hono/Cloudflare Worker Core, local D1 migration, API contract tests, placeholder apps, documentation, and GitHub Actions.

**Architecture:** The root package only orchestrates workspace scripts. `apps/core` owns the Worker, D1 schema, runtime configuration, and tests; `apps/web` and `apps/miniprogram` remain documentation-only placeholders. The Core exposes unversioned infrastructure health and versioned API status endpoints with shared response and request-ID behavior.

**Tech Stack:** pnpm workspace, TypeScript, Hono, Cloudflare Workers, D1, Wrangler, Vitest, `@cloudflare/vitest-pool-workers`, GitHub Actions

---

### Task 1: Workspace foundation

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `apps/web/README.md`
- Create: `apps/miniprogram/README.md`

- [ ] **Step 1: Add the root workspace manifest**

Create a private root `package.json` pinned to pnpm 10 with scripts `dev`, `test`, `typecheck`, `build`, and `check` delegating to `@homemew/core`. Create `pnpm-workspace.yaml` with `apps/*`; do not add `packages/*` before a shared package exists.

- [ ] **Step 2: Add repository hygiene and placeholder apps**

Ignore `node_modules`, Wrangler state/output, coverage, `.dev.vars`, generated Worker types, and local environment files while retaining `*.example`. Set UTF-8/LF defaults. Add concise placeholder READMEs stating that no framework has been selected.

- [ ] **Step 3: Verify workspace discovery**

Run: `corepack pnpm list -r --depth -1`

Expected after Task 2: the root and `@homemew/core` packages are listed.

### Task 2: Test-first Core API

**Files:**
- Create: `apps/core/package.json`
- Create: `apps/core/tsconfig.json`
- Create: `apps/core/wrangler.jsonc`
- Create: `apps/core/vitest.config.ts`
- Create: `apps/core/test/tsconfig.json`
- Create: `apps/core/test/apply-migrations.ts`
- Create: `apps/core/test/index.test.ts`
- Create: `apps/core/migrations/0001_create_schema_metadata.sql`
- Create: `apps/core/src/env.ts`
- Create: `apps/core/src/http.ts`
- Create: `apps/core/src/app.ts`
- Create: `apps/core/src/index.ts`

- [ ] **Step 1: Add package and runtime configuration**

Use package name `@homemew/core`, ESM, Hono as the runtime dependency, and Wrangler, TypeScript, Vitest 4.1+, Workers types, and the Cloudflare Vitest pool as development dependencies. Add scripts for `dev`, `test`, `typecheck`, `build` (`wrangler deploy --dry-run --outdir dist`), local migration, remote migration, and deploy.

Configure `wrangler.jsonc` with name `homemew-core`, entry `src/index.ts`, compatibility date `2026-07-20`, observability enabled, and D1 binding `DB` for database `homemew-core`. Use the explicit placeholder `REPLACE_WITH_D1_DATABASE_ID` and document that first-time setup must replace it before remote commands.

- [ ] **Step 2: Add the D1 migration and test runtime**

Create `schema_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)` and insert `schema_version=1`. Configure `cloudflareTest()` against `wrangler.jsonc`, load migrations with `readD1Migrations()`, expose them as `TEST_MIGRATIONS`, and apply them to `env.DB` in a test setup file.

- [ ] **Step 3: Write failing API contract tests**

Tests must call the Worker export and assert:

```ts
expect(await response.json()).toEqual({ data: { status: "ok" } });
expect(response.headers.get("x-request-id")).toBeTruthy();
```

They must also verify an incoming `x-request-id` is retained, `/api/v1/status` returns `{ data: { status: "ok", database: "available", schemaVersion: "1" } }`, and an unknown path returns status 404 with error code `NOT_FOUND` and the same request ID in body/header.

- [ ] **Step 4: Run tests and confirm RED**

Run: `corepack pnpm --filter @homemew/core test`

Expected: FAIL because `src/index.ts` and the API do not exist.

- [ ] **Step 5: Implement request and response helpers**

Define `Bindings` with `DB: D1Database` and optional `CORS_ORIGINS`. Implement helpers returning `{ data }` and `{ error: { code, message, requestId } }`. Use Hono middleware to accept a non-empty incoming request ID or generate `crypto.randomUUID()`, store it on the context, and echo it in `x-request-id`.

- [ ] **Step 6: Implement routes and error handling**

Add configurable CORS (local origins by default), `GET /health`, and `GET /api/v1/status`. Query `schema_metadata` for `schema_version`. Add contract-shaped 404 and 500 handlers; log the request ID and internal error while returning only `INTERNAL_ERROR` and a generic message. Export the Hono app as the default Worker entrypoint.

- [ ] **Step 7: Run tests and confirm GREEN**

Run: `corepack pnpm --filter @homemew/core test`

Expected: all API integration tests PASS inside the Workers runtime.

### Task 3: Install and validate the workspace

**Files:**
- Create: `pnpm-lock.yaml`

- [ ] **Step 1: Install dependencies**

Run: `corepack pnpm install`

Expected: installation succeeds and writes a pnpm lockfile.

- [ ] **Step 2: Run static and build checks**

Run: `corepack pnpm check`

Expected: tests, TypeScript checking, and Wrangler dry-run build all succeed.

- [ ] **Step 3: Validate the migration command**

Run: `corepack pnpm --filter @homemew/core db:migrate:local`

Expected: migration `0001_create_schema_metadata.sql` is applied to local D1 successfully.

### Task 4: CI/CD and operator documentation

**Files:**
- Create: `.github/workflows/core-check.yml`
- Create: `.github/workflows/core-deploy.yml`
- Create: `README.md`
- Create: `apps/core/README.md`

- [ ] **Step 1: Add CI checks**

On pull requests and pushes to `main`, checkout, set up Node 24, enable Corepack, install with `--frozen-lockfile`, and run `corepack pnpm check`. Grant read-only contents permission and set a timeout.

- [ ] **Step 2: Add Core deployment**

On pushes to `main` affecting the Core, root workspace files, lockfile, or deployment workflow, run checks and then `cloudflare/wrangler-action@v3` from `apps/core`. Supply `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; run remote D1 migrations before `wrangler deploy`. Do not run deployment on pull requests.

- [ ] **Step 3: Document setup and contracts**

Document prerequisites, commands, app boundaries, the two endpoints, response envelopes, request-ID behavior, local D1 migration, first-time `wrangler d1 create homemew-core` setup, replacement of the database ID, GitHub secrets, and deployment order. State that Pages and miniprogram setup are deferred.

### Task 5: Final verification and commit

**Files:**
- Modify only files created in Tasks 1-4 if verification exposes a defect.

- [ ] **Step 1: Run full verification**

Run: `corepack pnpm check`

Expected: tests, typecheck, and dry-run build PASS.

- [ ] **Step 2: Inspect repository state**

Run: `git diff --check` and `git status --short`

Expected: no whitespace errors; only intended scaffold files are changed.

- [ ] **Step 3: Commit the scaffold**

Run:

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .gitignore .editorconfig README.md apps .github docs/superpowers/plans/2026-07-20-monorepo-core-scaffold.md
git commit -m "feat: scaffold HomeMew monorepo core"
```
