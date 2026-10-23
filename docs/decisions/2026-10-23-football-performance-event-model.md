# Decision: FootballPerformance — one action or on-field segment per record

Date: 2026-10-23
Status: **Approved UX/model direction; platform rollout not started**

## User-corrected semantic granularity / 用户确认的唯一建模粒度

FootballMatch is unchanged and describes **one match**: event date, competition Activity, teams PersonGroup, scores, playerPersonIds and notes. One FootballPerformance record represents **exactly one individual action or one contiguous on-field playing segment** in that match, never a player-match aggregate. A player can legitimately have multiple appearance segments in one match after substitution/re-entry or a positional change. This explicitly replaces the rejected proposal to keep both FootballGoal and FootballPlayerMatchStat as parallel permanent models.

The long-term individual-action model is **FootballPerformance** (`football_performance`), a single ordinary LifeSpace Model Definition:

| Field | Canonical DSL | Purpose |
| --- | --- | --- |
| matchId | required `record` targeting `football_match` | Match with which the action occurred |
| playerPersonId | required `person` | Space Person credited for this action |
| performanceType | required enum `appearance` and 26 event kinds (full versioned enum in Notion JSON) | One on-field segment or one individual action, disciplinary event or highlight |
| goalMethod | nullable enum `left_foot, right_foot, header, penalty, other, unknown` | Optional goal-only characteristic; not relevant for other types |
| shotOutcome | nullable enum `on_target, off_target, blocked, woodwork, unknown` | Optional result for `shot` events only; scoring goals are already on-target shots |
| minutesPlayed | nullable integer >= 0 | Only for appearance: actual playing minutes **in this segment**, not total match minutes |
| position | nullable string (max 80) | Only for appearance: the position in this segment (e.g. 左边锋, 中前卫); pick from consistent suggestions |
| entryMode | nullable enum `starter, substitute, position_change` | Only for appearance: kickoff starter, substituted/re-entered from the bench, or continuous play with a position change |
| notes | nullable text | Optional details; no required action minute/video |

No `goals` or `assists` count fields. No independent `FootballPlayerMatchStat` model. No `assisterPersonId` field on the goal event. Add future action types by versioned extension to this model's enum, not by proliferating action-specific models.

The requested `penalty` option is represented as a `goalMethod` enum value in this release. **Trade-off:** a penalty may also be left- or right-footed, but one enum cannot express both simultaneously. If this overlapping distinction later matters, add a separate `isPenalty` boolean without changing historical event cardinality. The UI displays goalMethod for performanceType=goal, shotOutcome for performanceType=shot when published, and minutesPlayed / position / entryMode for performanceType=appearance. The ordinary DSL by itself does **not** enforce a cross-field conditional rule; do not claim UI-only validation is Core authorization.

## End-to-end example / KK 比赛示例

A 4:1 match at 小闵超 vs 闵实验 has KK, 刘XX and 王XX in `FootballMatch.playerPersonIds`. KK's personal performance is four new `football_performance` records in the same match:

1. player KK, `performanceType=goal`, `goalMethod=left_foot`
2. player KK, `performanceType=goal`, `goalMethod=right_foot`
3. player KK, `performanceType=assist`, `goalMethod=null`
4. player KK, `performanceType=assist`, `goalMethod=null`

A later tackle/interception is simply another action record. Participation itself stays on FootballMatch even when someone has no individual action records.

### Multiple appearance segments / 同一比赛允许多段出场

An `appearance` is **one continuous on-field spell in one position**. It is not one match appearance and is not constrained to one per (matchId, playerPersonId). Example: KK starts at left winger, plays 8 minutes, is substituted off, then later returns to play 12 minutes as central midfielder:

| Performance row | player | type | minutesPlayed | position | entryMode |
| --- | --- | --- | ---: | --- | --- |
| A | KK | appearance | 8 | 左边锋 | starter |
| B | KK | appearance | 12 | 中前卫 | substitute |

KK's **total minutes** = 8+12 = 20, **match appearances** = 1 distinct FootballMatch, **started** = yes (first spell with entryMode=starter). A position change **without leaving the field** also creates a new segment: second spell entryMode=position_change. Do not create a second match or equate two appearance rows with two match appearances.

Minutes are playing time per segment, not wall-clock time. A missing minutesPlayed is unknown, not 0; if any segment is missing its duration, the whole-match total is *partially known*, not an exact 20. A position may legitimately change without substitution; entryMode helps distinguish that from re-entry. The existing playerPersonIds roster remains the known set of match participants; don't force a separate appearance row for every teammate without tracking details.

