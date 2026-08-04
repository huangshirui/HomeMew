# HomeMew Core

## Security and calendar contract

Core accepts HS256 bearer tokens with a maximum lifetime of one hour. Every token
must include `sub`, `type`, `iss=homemew-identity`, `aud`, `iat`, and `exp`.
User tokens use `type=user` and `aud=homemew-core`; internal service tokens use
`type=service`, `aud=homemew-core-internal`, and the `internal` scope.

Each family has an IANA `timezone`, defaulting to `Asia/Shanghai`. It is used as
the fallback viewing timezone and as the default display metadata for timed
event endpoints. Every concrete instant is stored and returned as canonical
RFC 3339 UTC; date-only event and task fields are never converted to UTC.

Core 是部署到 Cloudflare Workers 的 Hono API，使用 D1 binding `DB` 和 R2 binding `AVATARS`。

## API 约定

```http
GET /health
GET /api/v1/status
```

`/health` 不查询 D1，适合负载均衡与部署探活。`/api/v1/status` 查询 `schema_metadata`，用于验证路由、D1 binding 和 migration。

业务接口统一添加到 `/api/v1/*`。成功响应使用 `{ "data": ... }`，错误响应使用 `{ "error": { "code", "message", "requestId" } }`。所有响应都包含 `x-request-id`。

## 认证与身份边界

业务接口使用 HS256 Bearer JWT。普通用户 Token 的 `sub` 必须是 HomeMew 内部 `users.id`；内部用户创建接口还要求 `scope: internal`。Core 不接收或保存微信 `openid`、企业微信 `userid`，外部身份服务负责维护映射并签发 Token。

本地将 `.dev.vars.example` 复制为 `.dev.vars` 并更换 `JWT_SECRET`。生产环境使用：

```powershell
corepack pnpm --filter @homemew/core exec wrangler secret put JWT_SECRET
```

示例 claims：

```json
{ "sub": "usr_01JXYZ", "exp": 4102444800 }
{ "sub": "identity-service", "scope": "internal", "exp": 4102444800 }
```

## 第一版业务 API

- `GET|PATCH /api/v1/me`、`PUT /api/v1/me/avatar`、`GET /api/v1/me/families`
- `POST|GET|PATCH /api/v1/families[/{familyId}]`
- `GET|PATCH|DELETE /api/v1/families/{familyId}/members[/{userId}]`
- `POST /api/v1/families/{familyId}/leave`
- `POST|GET /api/v1/families/{familyId}/invites`
- `POST /api/v1/families/{familyId}/invites/{inviteId}/revoke`
- `GET /api/v1/family-invites/{code}`、`POST /api/v1/family-invites/{code}/join`
- `POST /api/v1/internal/users`

### 用户与家庭头像

用户和家庭头像由 Core 统一写入 R2。客户端不能通过普通资料 JSON 接口提交任意头像 URL。

```http
PUT /api/v1/me/avatar
Authorization: Bearer <user JWT>
Content-Type: multipart/form-data

file=<JPEG|PNG|WebP，最大 5 MB>
```

Core 使用对象路径：

```text
avatars/{userId}/{uuid}.{ext}
avatars/families/{familyId}/{uuid}.{ext}
```

D1 的 `users` 和 `families` 表只保存 `avatar_key`。相关 API 仍向客户端返回完整的 `avatarUrl`，地址由 `ASSETS_PUBLIC_URL` 和 `avatar_key` 拼接。客户端不应依赖或保存 R2 object key。家庭头像由 active admin 通过 `PUT /api/v1/families/{familyId}/avatar` 上传；创建家庭和普通家庭资料更新不接受 `avatarUrl`。

上传流程采用补偿顺序：先写入新 R2 对象，再更新 D1；D1 更新失败时删除新对象，成功后清理旧对象。

### 家庭日程

```http
GET    /api/v1/families/{familyId}/events
POST   /api/v1/families/{familyId}/events
GET    /api/v1/families/{familyId}/events/{eventId}
PATCH  /api/v1/families/{familyId}/events/{eventId}
DELETE /api/v1/families/{familyId}/events/{eventId}?version=2
```

定时日程使用规范 UTC `startAt/endAt`；可空的 `startTimezone/endTimezone` 只用于显示，不参与服务端计算。创建时省略某个端点时区会使用家庭时区，显式 `null` 则保留为空。全天日程使用 `startDate/endDateExclusive`，两类字段不能混用。列表必须传 `startDate/endDateExclusive`，可选 `timezone` 指定查看日历的时区，单次最大 366 天。

创建示例：

