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

## 2026-10-23 · 第二轮 Preview 列表/筛选/管理设计

- 按日程/待办页面既有标准，把「搜索与筛选」放在 PageHeader「新建比赛」旁，筛选区采用相同的白底浅色描边折叠面板。年份是下拉选项；比赛类型/赛事/代表球队/对手球队保留；球员只在顶部保留一个不换行的选择器，其选中 ID 同时驱动比赛列表和统计，不在筛选区重复。
- 足球顶栏「记录 / 统计」右侧提供「球队与赛事」入口，进入 `/football/manage` 独立子页（返回足球比赛）。管理列表可以新增、编辑名称/说明/图标、按 LifeSpace record version 删除；删除前对代表球队、对手球队、赛事所关联 FootballMatch 使用 bounded `contains` 查询检查，如有关联需先处理比赛。其他 LifeSpace 客户端仍可能关联同一通用模型，故需提醒跨模块删除风险，并保留 LifeSpace 自身授权及引用校验。
- 比赛记录改为紧凑响应式单行：日期/比赛性质、双方球队与比分、可选赛事、记录/编辑操作，保留 cursor 分页及真实模型引用。

### PersonGroup / Activity 类型枚举建议（仅提案，未获平台开发授权）

- **PersonGroup.type**: 建议 `team`（团队，包括足球队）、`class`（班级）、`organization`（组织）、`community`（社群/兴趣群体）、`other`（其他）。避免把 sports_team / work_team 按应用拆成同义枚举。不要使用 `family` 来表达 LifeSpace Space 的家庭分类，也不要让 type 成为授权身份或独立模型。足球球队筛选 `team`。
- **Activity.type**: 建议 `competition`（赛事）、`trip`（旅行）、`camp`（营地/集训）、`gathering`（聚会/集体活动）、`learning`（学习活动）、`other`（其他）。足球赛事筛选 `competition`；不要把一场 FootballMatch 自身作为 Activity。
- **过渡规则**: 两个字段均建议可空且非必填；历史记录保持 `null`，不强制推断分类。可在 Web 创建该业务对象时写默认 type，但必须等 LifeSpace 定义明确发布；发布前本 PR 不传未声明字段。是否需要把 type 设置为 filterable index、是否要限定通用模型的查询由平台另行审查，绝不在 HomeMew 自建影子索引。
- 这是一项跨 LifeSpace Baseline 的通用模型契约变更，只提供建议。应由用户确认选项后，在 LifeSpace 仓库按 AGENTS 及 compatible Registry 版本化流程单独实现，不能借 HomeMew 前端 PR 改写 Baseline。

## 2026-10-23 · 分类本意与自动补全（修正前述 Baseline.type 提案）

前述 PersonGroup.type=team/class/... 和 Activity.type=competition/trip/... 仅表示记录的客观类型，**不能可靠表达“属于 HomeMew 足球模块的球队/赛事目录”**；它们并不适合作为 HomeMew 的业务目录筛选依据。两组 Baseline type enum 提案 **暂缓**，未提交平台修改。

推荐优先设计由 HomeMew 定义语义、LifeSpace 持久化的用途/目录归属：例如在 LifeSpace 注册一个普通 HomeMewFootballReference 目录模型，用 `kind` 区分球队/赛事并指向 PersonGroup 或 Activity 的已有 ID。它是用途关系，不复刻队名、赛事名称、授权与业务记录。需要考虑引用去重、同一对象多业务归属、名称跨模型搜索时的 Join/索引能力；若将搜索置于目录模型，必须核查当前 Canonical Query 能否跨关联名称检索，不应假设已有。另一种轻量选择是 LifeSpace 通用多值命名空间用途标签（如 `homemew.football.team`），但需要先设计并发布通用模型元数据/查询能力。HomeMew Worker 本地数据库不能成为跨设备/Agent 的业务真相存储；仅可保存非权威 UI 最近选择等短期偏好。以上均未在本次变更中实施，需另行确认及经过平台审查。