There is **no pairwise uniqueness rule** for appearance. The UI should protect against accidental double-add and visually group the ordered segments, but duplicate time/position values are not automatically proof of duplicate records. At most one `starter` segment per player/match is a proposed semantic quality rule, **not a currently enforced LifeSpace uniqueness constraint**. Cross-record overlap and conditional fields are not currently enforced by ordinary DSL; validate/warn in UX and review if authoritative constraints become necessary.

## UX / 交互

In a Match details page, select a tracked Person from a search-driven picker prioritizing family members; non-family Space People remain searchable but do not appear in the family player analytics dashboard. Show compact counters by action type for a selected player and eight curated "+ 进球 / 助攻 / 射门 / 关键传球 / 成功过人 / 抢断 / 拦截 / 解围" controls. Separately show **出场片段** with optional number of minutes, position, and entry mode, supporting multiple ordered segments for the same player/match without treating them as duplicate data. For a goal, optionally choose left foot, right foot, header, penalty, other or unknown. A shortcut **only opens the same complete FootballPerformance form**, with match, player and performanceType preselected. The user may immediately press Confirm without optional details, or fill goal method / playing segment fields / notes first. **No action record is written until Confirm is clicked and the backend accepts it.** Editing/deleting an existing event updates counts; no mutable aggregate columns. For rapid repeated input, show a clear sequence and provide immediate undo against the specific record, without issuing duplicate records from accidental rapid double-submits.

Page layout remains as separately requested: compact paginated match list on desktop, small mobile cards, common five match/stat filters (year, match type, representative team, opponent team, player), no match filters on team/competition management, and no technical model names in consumer UI. The Web UI is implemented in draft PR #142, with runtime acceptance pending LifeSpace Staging schema publication.

## Entry and statistics UX: implementation agreement / 录入与统计实施决策

- HomeMew has two primary destinations: **记录** and **统计**. Teams and competitions are auxiliary management within Record, not a third tab. No separate in-match / after-match editing modes.
- Record defaults to the last selected household person (prefer KK by name only when no preference is saved), shows the chosen match context, and offers high-frequency **进球／助攻** plus other type shortcuts. Quick actions only open the same mobile Bottom Sheet / desktop Dialog with a preselected enum; the user must confirm to persist.
- Match participation is chosen through bounded Space Person Directory search prioritizing household members, instead of rendering every family member as a giant checkbox list. Record persistence requires the selected Person to be on the match's playerPersonIds roster; edit the match roster first when needed.
- Single-page match history uses server Canonical Query filters (year, type, tournament, representative team, opponent team, family player), date sort and bounded cursor pagination.
- Statistics first filters the match scope, then selects a metric (goal/assist/tackle/interception plus newly published enum types, per-match goals/assists, appearances, starter matches and known appearance minutes), and chooses a grouping (month/year/opponent/competition). Both summaries and charts derive from the same selected match subset.
- Published LifeSpace Semantic Detail `GET /spaces/{spaceId}/_discovery/models/football_performance` provides current enum `values` for performanceType, goalMethod and entryMode. New values become available in the generic type selector and count metric without hardcoding **after an independently published model version**. High-frequency shortcut buttons and localized display names still use HomeMew-curated mappings; special input fields, chart meanings, or Chinese labels for newly added values still require application work.
- Notion Schema JSON is a planning/delivery artifact and **does not publish** an active LifeSpace Model Definition. Console Staging publish, access, migration and Preview acceptance are required before enabling writes for real users.
- This first consumer uses an explicit bounded pagination ceiling; on overflow statistics fail closed with a narrower-filter prompt rather than silently showing partial totals. A fully scalable cross-match aggregate is a future **LifeSpace** capability, not client-side unlimited scanning or a HomeMew shadow database.

## Statistics / 统计

For a selected **family member Person** in a selected set of matches:
- `matchAppearances = count(distinct FootballMatch.id where playerPersonIds contains personId)` (including 0-performance games); do not count appearance segments as matches.
- `totalMinutesPlayed = sum(known minutesPlayed values for performanceType=appearance)`; display a partial-data indicator when any appearance segment has unknown minutes.
- `starts = count(distinct matches for which this player has a starter appearance segment)`; missing entryMode cannot infer not starting.
- `positionsPlayed = distinct recorded position values across appearance segments`, optionally with known minutes by position when completeness permits.
- `goals = count(FootballPerformance where personId and performanceType=goal and match is in selected matches)`
- `assists = count(... performanceType=assist ...)`
- `tackles = count(... performanceType=tackle ...)`
- `interceptions = count(... performanceType=interception ...)`
- `goalsPerMatch = goals / matchAppearances`; `assistsPerMatch = assists / matchAppearances` (2 decimal display; if matchAppearances=0 show —).

