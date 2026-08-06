# HomeMew Agent Instructions

HomeMew is a household coordination product. The repository contains a Cloudflare Worker Core API and clients such as the WeChat Mini Program and household dashboard.

## Read before making changes

Read these files in order:

1. `docs/architecture.md`
2. `docs/product-rules.md`
3. `apps/core/openapi.yaml`
4. The README and any nested `AGENTS.md` for the application being changed
5. Relevant tests and implementation files

## Sources of truth

- API paths, request/response schemas, authentication requirements, and documented errors: `apps/core/openapi.yaml`
- System boundaries, identity flow, client-to-service call paths, and deployment responsibilities: `docs/architecture.md`
- Product constraints and business rules that are not fully expressible in OpenAPI: `docs/product-rules.md`
- Verified runtime behavior: automated tests
- Implementation details: source code

When sources disagree, do not silently guess. Preserve implemented behavior unless the task explicitly changes the contract, and update the contract, implementation, tests, documentation, and affected clients together.

## Mandatory architecture rules

- Core is the system of record for users, families, memberships, invitations, events, tasks, day records, wishes, notifications, and future household business data.
- Core uses HomeMew internal user IDs. It does not accept or store WeChat Mini Program `openid` or WeCom `userid` as business user identifiers.
- WeChat identity mapping is outside Core. A trusted identity service or WeChat Cloud Function maps external identities to HomeMew user IDs and issues short-lived Core tokens.
- The Mini Program uses a WeChat Cloud Function for login, external identity mapping, token issuance, and WeChat server-side APIs. Normal authenticated business requests are sent directly to Core.
- Never expose JWT signing secrets, WeChat secrets, service tokens, external-system secrets, or other backend credentials to Mini Program or browser code.
- n8n and scheduled jobs use service identities and dedicated internal endpoints for work that is not performed by a specific user.
- When n8n or an Agent performs an action initiated by a user, preserve that user's identity rather than permanently impersonating an administrator.
- Every family-scoped read or write must verify the caller's permitted access to that family. Administrator-only operations must additionally verify the `admin` role.
- Client-provided `userId` must never be trusted as the current actor. The actor comes from the verified token.
- External `system` principals are not family members. They may use only explicitly supported family resources and scopes.
- Internal `service` principals do not automatically gain access to normal family routes.

## API contract workflow

For an API change:

1. Update `apps/core/openapi.yaml`.
2. Update `docs/product-rules.md` or `docs/architecture.md` when the behavior or boundary changes.
3. Update Core implementation.
4. Add or update automated tests.
5. Update OpenAPI contract checks and generated/shared client types when applicable.
6. Update every client and integration surface that consumes or configures the changed contract.

Do not invent client-only request or response fields. Do not infer API behavior from a screen design when the contract defines it differently.

## Adding a new Core business domain

Adding a model such as day records, wishes, anniversaries, assets, goals, health records, or ledger entries is a repository-wide domain change, not only a table-and-route change.

Before considering the work complete, inspect every item below. Apply every relevant item. When an item is intentionally not applicable, record that decision in the implementation summary or the relevant architecture/product document rather than silently skipping it.

### 1. Domain boundary and actor matrix

Define before implementation:

- Whether the resource is user-scoped, family-scoped, integration-scoped, or internal-only.
- Which principals may read or mutate it: `user`, external `system`, and internal `service`.
- Which operations require active family membership, family administrator role, ownership, assignment, claim, or another domain-specific relationship.
- Whether an external system is supported. If it is not supported, Core must reject it explicitly rather than accidentally granting access through shared middleware.
- Whether a user-initiated Agent action must call the normal user route under the user's identity.
- Who may create, edit, transition, archive, restore, and delete records.
- Status transitions, immutable fields, optimistic concurrency rules, and soft-deletion behavior.
- Time semantics: instant, date-only, half-open date range, family-local date, or viewing-timezone value.

Keep the actor and permission decisions consistent in Core authorization, OpenAPI descriptions, product rules, architecture documentation, tests, and clients.

