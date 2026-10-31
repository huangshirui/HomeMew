# Decision: HomeMew Mini Program Foreground Revalidation Throttling

Date: 2026-10-31
Status: Accepted by user
Scope: Mini Program foreground / onShow network requests

## Context / 背景

The accepted global silent-refresh decision keeps the current screen visible, but the same page still fetches unnecessarily every time WeChat emits onShow (including phone unlock). Football detail and list pages had no edit-driven invalidation, so adding a 60s throttle without invalidation would return stale edits.

## Decision / 决策

1. Page-local SWR revalidation gate: already loaded content waits at least 60 seconds between automatic onShow requests. First load and deliberate refresh/retry/filter changes remain immediate. Pending or failed initial loads may retry automatically after 10 seconds.
2. A tiny in-memory monotonically increasing revision per UI domain bypasses the 60-second window after a successful local edit. Existing events/tasks/days/wishes markDirty also increments the revision. Football and Activity/Goal/Habit/Anniversary changes explicitly increment their domain revision after successful mutation.
3. Scope includes active family and relevant record ID / search / filter context. Family/identity switch must clear old data and reauthorize as required by the global silent-refresh decision.
4. Failed silent revalidation must keep rendered content and avoid disruptive toast messages. Explicit user refresh/retry bypasses the gate; user-triggered failure feedback is retained.
5. Keep existing one-minute polling in Home/Event/Task tab pages; do not introduce new timers, backend data stores or LifeSpace contracts. Gate metadata are process-local only.
6. Existing page generation guards remain responsible for stale responses and concurrent scope changes. Never treat the gate as data authority.

## Implementation / 落地

- Shared `services/refresh-policy.ts` with `AutoRefreshGate` and domain revision increments.
- Gated onShow calls in Football list/detail/manage, Activity/Goal/Habit/Anniversary list and detail, Event/Task/Day/Wish details.
- Revision increments on Football and domain edit/save/delete, and on existing events/tasks/days/wishes markDirty.
- Other low-frequency administrative screens and network aggregation are follow-up opportunities.

## Validation / 验收

- Regression tests cover 60-second unlock, edit invalidation, family/context switch, 10-second first-load retry.
- Mini test/typecheck/build and GitHub CI, plus WeChat physical-device testing before release.
