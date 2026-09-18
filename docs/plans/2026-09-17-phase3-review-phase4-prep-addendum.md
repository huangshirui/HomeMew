# Phase 3 Review + Phase 4 Preparation Addendum

Status: Completed  
Date: 2026-09-17  
Parent plan: `docs/plans/2026-09-16-miniprogram-final-bff-rollout.md`  
Accepted decision: `docs/decisions/2026-09-17-phase4-preparation-during-wechat-review.md`

> Historical execution record. Phase 4 completed successfully on 2026-09-18; the production cutover gate described below has been satisfied and is no longer active.

## Current state

- Phase 0: complete.
- Phase 1: complete.
- Phase 2: complete.
- Phase 3: complete — Mini Program 1.6.3 passed review and is production-active.
- Phase 4: **complete**.
- LifeSpace Event v6 / schema 41 / canonical time DSL: production verified.
- LifeSpace exact-SHA final chain: staging #93 -> APAC #16 -> production #25: all successful on `5b5f43ffdf7a34f429551bdaf50a02f4b9cb8bce`.
- HomeMew PR #99: merged to `main@0d472dc00d39a72b37ccb06b2fdbde197d63dbbe`.
- HomeMew Web production #9: successful.
- Mini 1.6.3 and HomeMew Web production smoke: successful.
- Mini-facing HomeMew BFF contract remained unchanged through the platform cutover.
- Temporary Phase 4 Web staging repository launchers/config/test: retired after successful production verification.
- Phase 5 compatibility cleanup may start from this completed production baseline.

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

All Phase 4 production gates were satisfied:

- [x] Mini Program 1.6.3 review approved;
- [x] approved version production-active;
- [x] LifeSpace Event migration/backfill tests passed;
- [x] LifeSpace Event v6 staging deployment and migration verification passed;
- [x] exact-SHA APAC performance gate passed;
- [x] LifeSpace production cutover and postflight verification passed;
- [x] HomeMew BFF old/new equivalence tests passed;
- [x] HomeMew Web new-contract tests/typecheck/build passed;
- [x] HomeMew Web production deployment passed;
- [x] Mini/Web production smoke passed.

## Exact next actions

Phase 4 has no remaining implementation or release action. Start Phase 5 only as cleanup of compatibility code that is no longer required by any active client; do not change the stable Mini-facing DTO solely for cleanup.