```json
{
  "summary": "足球训练",
  "startAt": "2026-07-25T08:00:00.000Z",
  "endAt": "2026-07-25T10:00:00.000Z",
  "isAllDay": false,
  "startTimezone": "Asia/Shanghai",
  "endTimezone": "Asia/Shanghai",
  "attendeeIds": ["usr_KK"],
  "location": "浦东足球公园"
}
```

### 家庭待办

```http
GET    /api/v1/families/{familyId}/tasks
POST   /api/v1/families/{familyId}/tasks
GET    /api/v1/families/{familyId}/tasks/{taskId}
PATCH  /api/v1/families/{familyId}/tasks/{taskId}
DELETE /api/v1/families/{familyId}/tasks/{taskId}?version=2
POST   /api/v1/families/{familyId}/tasks/{taskId}/complete
POST   /api/v1/families/{familyId}/tasks/{taskId}/reopen
```

`dueDate` 只接受 `YYYY-MM-DD` 或 `null`。列表默认只返回 `pending`，支持多个 `status`、`assigneeId=me`、`dueDateFrom`、`dueDateTo`、`includeNoDue`、四种 `sort`、`limit` 和不透明 `cursor`；按截止日期排序时无截止日期始终在最后。

所有日程和待办接口都要求当前 JWT 用户是目标家庭的 active 成员。指定的参与人或负责人也必须是该家庭的 active 成员。PATCH、DELETE、complete 和 reopen 使用客户端读到的 `version`；版本过期返回对应的 `*_VERSION_CONFLICT`。DELETE 是软删除，普通读取不会返回已删除记录。

### 日子

“日子”用于记录轻量的家庭时间状态，而不是复杂资产档案：

- `elapsed`：从最近一次发生或开始日期计算已经过去多少天，例如上次理发、开始健身。
- `countdown`：计算距离目标日期还有多少天；目标日期过去后仍保留并持续提醒，直到归档。
- `cycle`：记录最近一次处理日期和建议周期，例如换滤芯、宠物驱虫；Core 自动计算下一次到期日。

物品型号、费用、附件、车辆里程和维修项目不属于“日子”，后续由家庭物品领域承载。

#### API

```http
GET    /api/v1/families/{familyId}/day-records
POST   /api/v1/families/{familyId}/day-records
GET    /api/v1/families/{familyId}/day-records/{dayRecordId}
PATCH  /api/v1/families/{familyId}/day-records/{dayRecordId}
DELETE /api/v1/families/{familyId}/day-records/{dayRecordId}?version=3

GET    /api/v1/families/{familyId}/day-records/{dayRecordId}/occurrences
POST   /api/v1/families/{familyId}/day-records/{dayRecordId}/occurrences
POST   /api/v1/families/{familyId}/day-records/{dayRecordId}/archive
POST   /api/v1/families/{familyId}/day-records/{dayRecordId}/restore
```

创建示例：

```json
{
  "name": "清理滤水器",
  "kind": "cycle",
  "anchorDate": "2026-05-02",
  "cycleDays": 90,
  "attentionBeforeDays": 7,
  "subjectUserId": null
}
```

响应按 `kind` 使用判别联合，只返回该类型适用的字段。每条记录同时包含 `computed`：家庭时区下的 `today`、已过或剩余天数、状态、关注级别及 `isAttentionRequired`。cycle 还返回未截断的 `progressRatio` 和只读 `nextDueDate`。

日期和状态规则：

- 所有日期均为 `YYYY-MM-DD`，Core 先根据家庭 IANA 时区确定“今天”，再进行纯日期运算。
- elapsed/cycle 的初始 `anchorDate` 不能晚于今天；countdown 允许未来、当天或过去的目标日期。
- 创建 elapsed/cycle 时会原子写入一条 `initial` occurrence；countdown 没有 occurrence 历史。
- 新 occurrence 必须满足 `当前 anchorDate < occurredOn <= 今天`，成功后更新 anchor、cycle 下一到期日、actor 和 `version`。
- 提醒阈值显式传 `null` 可关闭提前提醒，但 countdown 当天/过期、cycle 到期/过期仍需关注。
- archived 记录只读，只允许查询、恢复或软删除。

列表默认查询 active 记录并按关注优先级排序，支持：

```http
GET /api/v1/families/{familyId}/day-records
  ?kind=elapsed,countdown,cycle
  &status=active
  &subjectUserId=me
  &attentionOnly=true
  &sort=attention
  &limit=20
  &cursor=...
```

其他排序为 `date_asc`、`date_desc`、`created_desc`、`updated_desc`。cursor 与筛选条件及家庭当天日期绑定，不能跨查询条件或跨家庭日期午夜复用。