**Web 自动补全立即交付（无需等目录模型）**：比赛表单的两支球队和赛事、五维筛选中的球队和赛事选择器改为共享的 FootballReferencePicker，利用 LifeSpace PersonGroup/Activity 已声明 `searchable: ["name","description"]`。展开时获取排序后的首 20 条；输入至少 2 字符且 320ms 防抖后发起 Canonical Query search，单次 limit=20，结果过多提示继续输入；已选 ID 不在当前候选列表时按 ID GET 精确读取，支持历史比赛。弹出结果保持在流式布局内，避免被 Modal 滚动容器裁剪。保留图标和快速新建入口。

**性能边界**：当前 Canonical Query search 使用 `LIKE '%term%'`，limit=20 只限制返回量，不保证底层读取是索引前缀扫描。加入最短输入与防抖减少调用数量，但未来较大数据集仍须由 LifeSpace 实现严格受索引约束的 prefix search/field suggestions，HomeMew 不进行任意无界查询、影子搜索索引或绕过授权。原对 PersonGroup/Activity 的启动 400 条全部读取已更改为各取前 50 条，管理页支持加载更多及通过输入精确定位任意已存在记录，已有比赛引用缺失名称按 Record ID 补齐；记录管理仍保留正式 LifeSpace 访问边界。

## 2026-10-23 · 本机最近选择缓存（Web 和小程序）

- 本次增加可清除的客户端 UI 最近选择，而非 PersonGroup/Activity 类型、授权或 LifeSpace 业务目录。按已验证用户 ID、家庭 Space ID、模型种类隔离；最多 12 条，90 天自动过期，重选置顶、去重。只保存引用 ID、显示名称和最近选择时间。Web、小程序各自保存到本机，不跨设备自动同步。
- Web 足球选择器展示最近选择，每项独立 × 移除本机缓存，不删除 LifeSpace 记录、不更改比赛关联。使用最近选择时先按 ID 从 LifeSpace 重新查询和验证权限，失效自动剔除；首次展示最近选择时不触发无筛选全集搜索。正常输入两个字符后继续用延迟的 Canonical Query 搜索；从比赛表单新建后自动选中的球队/赛事也记入最近。
- 小程序没有足球比赛页面，也没有相关稳定 Mini BFF 足球业务路由。本次先提供 native wx-storage 缓存工具和带 × 的可复用近期候选组件，暂不连接不存在的界面。未来小程序页面接入时，必须先通过明确的 HomeMew BFF 查询、校验被缓存引用，再提交实际选择，不能直接访问 LifeSpace Core 线协议。
- 本机缓存不能证明某个对象属于足球业务的正式目录；该目录依然需要后续经批准的 LifeSpace 业务关系或用途机制，不能用此缓存充当第二份权威业务库。


## 2026-10-23 · 赛事统一归 Activity、足球管理收敛到球队与球员、零结果快捷新建

- **活动/赛事**：足球模块不再提供独立「赛事目录管理」页面，不会在足球页初始化时枚举全部 Activity；页面将「赛事 → 活动」直接链接到 HomeMew 的 /activities 进行统一管理。比赛表单仍可查询整个 LifeSpace Activity 的可见名称，也可在搜索无结果时快捷创建最简 Activity 并自动回填赛事 ID，但这不是独立的赛事类型、业务目录或新模型。
- **球队/球员**：/football/manage 路由改为独立 FootballManagePage（球队、球员两栏），不再渲染活动列表。球队只从已记录比赛引用及当前浏览器最近使用记录中汇集，另可服务端搜索查找其它 PersonGroup；名称、图标、说明和删除继续使用 LifeSpace 记录 API。球员使用 LifeSpace Space Person Directory（/people），展示并编辑 `linkedUser=false` 且不是家庭成员 Person 的记录；支持名称搜索、分页、创建、乐观锁更新和条件性删除。受家庭成员身份关联的 Person 仍由家庭管理/身份生命周期维护；**创建球员不会创建家庭成员/用户**。对于已有 FootballMatch/FootballPerformance 引用的球员，客户端拒绝删除；其他跨业务引用仍依赖平台验证，不宣称此局部检查涵盖一切。
- **快捷创建**：FootballReferencePicker 的 `onCreate(name)` 只在输入至少两个字符、服务端查询成功返回零结果、无加载/错误时出现。比赛表单不再固定显示「＋新建球队/赛事」按钮；点击时搜索词直接填入相应新建表单，提交后自动回填比赛。FootballPersonPicker 同样在搜索无结果时显示「＋新建球员{name}」，预填 Space Person 名称，保存后加入当前参赛名单。主页面也提供「新建球员」和查找其他 Space Person 入口，选中人员可作为当前统计主体。
- **统计**：现有通用“指标 + 分组”作为详细分析保留；新版首页建议改成球员表现看板，先以已知数据展示出场、进球、助攻和时间趋势，提供进攻/防守/出场分区，明确事件不重复计数与缺失不等于零。此为 UX 建议，**本轮未更改统计口径或图表**，待用户确认。
- **发布边界**：全部为 HomeMew Web PR #142 的应用层变更，无 LifeSpace Baseline/DSL/权限变更。各项 Web Check 通过后仅可手动部署 Preview；不能宣称浏览器实际交互已验收。

