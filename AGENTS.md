# HomeMew Agent Instructions

HomeMew is a household coordination product. The repository contains a Cloudflare Worker Core API and reserved clients such as the WeChat Mini Program and household dashboard.

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

When sources disagree, do not silently guess. Preserve implemented behavior unless the task explicitly changes the contract, and update the contract, implementation, and tests together.

## Mandatory architecture rules

- Core is the system of record for users, families, memberships, invitations, events, tasks, notifications, and future household business data.
- Core uses HomeMew internal user IDs. It does not accept or store WeChat Mini Program `openid` or WeCom `userid` as business user identifiers.
- WeChat identity mapping is outside Core. A trusted identity service or WeChat Cloud Function maps external identities to HomeMew user IDs and issues short-lived Core tokens.
- The Mini Program uses a WeChat Cloud Function for login, external identity mapping, token issuance, and WeChat server-side APIs. Normal authenticated business requests are sent directly to Core.
- Never expose JWT signing secrets, WeChat secrets, service tokens, or other backend credentials to Mini Program or browser code.
- n8n and scheduled jobs use service identities and dedicated internal endpoints for work that is not performed by a specific user.
- When n8n performs an action initiated by a user, preserve that user's identity rather than permanently impersonating an administrator.
- Every family-scoped read or write must verify active membership. Administrator-only operations must additionally verify the `admin` role.
- Client-provided `userId` must never be trusted as the current actor. The actor comes from the verified token.

## API contract workflow

For an API change:

1. Update `apps/core/openapi.yaml`.
2. Update `docs/product-rules.md` or `docs/architecture.md` when the behavior or boundary changes.
3. Update Core implementation.
4. Add or update automated tests.
5. Update generated/shared client types when generation is introduced.
6. Update clients that consume the changed contract.

Do not invent client-only request or response fields. Do not infer API behavior from a screen design when the contract defines it differently.

## Contract status

`apps/core/openapi.yaml` uses the extension `x-homemew-status`:

- `implemented`: the endpoint is implemented in the current Core.
- `planned`: the endpoint is an approved contract for upcoming implementation.

Clients must not call `planned` endpoints until the implementation and deployment are complete.

## Data and time rules

- Timed events use explicit offsets and an IANA timezone.
- All-day event ranges are half-open: the end date is exclusive.
- Task due dates have date-only semantics (`YYYY-MM-DD`) and are not converted to UTC timestamps.
- Event attendees and task assignees must be active members of the same family.
- Deleted events and tasks are soft-deleted.
- Event and task updates use optimistic concurrency through `version`.

## Repository discipline

- Keep the Core modular monolith; do not introduce microservices without an explicit requirement.
- Avoid adding unused shared packages or frameworks.
- Do not place household business data in WeChat Cloud Database.
- Do not duplicate the Core data model in a client-side database as another source of truth.
- Keep API errors in the standard envelope: `{ "error": { "code", "message", "requestId" } }`.
- Keep successful responses in the standard envelope: `{ "data": ... }`.
- Preserve and return `x-request-id` for traceability.