所有 active 家庭成员均可读写日子。PATCH、DELETE、occurrence、archive 和 restore 使用客户端读到的 `version` 做乐观并发控制；DELETE 为软删除。`subjectUserId` 在创建或修改时必须是同一家庭的 active member，成员退出后历史引用仍保留。

外部系统复用相同 API，分别需要 `day-records:read` 和 `day-records:write`；write 权限必须同时包含 read。系统身份不能使用 `subjectUserId=me`。完整字段、响应结构和错误响应以 `apps/core/openapi.yaml` 为准。

### 许愿池

许愿池用于收集家庭成员自己的愿望，并让其他成员认领、帮助实现。它不是待办清单：认领只表达“我来帮你实现”，不会自动创建任务或负责人。

```http
GET    /api/v1/families/{familyId}/wishes
POST   /api/v1/families/{familyId}/wishes
GET    /api/v1/families/{familyId}/wishes/{wishId}
PATCH  /api/v1/families/{familyId}/wishes/{wishId}
DELETE /api/v1/families/{familyId}/wishes/{wishId}?version=3

POST   /api/v1/families/{familyId}/wishes/{wishId}/claim
POST   /api/v1/families/{familyId}/wishes/{wishId}/unclaim
POST   /api/v1/families/{familyId}/wishes/{wishId}/fulfill
POST   /api/v1/families/{familyId}/wishes/{wishId}/reopen
POST   /api/v1/families/{familyId}/wishes/{wishId}/archive
POST   /api/v1/families/{familyId}/wishes/{wishId}/restore
```

创建愿望时 owner 固定为当前登录成员，不能替其他人许愿：

```json
{
  "title": "一起去看海",
  "description": "找一个周末全家出发",
  "desiredDate": "2026-10-01"
}
```

愿望按 `open → claimed → fulfilled` 流转，也可以归档和恢复。一个愿望最多由一名其他家庭成员认领，认领人对全家公开；愿望本人可直接标记实现。只有愿望本人可以修改内容、重新打开、归档、恢复或软删除，认领人只能放弃自己的认领或标记实现。所有写操作均提交读取到的 `version`。

列表默认不含 archived，支持 `status`、`ownerUserId=me`、`claimantUserId=me`、`desiredFrom`、`desiredTo`、`sort`、`limit` 和 `cursor`。只有 active 家庭成员的用户身份可以访问；system 和 service 身份不能访问许愿池。成员退出或被移除时，其未完成认领会自动释放，但 owner 和实现人的历史引用继续保留。完整契约和错误响应以 `apps/core/openapi.yaml` 为准。

## AI creation draft configuration

`POST /api/v1/families/{familyId}/creation-drafts/interpret` is an ephemeral,
read-only gateway. It does not write D1 or create an event, task, day record, or
wish. This change does not select or hardcode a production model.

Configure these deployment variables:

- `AI_BASE_URL`: base URL of the OpenAI-compatible provider.
- `AI_MODEL`: provider model identifier. The checked-in default is deliberately
  blank, so the route fails closed with `AI_NOT_CONFIGURED` until an operator
  selects a model.
- `AI_PROMPT_APPENDIX`: optional deployment-specific guidance. It cannot
  override the built-in safety and schema instructions.

Store `AI_API_KEY` only as a Worker secret:

```powershell
corepack pnpm --filter @homemew/core exec wrangler secret put AI_API_KEY
```

The selected model must support strict JSON-schema structured output through
the provider's OpenAI-compatible chat-completions API. `AI_RATE_LIMITER` is
configured in `wrangler.jsonc` for 10 requests per user per 60 seconds. Because
`AI_API_KEY` is listed under `secrets.required`, a production deployment needs
that secret even while the blank `AI_MODEL` keeps interpretation disabled.

For local development, keep real credentials only in the ignored
`apps/core/.dev.vars` file, never in `.dev.vars.example`, source, shell history,
test fixtures, or commits. A local file may contain:

```dotenv
AI_BASE_URL=https://provider.example/v1
AI_MODEL=structured-output-capable-model
AI_PROMPT_APPENDIX=
AI_API_KEY=replace-locally
```

Do not log the API key, source household text, prompt appendix, member names,
provider request/response bodies, or returned drafts. Operational logs are
limited to request IDs, timing, result category, upstream status, and usage
counts.

Before production enablement:

1. Choose and validate a structured-output-capable model; set `AI_BASE_URL`,
   `AI_MODEL`, and any reviewed `AI_PROMPT_APPENDIX` as deployment variables.
2. Install `AI_API_KEY` with `wrangler secret put` and confirm the rate-limit
   binding is present.
3. Run the local gates:

   ```powershell
   corepack pnpm --filter @homemew/core contract
   corepack pnpm --filter @homemew/core typecheck
   corepack pnpm --filter @homemew/core build
   ```