### 2. Persistence and Core infrastructure

Check and update as applicable:

- Add a numbered D1 migration under `apps/core/migrations`.
- Add tables, relation tables, indexes, foreign keys, uniqueness constraints, and `CHECK` constraints that enforce important invariants.
- Update `schema_metadata` and every schema-version expectation, including `/api/v1/status` and schema tests.
- Define the migration/deployment compatibility strategy. Do not introduce an avoidable interval in which the deployed Worker and database schema are incompatible.
- Add the domain ID prefix to the central ID generator when the domain has its own IDs.
- Add cursor resource names and cursor/filter binding when the domain uses pagination.
- Add shared search, sorting, date calculation, actor mapping, or validation support only when it is genuinely shared.
- Register the domain routes in the Core application.
- Preserve the standard success envelope, error envelope, and `x-request-id` behavior.
- Constrain every family resource query by both resource ID and `family_id`.

Do not rely on application validation alone when D1 can cheaply enforce a critical invariant.

### 3. API contract and stable documentation

Update all applicable contract surfaces:

- Add the OpenAPI tag, paths, operation IDs, parameters, request schemas, response schemas, error responses, examples, and `x-homemew-status`.
- Document pagination, filters, sorting, default list behavior, search behavior, state transitions, concurrency, deletion, and access restrictions.
- Add or extend `apps/core/scripts/check-openapi.mjs` for domain invariants that should not regress silently, such as required paths, discriminated unions, critical fields, and permission enum values.
- Update `docs/product-rules.md` with business rules and explicit out-of-scope behavior.
- Update `docs/architecture.md` with Core/client responsibilities, actor support, storage ownership, lifecycle interactions, and external-system boundaries.
- Update `apps/core/README.md` with practical API usage, migration notes, examples, and external-system guidance.
- Update overview lists as well as detailed domain sections. Do not leave global descriptions saying only `events/tasks` when the rule applies to all family business resources.

OpenAPI remains the authoritative syntax contract. README examples and client types must not drift from it.

### 4. External systems and scopes

For every new family business domain, explicitly decide whether external systems may access it.

When external systems are supported, update all applicable layers together:

- Core system-permission constants and types.
- Read/write dependency validation; a write scope normally requires the matching read scope.
- Route-level permission checks for system principals.
- OpenAPI `SystemPermission` enum and scope documentation.
- OAuth and API-token behavior and integration tests.
- External-system create/update responses and examples.
- Mini Program client permission types.
- External-system permission editing UI, including read/write checkbox linkage.
- Permission labels, summaries, detail display, and credential/onboarding guidance.
- n8n, Agent, household-display, and other integration documentation or configuration that enumerates supported resources.

Do not stop after adding a scope to Core. An administrator must be able to view and configure the scope through every supported management surface.

When external systems are not supported, document that decision and test that system principals receive the intended denial.

### 5. Cross-domain lifecycle and cleanup

Inspect existing operations that may affect the new domain:

- Member leave, removal, disablement, and reactivation.
- Family archival or future family deletion.
- Ownership, assignment, attendee, claimant, subject, fulfiller, or audit references.
- Whether active relationships must be released, reassigned, blocked, or retained as history.
- Whether affected records need version increments when cleanup changes visible state.
- Whether create/update/delete operations must atomically modify relation or history tables.
- Whether events from the new domain should produce notifications or outbound webhook events.

Core owns these cleanup rules. Clients, n8n, and Agents must not repair relational state by editing D1 directly.

### 6. Client and Mini Program surfaces

When a client consumes the domain, inspect and update:

- Handwritten or generated API types.
- API service wrappers and query parameter serialization.
- Page registration, list/detail/edit pages, deep links, and navigation entry points.
- Loading, empty, error, pagination, pull-to-refresh, and version-conflict behavior.
- Dirty-domain/cache invalidation and refresh behavior after every mutation.
- Family switching, member filtering, local date/time display, and role/ownership-based controls.
- Home-page aggregation, attention cards, search, common tools, quick-create menus, and dashboard/display summaries.
- Error-code mappings and user-facing permission messages.
- External-system permission configuration and summaries when the domain supports system access.

