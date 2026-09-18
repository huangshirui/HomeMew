# Phase 3 Review + Phase 4 Preparation Addendum

Status: Active addendum  
Date: 2026-09-17  
Parent plan: `docs/plans/2026-09-16-miniprogram-final-bff-rollout.md`  
Accepted decision: `docs/decisions/2026-09-17-phase4-preparation-during-wechat-review.md`

> This addendum supersedes only the parent plan's statements that Phase 4 engineering work must wait until WeChat approval. The production cutover gate remains unchanged.

## Current state

- Phase 0: complete.
- Phase 1: complete.
- Phase 2: complete.
- Mini Program 1.6.3 real-device verification: complete.
- Mini Program 1.6.3 WeChat submission: complete.
- WeChat review: **in progress**.
- Mini-facing HomeMew BFF contract: frozen for review.
- HomeMew PR #77: stale reference / Draft only; not an implementation branch.
- Phase 4 non-production preparation: **implementation complete on both LifeSpace and HomeMew branches; production cutover remains blocked**.
- Phase 4 production cutover: blocked until the reviewed Mini version is approved and production-active.

## 2026-09-18 review-window validation update

- LifeSpace canonical time DSL correction is merged to `main` via #255 (Core Kernel 0.36.0).
- LifeSpace Event v6 + canonical time DSL are combined in Draft PR #257 on `phase4/event-temporal-range-staging-candidate-2026-09-18`.
- LifeSpace staging deploy run #90 failed because it was dispatched from `main` (schema 40 expectation) while live staging was already schema 41. The deploy workflow is now hardened via #258 to reject any staging schema/contract downgrade **before** migration or Worker deployment.
- The next LifeSpace staging deploy must select the exact #257 branch, not `main`.
- HomeMew Web has a temporary Phase 4 release-candidate staging surface only for this review window. It is manual, branch-scoped, binds only to `homemew-backend-staging`, `lifespace-core-staging`, and `lifespace-identity-staging`, and uses `LIFESPACE_EVENT_CONTRACT=temporal_range`.
- This temporary surface does not restore a permanent HomeMew Web staging environment and must be removed after Phase 4 validation.

## LifeSpace Phase 4 preparation — completed and staging-validated

Branch: `phase4/event-temporal-range-prep-2026-09-17`  
Draft PR: LifeSpace #252  
Tracking: LifeSpace #234

Completed target state:

- Event v6 uses required `when: temporal_range` as the single persisted time truth;
- canonical Calendar Capability binds `rangeField: "when"`;
- historical split Calendar bindings remain interpretable only for historical published definitions;
- schema 41 / migration `0041_event_temporal_range.sql` deterministically backfills Event v5 to v6 and fails closed on unexpected/invalid source state;
- Canonical Query, Model Contract, Runtime Discovery and OpenAPI all expose the canonical TemporalRange model correctly;
- legacy compatibility tests use historical probes instead of requiring current `mdl_event` to retain split storage.

Evidence:

- LifeSpace `Check` run #1425: success;
- LifeSpace `Deploy staging` run #89 / run id `35223959131`: success;
- staging applied schema 41 / Event v5 -> v6 migration;
- staging DB convergence passed;
- HomeMew integration readiness passed;
- Kernel / Model Contract and proving-model regressions passed;
- Creation Draft Queue verification passed;
- real Eventing outbox / Queue / signed Webhook flow passed;
- disabled-subscriber Eventing security boundary passed;
- performance and candidate handoff evidence passed.

LifeSpace production remains untouched. PR #252 stays Draft until the production gate opens.

## HomeMew Phase 4 preparation — completed and CI-validated

Branch: `phase4/event-temporal-range-prep-2026-09-17`  
Draft PR: HomeMew #99  
Tracking: HomeMew #79

### Stable Mini BFF boundary

The submitted Mini Program contract is unchanged.

The current Event BFF already contained an internal `LIFESPACE_EVENT_CONTRACT` adapter seam. The Phase 4 branch prepares the production switch to `temporal_range` while preserving the stable Mini routes and DTOs.

The canonical internal adapter:

- lowers stable Mini calendar-window requests to LifeSpace Canonical Query;
- writes Event v6 `when` values;
- maps Event v6 responses back to the existing Mini DTO;
- preserves partial-update semantics by reading the current record and rewriting the complete TemporalRange when necessary.

`apps/web/wrangler.production.jsonc` on the Phase 4 branch is prepared with `LIFESPACE_EVENT_CONTRACT=temporal_range`, but that configuration is **not deployed** while review is in progress.

### HomeMew Web

Web Calendar and the Home page Event summary now consume LifeSpace Event v6 directly:

- Event typing uses `when: TemporalRange`;
- list queries use `POST .../records/query`;
- calendar windows use `when overlaps local_date_window`;
- ordering is explicit `when ASC`;
- `context.viewingTimezone` is explicit;
- create/update write canonical `when`;
- legacy Calendar GET range parameters are no longer used by current Web Event consumers.

Web timezone rule:

- LifeSpace persisted timed Event truth is the absolute `when.kind=instant` range;
- the selected family IANA timezone is Web viewing/editor context only;
- changing family timezone changes projection and does not rewrite Event instants;
- nullable timezone fields exposed by the stable Mini-facing DTO remain compatibility/presentation projection and are not LifeSpace Event truth.

Release guard:

- HomeMew LifeSpace Core minimum schema floor is prepared as `>= 41` for this cutover.

Evidence:

- HomeMew PR #99 is Draft and must not merge before the production gate;
- Web Check #124 passed after Event v6 consumer migration and TypeScript fixes;
- latest Web Check #125 on head `c57a7835f2ce0c52ddfe208e424d10da67b0f211` also passed;
- Web tests: 103/103 passed;
- Web TypeScript check: passed;
- Web build: passed;
- `docs/web-calendar.md` and `docs/product-rules.md` are aligned with Event v6 / TemporalRange semantics.

## Production gate

Do not activate production cutover until all are true:

- [ ] Mini Program 1.6.3 review approved;
- [ ] approved version is production-active;
- [x] LifeSpace Event migration/backfill tests pass;
- [x] LifeSpace Event v6 staging deployment and migration verification pass;
- [x] HomeMew BFF old/new equivalence tests pass;
- [x] HomeMew Web new-contract tests/typecheck/build pass;
- [ ] rolling cutover and rollback runbook is reviewed;
- [ ] production deploy order is explicit and reversible.

## Exact next actions

While WeChat review remains in progress:

1. Keep LifeSpace #252 and HomeMew #99 Draft; do not merge/deploy production.
2. Prepare and review the coordinated production cutover/rollback runbook. It must explicitly sequence LifeSpace schema 41/Event v6 and HomeMew BFF/Web activation without exposing a window where production HomeMew requires a contract production LifeSpace does not yet provide.
3. Define verification gates for production data count/integrity, Event CRUD/query, stable Mini DTO behavior, Web Calendar/Home behavior, Eventing and rollback decision points.
4. Continue monitoring WeChat review status externally; the production gate opens only after Mini 1.6.3 is approved and production-active.
5. Once the gate opens, rebase/recheck both Draft PRs against current `main`, rerun CI, execute the reviewed cutover runbook, then begin Phase 5 only after the new production path is verified stable.

At the end of each preparation/cutover session, update HomeMew #79 and LifeSpace #234 with branch/PR/test evidence and the exact next action.