4. After deployment, send an authenticated smoke request to the interpretation
   route with a non-production test phrase and verify `x-request-id` plus the
   `{ "data": ... }` envelope. The smoke test must stop at the returned draft;
   do not call a create endpoint.

   ```powershell
   $headers = @{ Authorization = "Bearer $env:HOMEMEW_USER_JWT" }
   $body = @{ text = "Dinner tomorrow at 19:00"; viewingTimezone = "Asia/Shanghai" } | ConvertTo-Json
   Invoke-WebRequest -Method Post -Uri "$env:HOMEMEW_CORE_URL/api/v1/families/fam_smoke/creation-drafts/interpret" -Headers $headers -ContentType "application/json" -Body $body
   ```

The gateway makes one provider attempt per request. Operators and clients must
not assume an automatic retry.

## 本地 D1 与 R2

```powershell
corepack pnpm --filter @homemew/core db:migrate:local
corepack pnpm --filter @homemew/core dev
```

测试会在本地 Workers 运行时中自动应用 `migrations/`，并使用 Miniflare 提供的本地 D1/R2，不会访问 Cloudflare 线上资源。

- `0003_create_event_task_schema.sql` 创建日程、参与人、待办和负责人表。
- `0004_user_avatar_key.sql` 删除用户任意头像 URL 字段并增加 `avatar_key`。
- `0006_family_avatar_key.sql` 删除家庭任意头像 URL 字段、增加 `avatar_key`，并将 schema version 更新为 `6`。
- `0008_unify_time_semantics.sql` 清空 Demo 业务数据并以规范 UTC 时间列重建 schema，将版本更新为 `8`。
- `0009_create_day_records.sql` 创建日子和 occurrence 历史表，将版本更新为 `9`。
- `0010_create_wishes.sql` 创建许愿池表，将版本更新为 `10`。

已有环境升级后必须在部署新版 Worker 前应用 migration。

## 首次 Cloudflare 配置

登录 Cloudflare 并创建 D1 和 R2：

```powershell
corepack pnpm --filter @homemew/core exec wrangler login
corepack pnpm --filter @homemew/core exec wrangler d1 create homemew-core
corepack pnpm --filter @homemew/core exec wrangler r2 bucket create homemew-assets
```

将 D1 命令返回的 `database_id` 写入 `wrangler.jsonc`。R2 bucket 通过以下 binding 提供给 Worker：

```jsonc
{
  "r2_buckets": [
    {
      "binding": "AVATARS",
      "bucket_name": "homemew-assets"
    }
  ]
}
```

为 `homemew-assets` 绑定公开自定义域名，并将其写入：

```jsonc
{
  "vars": {
    "ASSETS_PUBLIC_URL": "https://assets.example.com"
  }
}
```

正式部署前必须把示例域名替换成真实 HTTPS 域名。随后执行：

```powershell
corepack pnpm --filter @homemew/core db:migrate:remote
corepack pnpm --filter @homemew/core run deploy
```

## 外部系统接入

`0007_external_system_integrations.sql` 增加外部系统、家庭授权、凭证、OAuth
限流与统一 actor 审计字段，并将 schema version 更新为 `7`。家庭 active
admin 通过 `/api/v1/families/{familyId}/integrations` 管理外部系统。完整
Client Secret 或 API Token 只在创建响应中返回一次，Core 仅保存 SHA-256
哈希和显示尾缀。

OAuth 2.0 Client Credentials 示例：

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(<sys_id>:<hmw_cs_secret>)

grant_type=client_credentials&scope=events%3Aread%20tasks%3Aread
```

n8n 使用 OAuth2 API credential、Client Credentials、Header/Basic
authentication 和上述 Token URL。简单客户端也可以发送
`Authorization: Bearer hmw_pat_xxxxx`。

系统继续调用普通家庭、日程、待办和日子 API。权限为 `family:read`、
`events:read/write`、`tasks:read/write`、`day-records:read/write`。系统不是家庭成员，不能使用
`attendeeId=me`、`assigneeId=me` 或 `subjectUserId=me`。停用或删除系统、修改权限、吊销来源
凭证都会立即影响后续请求。

远程 migration 必须先于 Worker 部署。

## GitHub Actions

在 GitHub repository secrets 中配置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

没有这两个 secrets 时，部署 workflow 仍执行完整检查，但明确跳过远程 migration 和部署。

## CORS

环境变量 `CORS_ORIGINS` 接受逗号分隔的来源列表。未配置时只允许 `http://localhost:5173` 和 `http://127.0.0.1:5173`，生产环境不默认允许通配符来源。
