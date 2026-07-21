# HomeMew 日程与待办 API 设计

## 目标与范围

在现有 Cloudflare Workers、Hono、D1、JWT 用户与家庭模型上，实现家庭日程与待办第一版 API。所有资源属于一个家庭，所有访问均以 JWT 当前用户及目标家庭的 active membership 为权限边界。

第一版实现：

- 日程列表、创建、详情、修改和软删除。
- 待办列表、创建、详情、修改和软删除。
- 待办完成与重开。
- 参与人、负责人、乐观锁、筛选、排序和 cursor 分页。

第一版不实现日程取消/恢复、待办取消、跨家庭 `/me/events` 与 `/me/tasks` 聚合、重复日程、提醒、通知、附件、评论和其他需求中明确列为后续阶段的能力。数据库保留日程 `status` 的 `cancelled` 枚举和待办 `status` 的 `cancelled` 枚举，以兼容后续动作接口。

## 架构与模块边界

采用聚焦的领域模块，而不继续扩张现有 `business.ts`：

- `family-access.ts` 提供当前用户有效性、active 家庭成员和 active 成员集合校验，由现有业务和新模块复用。
- `events.ts` 负责日程 HTTP 路由、日程校验、查询、映射和事务边界。
- `tasks.ts` 负责待办 HTTP 路由、待办校验、查询、状态动作、映射和事务边界。
- `pagination.ts` 负责不透明 cursor 的编码、解码和通用参数校验。
- `business.ts` 继续承载现有用户、家庭、成员和邀请接口，但改用提取后的家庭权限助手；不在本次进行无关重构。

路由只从 JWT 上下文取得当前用户 ID，不接受客户端提供的操作者 ID。API 使用 camelCase，D1 使用 snake_case。成功与错误响应继续使用现有统一 envelope 和 request ID。

## 数据模型

新增一个 D1 migration，创建四张表：

- `events`：家庭、标题、说明、定时或全天时间、时区、地点、状态、创建/更新/删除审计和整数版本。
- `event_attendees`：日程与用户的多对多关系，`(event_id, user_id)` 唯一。
- `tasks`：家庭、标题、说明、截止日期、状态、完成/创建/更新/删除审计和整数版本。
- `task_assignees`：待办与用户的多对多关系，`(task_id, user_id)` 唯一。

外键引用现有 `families` 和 `users`。数据库通过 `CHECK` 约束保证状态枚举、正版本、日程时间形态互斥与基本起止顺序。应用层负责 IANA 时区、完整日期格式和家庭 active 成员等跨记录校验。

ID 使用既有随机 ID 生成器，前缀为 `evt_` 和 `tsk_`。关联表不需要对外 ID，使用联合主键。按家庭、状态、开始时间/日期、截止日期、软删除字段和关联用户建立需求中指定的索引。

## 认证、授权与成员资料

每个接口依次验证：

1. JWT 有效且对应 active 用户。
2. 当前用户是路径中家庭的 active 成员。
3. 请求指定的参与人或负责人均为该家庭的 active 成员。

首版所有 active 家庭成员均可查看、创建、修改、删除、完成或重开资源，不限制为创建者或负责人。资源查询始终同时使用资源 ID、路径中的 family ID 和 `deleted_at IS NULL`，防止跨家庭枚举。

创建或更新时，只接受 active 成员作为参与人/负责人，并拒绝重复 ID。历史记录可保留已移除成员的关联行；响应中的人员详情数组仅连接当前 active family membership 和有效用户，因此已移除成员不会返回完整资料。

## 日程行为

定时日程要求 `start` 和 `end` 是带显式 UTC offset 的 RFC 3339 日期时间，写入 D1 前规范化为 UTC ISO 字符串，同时保留有效 IANA `timezone`。全天日程要求严格的 `YYYY-MM-DD`，并使用不包含结束日期的 `[start, end)` 语义。

两种形态互斥：定时日程只写 `start_at/end_at`，全天日程只写 `start_date/end_date`。结束必须晚于开始。切换 `isAllDay` 时必须同时提供匹配新形态的 `start` 和 `end`；普通 PATCH 对合并后的完整记录重新校验。

列表范围使用 `[start, end)`，返回与查询范围重叠的记录：定时与全天分别使用 `event.start < query.end AND event.end > query.start`。`start` 和 `end` 必须成对出现；未提供时使用当前 `Asia/Shanghai` 日历日期前 7 天至后 30 天，最大跨度为 366 天。默认仅返回 `active` 且未软删除记录，按规范化开始值和 ID 升序稳定排序。

`attendeeId=me` 转换为 JWT `sub`。其他 attendee ID 必须是目标家庭的 active 成员，避免通过筛选参数探测外部用户。