These are **recorded-event counts**, not assertions that the family fully recorded each match; there is no event for a known zero, and missing action records cannot prove zero activity. Display a simple "根据已记录表现计算" qualification. No double-counting from old FootballGoal plus FootballPerformance, and no per-player totals inferred from team scores. Display full-match winning percentage only for a selected player who participated and whose match score is completed.

## Migration / 平台上线约束

`football_goal` may already be a published ordinary LifeSpace Model Definition and may contain user records. Model keys and historical contract versions must not be casually renamed in place. Preferred controlled approach:

1. Publish `football_performance` as the **one new target model** in LifeSpace Staging (after normal Registry validation and HomeMew Application × Model Access).
2. Audit pre-existing `football_goal` records in each environment; if any, migrate 1:1 to `football_performance` with `performanceType=goal`, `playerPersonId=scorerPersonId`, same match, method, notes. Use a stable migration mapping and idempotent execution to avoid losing or duplicating events; preserve original data until verified.
3. Switch the Web consumer to a **single** event source and validate the exact counts, lists, permissions, and no duplicate historical goals. Do not aggregate old and new records simultaneously.
4. After a validated transition, deprecate/retire `football_goal` (staging first, production only with separate approval). The goal is **one lasting performance model**, not two concurrent stores. If data migration is blocked, do not delete old records or claim the old model retired.

The Notion LifeSpace model board reflects this accepted direction, but it is **not** an official Registry publication and the repository platform authority remains LifeSpace. Web PR #142 implements FootballPerformance runtime and its unified form, but requires Staging model publication, migration review and Preview testing before it can be released.

## 2026-10-23 follow-up: eight quick actions + extensible full picker / 快捷表单扩充

User-confirmed eight HomeMew quick actions, in order: `goal`, `assist`, `shot`, `key_pass`, `successful_dribble`, `tackle`, `interception`, `clearance`. All other published enum values, including GK events, discipline, highlights and `appearance`, remain selectable in the full generic form; appearance retains its own appearance-segment entry.

- **Source of valid values**: LifeSpace published `performanceType.values`. Notion board currently holds 27 planned values; only values present in the environment's published discovery are valid for submission. HomeMew owns localized labels and eight quick button placements.
- **Shot detail**: `shotOutcome` is optional, shown only for `performanceType=shot` and only if the current published schema offers the field. Legacy environments without the field never receive `shotOutcome` in the payload. Reset goal/shot/appearance-only fields when switching type, and clear irrelevant persisted fields during edits.
- **Count once**: one physical goal only needs a `goal` record; the Shot metric includes `goal` plus `shot`. One assist is counted within Key Pass, one `one_on_one_save` within Save. The record list keeps exact event types; derived metrics should not lead to duplicate events being written.
- **Product UX**: click opens the same full bottom sheet/dialog with the type preselected; the user may save without optional detail or choose a shot outcome and notes before confirmation. No new Core capability, database or business persistence added in HomeMew.
- **Release gate**: changes are in the existing draft Web PR #142; run tests/typecheck/build. Publishing the Notion draft does not publish a LifeSpace model, so staging/production writes require independently published `football_performance` schema, grants and reviewed historical goal transition. No automatic deployment.

## 2026-10-23 Preview feedback / 首轮真实环境回归

- The Staging Preview surfaced `matchId.eq is unsupported` *after* successfully saving a performance action. This is a read-side Canonical Query operator mismatch, not a failed write. `record` / `person` / `record_list` / `person_list` relation fields must use the authoritative `contains` operator, even for a single-valued relation. Updated match performance read, player performance analysis, and team/competition match filters; no unbounded local data scan and no LifeSpace runtime change.
- Restore the user-approved quick action pictograms ⚽ 👟 🎯 💡 ✨ 🛡️ ✂️ 🚀 with consistent light, neutral buttons. There is no semantic importance or selected state implied for goal/assist; avoid arbitrarily emphasizing those buttons with solid green. Show subtle per-type counts in each quick button instead of an extra duplicated row of count chips.
- Rename UI-only `appearance` from 出场片段 to **出场记录**, retaining one record per position-stable playing segment and the original `appearance` enum key. Put other published event types in a responsive expandable **更多表现** chooser, not a cramped inline label/select pair. The shortcut still opens the existing unified form and requires explicit save; no automatic writes.
- Keep performance load errors local to the event list; when a save succeeds but the subsequent read fails, the UI must not imply that the save itself failed. Preview end-to-end verification is required before main merge/production rollout.
