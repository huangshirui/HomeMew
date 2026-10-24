# Decision: HomeMew Web containers expose LifeSpace Semantic Relations

Date: 2026-10-23
Status: Accepted for implementation PR; no deployment implied
Scope: HomeMew Web /activities, /goals, /habits and their related Task/DayRecord UX.

## Feedback and decision / 需求与决策

The published Activity, Goal and Habit pages exposed only standalone CRUD and lifecycle actions, leaving LifeSpace's container-oriented `relates_to` Semantic Relations inaccessible. This change supplies one reusable container-detail UI for all three models with outgoing links, incoming read-only links, authorized unlinking, searching existing records, and creating a new related Task. Activity additionally creates a standalone DayRecord countdown linked to the container.

- Activity, Goal and Habit declare `semanticRelations.outgoing = ["relates_to"]` in the published LifeSpace contract. HomeMew stores **no** copied relation list or container-to-record foreign key.
- Outgoing create/delete uses the authorized Core `/spaces/{spaceId}/semantic-relations` routes; incoming browse remains read-only. Create/delete authority stays in LifeSpace, including source write and target read.
- Creating a related Task and creating an Activity countdown each use `POST /spaces/{spaceId}/models/batch` with `atomicConsistency: true`, a native record creation plus a source-container `relation_create` (request-local `clientRef`). Fail closed without orphan records. No HomeMew database, compensating orphan cleanup, or duplicated authority.
- Activity countdown is an ordinary `day_record` with `kind=countdown`, `anchorDate` defaulted to the activity's end date in the creation UI (editable by the user), and a separately editable name. It remains independently visible in 日子; unlink never deletes it. Countdown presentation derives calendar-day distance from the selected Space timezone, not UTC clock time.
- Only the active status tab is initially selected for Goal and Habit. The old 全部 tab is removed; all remaining lifecycle states are still reachable. LifeSpace Canonical Query filters `status=...` server-side so archived/ended history is not fetched and discarded on initial load.
- Container relation queries use bounded 50-item pagination, and search candidates use bounded Canonical Query search. The linked DayRecord countdown projections are capped to 12 record reads in a detail view to prevent unbounded fanout. The product page never issues a full-table distinct query.
- Web does not add Mini Program model wire dependencies: the reviewed Mini BFF contract remains intact. This PR is Web-only.
- Currently models `activity`, `goal`, `habit`, `day_record`, `task` must be published and authorized in the target LifeSpace environment. Cloudflare deployment stays a manual owner-controlled step.

## Follow-up / 后续

Tests should cover status default, relation CRUD UI integration, and atomic countdown / Task batch transport; typecheck and build gates remain required. Later review can add deep record navigation / inline creation for other types, but must not invent a HomeMew business data layer.
