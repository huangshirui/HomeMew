# Decision: FootballPerformance — one model, one action, one event

Date: 2026-10-23
Status: **Approved UX/model direction; platform rollout not started**

## User-corrected semantic granularity / 用户确认的唯一建模粒度

FootballMatch is unchanged and describes **one match**: event date, competition Activity, teams PersonGroup, scores, playerPersonIds and notes. One football performance record represents **exactly one individual action in that match**, never one player-match aggregate. This explicitly replaces the rejected proposal to keep both FootballGoal and FootballPlayerMatchStat as parallel permanent models.

The long-term individual-action model is **FootballPerformance** (`football_performance`), a single ordinary LifeSpace Model Definition:

| Field | Canonical DSL | Purpose |
| --- | --- | --- |
| matchId | required `record` targeting `football_match` | Match with which the action occurred |
| playerPersonId | required `person` | Space Person credited for this action |
| performanceType | required enum `goal, assist, tackle, interception` | Exactly one goal / assist / tackle / interception action |
| goalMethod | nullable enum `left_foot, right_foot, header, penalty, other, unknown` | Optional goal-only characteristic; not relevant for other types |
| notes | nullable text | Optional details; no required minute/video |

No `goals` or `assists` count fields. No independent `FootballPlayerMatchStat` model. No `assisterPersonId` field on the goal event. Add future action types by versioned extension to this model's enum, not by proliferating action-specific models.

The requested `penalty` option is represented as a `goalMethod` enum value in this release. **Trade-off:** a penalty may also be left- or right-footed, but one enum cannot express both simultaneously. If this overlapping distinction later matters, add a separate `isPenalty` boolean without changing historical event cardinality. The UI only displays goalMethod for performanceType=goal. The ordinary DSL by itself does **not** enforce a cross-field conditional rule; do not claim UI-only validation is Core authorization.

## End-to-end example / KK 比赛示例

A 4:1 match at 小闵超 vs 闵实验 has KK, 刘XX and 王XX in `FootballMatch.playerPersonIds`. KK's personal performance is four new `football_performance` records in the same match:

1. player KK, `performanceType=goal`, `goalMethod=left_foot`
2. player KK, `performanceType=goal`, `goalMethod=right_foot`
3. player KK, `performanceType=assist`, `goalMethod=null`
4. player KK, `performanceType=assist`, `goalMethod=null`

A later steal/interception is simply another action record. Participation itself stays on FootballMatch even when someone has no individual action records.

## UX / 交互

In a Match details page, select a tracked Person from a search-driven picker prioritizing family members; non-family Space People remain searchable but do not appear in the family player analytics dashboard. Show compact counters by action type for a selected player and clear one-tap "+ 进球/助攻/抢断/拦截" controls. For a goal, optionally choose left foot, right foot, header, penalty, other or unknown. Each tap creates one action event. Editing/deleting a mistaken event updates counts; no mutable aggregate columns. For rapid repeated input, show a clear sequence and provide immediate undo against the specific record, without issuing duplicate records from accidental rapid double-submits.

Page layout remains as separately requested: compact paginated match list on desktop, small mobile cards, common five match/stat filters (year, match type, representative team, opponent team, player), no match filters on team/competition management, and no technical model names in consumer UI. These complete UX changes are *not yet implemented* in Web PR #142.

## Statistics / 统计

For a selected **family member Person** in a selected set of matches:
- `appearances = count(distinct FootballMatch.id where playerPersonIds contains personId)` (including 0-performance games)
- `goals = count(FootballPerformance where personId and performanceType=goal and match is in selected matches)`
- `assists = count(... performanceType=assist ...)`
- `tackles = count(... performanceType=tackle ...)`
- `interceptions = count(... performanceType=interception ...)`
- `goalsPerMatch = goals / appearances`; `assistsPerMatch = assists / appearances` (2 decimal display; if appearances=0 show —).

These are **recorded-event counts**, not assertions that the family fully recorded each match; there is no event for a known zero, and missing action records cannot prove zero activity. Display a simple "根据已记录表现计算" qualification. No double-counting from old FootballGoal plus FootballPerformance, and no per-player totals inferred from team scores. Display full-match winning percentage only for a selected player who participated and whose match score is completed.

## Migration / 平台上线约束

`football_goal` may already be a published ordinary LifeSpace Model Definition and may contain user records. Model keys and historical contract versions must not be casually renamed in place. Preferred controlled approach:

1. Publish `football_performance` as the **one new target model** in LifeSpace Staging (after normal Registry validation and HomeMew Application × Model Access).
2. Audit pre-existing `football_goal` records in each environment; if any, migrate 1:1 to `football_performance` with `performanceType=goal`, `playerPersonId=scorerPersonId`, same match, method, notes. Use a stable migration mapping and idempotent execution to avoid losing or duplicating events; preserve original data until verified.
3. Switch the Web consumer to a **single** event source and validate the exact counts, lists, permissions, and no duplicate historical goals. Do not aggregate old and new records simultaneously.
4. After a validated transition, deprecate/retire `football_goal` (staging first, production only with separate approval). The goal is **one lasting performance model**, not two concurrent stores. If data migration is blocked, do not delete old records or claim the old model retired.

The Notion LifeSpace model board reflects this accepted direction, but it is **not** an official Registry publication and the repository platform authority remains LifeSpace. Web PR #142 currently carries this decision document, not the new football runtime implementation; its source still uses existing FootballGoal until a separately approved model rollout.
