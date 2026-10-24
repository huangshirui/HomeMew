# Decision: Web Activity / Anniversary UX 统一

Date: 2026-10-24
Status: Proposed; PR review and Preview acceptance required
Scope: HomeMew Web UI. LifeSpace contracts and business persistence unchanged.

## Accepted UX direction / UX 方向

- All new domain pages use the Calendar/Tasks compact PageHeader without generic subtitles. Activity, Goal, Habit and Anniversary share the same rule.
- Record Icons are optional presentation metadata. Anniversary no longer prepends a hardcoded gift emoji before the date. Missing icons display neutral model pictograms, not persisted defaults. All current Web icon-bearing record editors (Day, Event, Task, Wish, Activity, Goal, Habit, Anniversary, Football Team) use one shared icon/name row under one label, with 40px-tall icon control.
- Anniversary labels become 年, 月, 日. Year remains optional. The year +/- controls start at the current year if blank; later clicks increment/decrement. Blank year still means annual recurrence, not a current-year value.
- Activity list changes from per-item cards to compact full-width rows showing title, short description, dates, attendees and actions. Newest-created comes first by envelope createdAt DESC; each Canonical Query request loads 40 items and an opaque cursor loads more.
- Activity Search & Filter stays collapsed by default beside the New action, follows Calendar/Tasks patterns, and uses server-side search, attendee filter and date-state filters. Family IANA timezone determines local today. Partial date ranges are not guessed into current/upcoming/past; they remain under All.
- Activity detail leads with title, dates, people and description, followed by Important Days (countdowns) and Activity Plans (related tasks/events/records), avoiding platform jargon. Users can edit directly from this view; link/unlink and countdown/task creation reuse existing authorized LifeSpace Semantic Relations and atomic batch flows.

## Technical boundaries / 工程边界

- No new LifeSpace schema, migration, HomeMew database, BFF route or duplicated authorization.
- The LifeSpace canonical query contract explicitly permits createdAt sorting and cursor pagination; content filters remain platform-authorized.
- An optional presentation.icon is only sent when changed, never auto-created for an Anniversary.
- Scope is code + regression tests; production deployment requires a separate human release decision. Before that, verify Preview search/filter index support, date edges, pagination, icon layouts and activity modal behavior.


## 2026-10-24 · Container workspaces and current-first activity browse / 容器工作空间

Following user acceptance, Activity, Goal and Habit are full page workspaces with canonical deep links:

- `/activities/:recordId`, `/goals/:recordId`, `/habits/:recordId`. Each reads the requested record by ID under the selected Space and current user authority; refresh, browser navigation, viewer read-only access, and not-found/denied states must work. A details modal is no longer used for these containers.
- All three reuse a responsive title/description/member header, existing edit form and associated-record query. Activity has overview/calendar/tasks/more tabs and shortcuts for Create Event, Create Task, Countdown, existing links and manage attendees. Goal has overview/action plan/other related content. Habit has overview/related content with an inline paged check-in history and subject-only check-in, preserving the platform Habit policy.
- Quick Event and Task use the **complete existing Web editor components**, including optional icon, description, people, date/time/location for Event, and responsibility/due date for Task. An atomic LifeSpace native model batch writes the new record plus the source-owned relates_to edge; failure cannot leave an orphan record. Countdown reuses the previously accepted atomic DayRecord plus link path. Association never copies child data into container fields.
- The activity list defaults to **当前** rather than all/historical items, alongside **即将开始／已结束／全部**. In this iteration these are **derived date cohorts**, not fabricated lifecycle statuses: current is (startDate missing or <= family-local today) AND (endDate missing or >= today); upcoming has a future startDate; ended has an endDate before today. Records with incomplete dates remain visible in 全部 even if not classifiable. Current sorts by createdAt DESC; all cohorts use Canonical Query with a 40-item cursor and authorized server-side keyword/member filters.
- Important **unresolved platform capability**: Activity baseline has no status field or end/reopen actions. A date-less activity is assumed current for browsing; a completed-but-dateless activity cannot be intentionally moved to ended. A future explicit Activity lifecycle contract should be designed and approved in LifeSpace, **not simulated by HomeMew local state**, and this Web PR does not alter that model.
- Page overview metrics are limited to grounded projections of actual linked content/check-in readings. Task completion percentage is not claimed as Goal completion progress, and no fake dashboard or aggregate is materialized. Detail may fetch a bounded first page of semantic edges (50) and uses paging rather than reading the entire family catalog.
- Code scope stays HomeMew Web only; do not merge or deploy production before user Preview UX acceptance.

