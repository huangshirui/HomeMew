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