## 2026-10-23 · 足球按月统计看板第一版（Web）

- 原指标/分组选择器替换为 **总体四项数字 + 月度专项趋势**。总体包括筛选范围内实际参赛场次、已记录进球数、已记录助攻数、有效比赛时长及有效场次覆盖 X/Y。
- 专项以自然月 YYYY-MM 分组，默认进攻场均（场均进球、助攻），还可切换进攻时间（平均每球分钟、平均每次助攻分钟）和防守场均（场均抢断、拦截）。三种视图共用一组月度轴；专项上方为两条同单位折线，下方固定每月参赛场次柱图，月份缺比赛显示 0 场且场均折线断开。无 90 分钟换算、无按比赛序号或滚动 5 场聚合。
- 严格**同批比赛**时间计算：只有在比赛参与名单内、至少一个 appearance 片段、并且**所有已记录** appearance 片段的 minutesPlayed 均为有效非负整数时，才把该场计入时间样本；同场多个片段时长相加。平均每球/助攻分钟 = 时间样本比赛的总已知时长 ÷ 这些**同一批比赛**的 goal/assist 事件数。没有时长或同批比赛没有对应事件，显示“—”，不以 0 或 90 分钟替代。全局出场时长仅累积时间样本比赛，展示覆盖比例。注意模型没有记录“应有片段数量”，无法自动证明某场未遗漏未录入的片段；UI/文档只承诺所有*已记录片段*的完整分钟有效。
- 场均次数仍为当月全部实际参赛场次中的已记录相应事件数 ÷ 当月参赛场次，包含无时间记录的比赛；不得用时间样本代替场均分母。没有比赛则场均为 null 而不是 0；尚未录入表现不可误称为真实 0。
- 复用现有 LifeSpace FootballMatch / FootballPerformance Canonical Query 筛选、权限和分页上限，不新增数据、模型字段、影子缓存或外部依赖；展示组件由 Web 内置 SVG 绘制，月份时间轴同步滚动，图表旁显示有效时长覆盖。新增纯聚合模块及回归测试验证无分钟、片段缺失、同一批时间样本、跨月空月份和其他球员过滤。
- 项目内代码属于 HomeMew Draft PR #142，需 Web CI / Preview 验收后再合并，未擅自部署生产。

## 2026-10-24 · 足球比赛列表：家庭球员选择、球队图标和赛事名称按需读取

- **全局球员上下文**：足球页右侧的球员切换只显示当前家庭成员（来自已验证的 HomeMew Family members / Space Person 映射），不再在主页面同时呈现“查找球员／新建球员”。这是**当前统计和快捷记录的家庭球员选择**；比赛编辑表单中的参赛球员仍可复用已有 Space Person 搜索和零结果创建，足球管理子页仍可维护未关联账户的其他球员，不能误将它们强行加入家庭。
- **比赛行展示**：双方球队都展示 PersonGroup presentation.icon；缺少自定义 icon 时使用统一的中性占位 Shield 图标，避免代表球队有图标而对手没有。比赛日期保持单行，正式比赛为琥珀色奖杯、友谊赛为蓝色握手图标，配合 tooltip/无障碍名称，移除单独占一行的“正式/友谊赛”文字。
- **赛事关联名称**：FootballMatch 只保存 `competitionActivityId`，比赛列表显示对应 Activity 的 `name`，禁止遍历通用 Activity 目录。对**当前已加载比赛**的非空关联活动 ID 去重，只为缺失且未尝试 ID 发起 `GET /spaces/{spaceId}/models/activity/records/{id}`；同页引用同一个活动只读一次，活动请求最多 4 并发；球队引用同样限制 4 并发。数据保存在当前页面内存、切换家庭时清除。手动刷新允许重新尝试曾经失败的 ID；失败/无读取权限时显示“赛事暂不可查看”，请求中显示“正在加载赛事…”，不能假装“关联赛事”是赛事真实名称，也不伪造 Activity 数据。 
- **性能边界**：这种做法成本随**当前页面的去重关联 ID 数**变化，而非当前家庭所有 Activity 总量。属于应用 UI 读取优化；若未来单页关联种类急剧增加，再评估平台正式批量 read 能力，HomeMew 不自建影子业务表。
- **验收**：新增 `football-reference-hydration.ts` 与回归测试（同赛事多场复用、最多 4 并发、部分失败不遮蔽成功），以及 Web UI 结构测试。代码在 HomeMew Draft PR #142，尚未合并/部署 Preview。

