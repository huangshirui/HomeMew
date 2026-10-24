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


## 2026-10-24 · 关联内容可读名称与生命周期操作防误触

- **关联显示**：LifeSpace Semantic Relations 查询继续显式请求 `hydrate=target|source`，直接使用服务端按当前授权投影的 `targetRecord` / `sourceRecord` 中 `name`、Event `summary` 等可读字段；这些字段优先于 `targetLabel` / `sourceLabel`（某些模型的 referenceLabel 会回退 `rec_*`），不要把内部 Record ID 当面向家庭用户的内容标题。若目标记录没有可读名称，显式呈现「名称暂不可用」而不是伪造名称。活动、目标、习惯可深链到其具体子页，其余模型仅能进入对应列表（不假装直接打开记录）。继续使用 50 条关系分页；不增加按全家庭目录回查或影子名称缓存。
- **状态与操作区分**：Goal/Habit 列表和详情使用非交互状态标签展示「进行中／已暂停／已达成／已放弃／已结束」。生命周期变更（暂停、恢复、达成、放弃、结束、重新开始）全部收在「···」操作菜单，经过明确二次确认，必要时以危险色标注，避免误触；原有 LifeSpace Actions、版本校验、授权不变。日常「今天打卡」是频繁、正向的主操作，不藏入菜单，仍仅对习惯所属人可用。记录编辑可以经菜单或活动详情页的独立编辑入口进入。
- **验证**：在 PR #143 内更新 UX 和回归测试，Preview 需验证关联 Event/DayRecord 标题不显示 ID、可访问对象的清晰链接、状态菜单展开/关闭/确认/取消以及只读权限。无 LifeSpace schema 变更。