Client-side visibility rules are for usability only. Core remains the authorization authority.

### 7. AI drafts, notifications, webhooks, and other consumers

For each repository feature that enumerates supported business kinds or reacts to business changes, decide whether the new domain participates. Inspect at least:

- AI creation-draft kind enums, provider schema, prompt rules, normalization, OpenAPI union, tests, client draft buffer, and form prefill.
- Notification scheduling, source references, due-item queries, and delivery payloads.
- Webhook event types, subscription filters, serialization, retry/delivery behavior, and documentation.
- Home-page attention aggregation, search, household display, n8n workflows, and Agent tools.
- Import/export, backup, analytics, and audit views when present.

Do not automatically add the domain to every consumer. Make and document an explicit product decision for each applicable consumer.

### 8. Required verification

Add or update tests appropriate to the domain, including:

- Migration and current-schema assertions.
- Schema version and status endpoint expectations.
- Core CRUD and state-transition behavior.
- Validation and database invariants.
- User authorization, ownership/role restrictions, and cross-family isolation.
- External `system` and internal `service` allow/deny matrices.
- Scope dependency and credential behavior when system access is supported.
- Optimistic concurrency and stale-version conflicts.
- Soft deletion, archive/restore, and default-list exclusion.
- Member leave/removal cleanup and historical-reference behavior.
- Pagination cursor binding to filters, sort, family, and date context when applicable.
- OpenAPI contract checks.
- Client type checking and relevant client tests.

A happy-path CRUD test alone is not sufficient for a new domain.

### 9. Deployment order

For a schema-backed domain, use this order unless an explicitly documented backward-compatible rollout requires another sequence:

1. Complete contract, implementation, tests, documentation, and affected clients in the repository.
2. Run repository checks, Core tests, type checks, OpenAPI checks, and builds.
3. Apply the production D1 migration.
4. Deploy the compatible Core Worker.
5. Verify `/health`, `/api/v1/status`, schema version, authentication, and representative domain requests.
6. Release clients that call the new implemented endpoints.

Clients must not call `planned` or undeployed endpoints. Never deploy a client that requires a schema or Core behavior that is not already available in production.

## Contract status

`apps/core/openapi.yaml` uses the extension `x-homemew-status`:

- `implemented`: the endpoint is implemented in the current Core.
- `planned`: the endpoint is an approved contract for upcoming implementation.

Clients must not call `planned` endpoints until the implementation and deployment are complete.

## Data and time rules

- Every concrete instant stored or returned by Core uses canonical RFC 3339 UTC with a `Z` suffix unless an approved contract explicitly says otherwise.
- Timed events use UTC instants plus optional IANA timezone display metadata.
- All-day event ranges are half-open: the end date is exclusive.
- Task due dates and other date-only household values use `YYYY-MM-DD` semantics and are not converted to UTC timestamps.
- Family-local calculations must use the family's IANA timezone when the domain contract defines household-calendar semantics.
- Event attendees, task assignees, and other active member relationships must reference active members of the same family at assignment time unless the domain explicitly defines a different rule.
- Historical member and actor references may remain after membership removal when required for audit/history.
- Mutable business resources should use optimistic concurrency and soft deletion unless the approved domain rules explicitly justify another behavior.

## Repository discipline

- Keep Core as a modular monolith; do not introduce microservices without an explicit requirement.
- Avoid adding unused shared packages or frameworks.
- Do not place household business data in WeChat Cloud Database.
- Do not duplicate the Core data model in a client-side database as another source of truth.
- Keep API errors in the standard envelope: `{ "error": { "code", "message", "requestId" } }`.
- Keep successful responses in the standard envelope: `{ "data": ... }`.
- Preserve and return `x-request-id` for traceability.
- Do not finish a domain change with known contract, documentation, permission, or client drift. Fix the drift in the same change or explicitly record a separately approved follow-up with the unsupported surface kept unavailable.