创建主记录和参与人使用一个 D1 batch。PATCH 中主记录的条件版本更新与可选参与人完整替换使用一个 batch；未传 `attendeeIds` 时保留原关联。DELETE 要求 query 中的 version，并通过条件更新设置删除审计及版本加一。

## 待办行为

待办名称去除首尾空格后为 1 至 100 字符，说明最多 5000 字符。`due` 只能是 `null` 或严格的 `YYYY-MM-DD`，不接受日期时间。

列表默认 `status=pending`，支持逗号分隔的 `pending,completed,cancelled`，以及 `assigneeId`、`dueFrom`、`dueTo`、`includeNoDue`、`sort`、`limit` 和 `cursor`。`assigneeId=me` 转换为 JWT `sub`；其他负责人 ID 必须是家庭 active 成员。`dueFrom` 为包含边界，`dueTo` 为包含边界；传入日期范围时，`includeNoDue=true` 才包含无截止日期记录。

排序支持 `due_asc`、`due_desc`、`created_desc` 和 `updated_desc`。due 排序中无截止日期始终排在有日期记录之后，并以 ID 作为最终稳定排序键。

创建主记录和负责人使用一个 D1 batch。PATCH 不允许直接修改状态；`assigneeIds` 出现时完整替换，`due: null` 清除截止日期。完成和重开使用显式动作接口并要求 version：完成写入当前时间和当前用户，重开清除完成审计。重复状态动作返回需求指定的 `TASK_ALREADY_*` 错误。DELETE 使用软删除和条件版本更新。

## 并发、事务与错误

所有变更接口使用乐观锁。更新语句包含 `WHERE version = ? AND deleted_at IS NULL`，成功后 `version = version + 1`。若资源在同一家庭中不存在或已删除，返回 `*_NOT_FOUND`；若资源存在但版本不同，返回 `*_VERSION_CONFLICT`。这一判定不泄露其他家庭资源。

D1 batch 用于必须共同成功的主记录与关联记录写入。创建、关联人完整替换、状态动作和软删除在服务返回前完成；任何语句失败时整个 batch 回滚。

沿用需求错误码：日程时间、日期、时区、参与人及版本错误映射为 400、404 或 409；待办日期、负责人、状态与版本错误同理。格式无效或 cursor 无法解码返回 `INVALID_REQUEST`。认证和家庭权限继续返回 `UNAUTHORIZED`、`USER_NOT_FOUND` 或 `FORBIDDEN`。

## 分页与返回结构

列表默认 `limit=100`，最大为 100。cursor 是 URL-safe base64 编码的版本化 JSON，包含资源类型、当前排序、最后一条记录的排序值和 ID。服务端验证 cursor 与当前查询排序一致；客户端不能把 cursor 当作权限或任意 SQL 输入。

查询获取 `limit + 1` 条记录：存在额外记录时根据第 `limit` 条生成 `nextCursor`。人员、创建者、更新者和完成人资料通过批量查询装配，避免每个列表项逐条查询。详情与列表使用相同的完整 DTO；列表不另设精简 DTO。

日程响应将 UTC 存储值按记录的 IANA 时区格式化为带 offset 的 RFC 3339 字符串；全天日期原样返回。待办数据库 `due_date` 映射为 API 的 `due`。

## 测试策略

严格按 TDD 增量实现，并使用 Cloudflare Workers Vitest 与真实本地 D1：

1. migration、约束、索引和 ID 前缀。
2. 通用成员权限、输入校验和 cursor。
3. 日程创建、详情、时间形态、参与人和事务。
4. 日程更新、版本冲突、软删除、重叠筛选和分页。
5. 待办创建、详情、负责人和事务。
6. 待办更新、完成、重开、版本冲突和软删除。
7. 待办筛选、排序、无截止日期行为和分页。
8. 现有用户、家庭和邀请回归测试。

每项行为先添加能因缺失能力而正确失败的测试，再写最小实现使其通过。完成后运行根目录测试、类型检查、Wrangler dry-run 构建和 `git diff --check`。

## 文档与验收

更新 Core README 和根 README，记录 migration、首版 endpoint、时间/日期语义、version 要求、筛选和示例请求。

验收条件：

- 首版约定的 12 个 CRUD 路由及待办 complete/reopen 均可用。
- 所有资源和人员访问均受 active 家庭成员边界保护。
- 定时、全天、截止日期、范围重叠、排序和分页语义符合本设计。
- 创建与关联写入原子完成，更新与删除不能静默覆盖新版本。
- 软删除记录不会从正常读取接口返回。
- 现有用户、家庭、成员和邀请接口保持兼容。
- 测试、类型检查、dry-run 构建和差异检查通过。
