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
- LifeSpace Event production truth: still current split Calendar fields.
- HomeMew PR #77: stale reference / Draft only; not an implementation branch.
- Phase 4 non-production preparation: **allowed and now active**.
- Phase 4 production cutover: blocked until the reviewed Mini version is approved and production-active.

## Parallel workstreams during review

### A. LifeSpace Event migration preparation

Prepare on a fresh branch from current LifeSpace `main`:

1. re-read LifeSpace `AGENTS.md`, required architecture/contracts/model-definition docs and nearest nested `AGENTS.md`;
2. re-check `docs/canonical-query.md`, `docs/time-space-semantics.md` and LifeSpace #234;
3. define the exact compatibility-classified Event Model Definition revision using one authoritative `when: temporal_range` field;
4. define deterministic migration/backfill from:
   - timed: `startAt/endAt`;
   - all-day: `startDate/endDateExclusive`;
5. define what happens to `isAllDay`, start/end timezone metadata and Calendar capability bindings;
6. update generated contracts/runtime/migrations/tests together;
7. prove rollback/cutover safety without touching production;
8. validate in staging only if the staging change cannot leak into production.

### B. HomeMew BFF new-contract adapter preparation

Prepare on a fresh HomeMew branch from current `main`:

1. keep `/api/v1/miniprogram/families/{familyId}/events` stable;
2. keep Mini request/response DTOs unchanged;
3. preserve the existing old/new adapter seam in `apps/web/miniprogram-final-event-bff.mjs`;
4. adapt the new branch to the exact LifeSpace #234 contract once defined;
5. add equivalence fixtures proving old split Event and new TemporalRange Event produce the same stable Mini DTO;
6. add create/update/list/delete tests for both adapter modes;
7. do not deploy the new upstream mode to production during review.

### C. HomeMew Web new-contract preparation

Prepare Web changes on a non-production branch:

1. change Event resource typing from split Calendar truth to `when: TemporalRange`;
2. change list query to Canonical Query:
   - `when overlaps local_date_window`;
   - explicit `sort: when ASC`;
   - explicit `context.viewingTimezone`;
3. create/update Event using the canonical `when` value;
4. keep UI all-day/timed behavior unchanged;
5. add regression coverage for date-only, instant, timezone and half-open interval semantics;
6. do not merge/deploy a Web version that requires the new LifeSpace production contract before cutover.

## Re-evaluation of HomeMew PR #77

PR #77 should not be rebased wholesale.

Useful concepts that remain valid:

- Web Event list should use Canonical Query with `when overlaps local_date_window`;
- TemporalRange sorting requires `context.viewingTimezone`;
- Event writes should use one canonical `when` value after the LifeSpace cutover;
- Mini-facing Event DTO remains legacy/product-friendly and stable behind the BFF.

Parts that are stale relative to current `main`:

- it modifies the old `/spaces/{spaceId}/events` precursor BFF path, while the reviewed Mini now uses final `/families/{familyId}/events` routes;
- current `main` already has a stronger final Event adapter seam with `LIFESPACE_EVENT_CONTRACT` old/new mode support;
- Phase 1/2 introduced Service Bindings, user-to-Person mapping, final product DTOs and broader BFF architecture that #77 predates;
- Web and BFF tests must now target the final current architecture, not the pre-Phase-2 layout.

Therefore #77 is reference material only. Fresh Phase 4 branches should reimplement the still-correct pieces against current `main`.

## Production gate

Do not activate production cutover until all are true:

- [ ] Mini Program 1.6.3 review approved;
- [ ] approved version is production-active;
- [ ] LifeSpace Event migration/backfill tests pass;
- [ ] HomeMew BFF old/new equivalence tests pass;
- [ ] HomeMew Web new-contract tests/build pass;
- [ ] rolling cutover and rollback runbook is reviewed;
- [ ] production deploy order is explicit and reversible.

## Exact next actions

Work in parallel while review is in progress:

1. LifeSpace: create a fresh Phase 4 preparation branch and turn #234 into an executable migration implementation, starting with the exact Event Model Definition + storage/backfill compatibility plan.
2. HomeMew: create a fresh Phase 4 preparation branch from current `main`; do not build on #77.
3. Once the LifeSpace target Event contract is explicit, implement the HomeMew BFF new adapter and Web consumer against that target on their preparation branches.
4. Keep all runtime changes non-production until the production gate above opens.

At the end of each preparation session, update HomeMew #79 and LifeSpace #234 with branch/PR/test evidence and the exact next action.