## 2026-10-24 · 比赛记录改为独立详情子页面

- **用户决策**：比赛列表「记录」必须进入独立详情路由，不是在列表页中切换内部 selected 区块，以免比赛搜索筛选、列表操作和主记录/统计 tab 残留在详情页。
- **Web 路由**：新增可直接打开/刷新/分享的 `/football/:matchId` 路由，复用既有足球交互逻辑但以 `isDetail` 显式渲染仅详情内容。详情页通过 LifeSpace `GET football_match/{matchId}` 按 ID 读取，有加载、失败及返回列表状态；不需要先访问/加载列表。比赛球员为家庭成员简洁下拉，其余显示比分、双方球队、快捷记录、出场片段/已记表现、删除与编辑。列表级「搜索与筛选」「新建比赛」「记录/统计 Tab」「球队球员管理」以及比赛列表仅在 /football 显示。
- **返回体验**：返回按钮和浏览器后退都回到 /football。浏览器 sessionStorage 临时保存本次用户与家庭隔离的列表 UI 状态（筛选、搜索、Tab、折叠状态、滚动 Y，30 分钟内有效、单次消费），属于非权威界面偏好，不存业务记录或权限。载入列表后尝试恢复滚动；列表更多分页未被存档，超出首批比赛时尽力恢复。切回列表清空之前详情的 `selected` 和表现查询，防止过滤条件继续隐藏。
- **保存行为**：从列表新建/编辑比赛后进入对应独立详情地址；从详情编辑仍停留详情并按 ID 刷新。详情删除比赛后返回列表；快捷表现记录在详情完成，仍需确认后保存。不改变 FootballMatch/FootballPerformance schema、Identity 或平台授权。
- **验证**：增加 `football-list-navigation.test.mjs` 及更新足球 UI 测试，覆盖深链、列表/详情隔离、缓存作用域/过期/失败、URL 直接加载、页面切换与赛事引用按需读取。仍位于 HomeMew Draft PR #142，等待 CI 与 Preview 验收后再合并。

## 2026-10-24 · 足球总体数据增加胜率与趋势 Tab 文案

- **总体数据新增「胜率」**：从当前统计筛选范围内、该球员在 `playerPersonIds` 的比赛出发，按比赛 ID 去重；仅比分两侧均为有效非负整数的比赛进入分母，`wins = representativeTeamScore > opponentTeamScore`，平局与失利计入分母但不计胜场。胜率 = 胜场 / 有比分场次。没有有效比分时为 `null`，页面显示“—”，有比分但无胜场显示 0%。卡片附注“有比分 X/Y 场”，提示缺比分覆盖率；不依赖 appearance 出场分钟记录，不按 90 分钟换算，不引入新的 LifeSpace 字段。
- **趋势 Tab 仅调整名称**：原「进攻场均／进攻时间／防守场均」改为「场均进攻／进攻效率／场均防守」，三种月度趋势的统计指标和时间同批场次规则不变。
- **发布及验证**：仅 HomeMew Web 层代码，处于 [PR #142](https://github.com/huangshirui/HomeMew/pull/142) Draft，未合并或部署；新增胜、平、负、缺比分、异常比分、人员过滤及重复比赛测试；CI 在最终提交后确认。
