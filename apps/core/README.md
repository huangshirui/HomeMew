# HomeMew Core

## Security and calendar contract

Core accepts HS256 bearer tokens with a maximum lifetime of one hour. Every token
must include `sub`, `type`, `iss=homemew-identity`, `aud`, `iat`, and `exp`.
User tokens use `type=user` and `aud=homemew-core`; internal service tokens use
`type=service`, `aud=homemew-core-internal`, and the `internal` scope.

Each family has an IANA `timezone`, defaulting to `Asia/Shanghai`. Date-only
`start` and `end` values on event list queries are interpreted as midnight in
the family's timezone.

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

定时日程的 `start`、`end` 必须包含 UTC offset；Core 以 UTC 保存并按记录的 IANA `timezone` 返回。全天日程使用严格的 `YYYY-MM-DD`，结束日期不包含在日程内。列表的 `start/end` 范围采用 `[start, end)` 重叠查询，必须成对传入，单次最大 366 天；支持 `attendeeId=me`、`status`、`limit` 和不透明 `cursor`。

创建示例：

```json
{
  "summary": "足球训练",
  "start": "2026-07-25T16:00:00+08:00",
  "end": "2026-07-25T18:00:00+08:00",
  "isAllDay": false,
  "timezone": "Asia/Shanghai",
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

`due` 只接受 `YYYY-MM-DD` 或 `null`。列表默认只返回 `pending`，支持多个 `status`、`assigneeId=me`、`dueFrom`、`dueTo`、`includeNoDue`、四种 `sort`、`limit` 和不透明 `cursor`；按截止日期排序时无截止日期始终在最后。

所有日程和待办接口都要求当前 JWT 用户是目标家庭的 active 成员。指定的参与人或负责人也必须是该家庭的 active 成员。PATCH、DELETE、complete 和 reopen 使用客户端读到的 `version`；版本过期返回对应的 `*_VERSION_CONFLICT`。DELETE 是软删除，普通读取不会返回已删除记录。

## 本地 D1 与 R2

```powershell
corepack pnpm --filter @homemew/core db:migrate:local
corepack pnpm --filter @homemew/core dev
```

测试会在本地 Workers 运行时中自动应用 `migrations/`，并使用 Miniflare 提供的本地 D1/R2，不会访问 Cloudflare 线上资源。

- `0003_create_event_task_schema.sql` 创建日程、参与人、待办和负责人表。
- `0004_user_avatar_key.sql` 删除用户任意头像 URL 字段并增加 `avatar_key`。
- `0006_family_avatar_key.sql` 删除家庭任意头像 URL 字段、增加 `avatar_key`，并将 schema version 更新为 `6`。

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

远程 migration 必须先于 Worker 部署。

## GitHub Actions

在 GitHub repository secrets 中配置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

没有这两个 secrets 时，部署 workflow 仍执行完整检查，但明确跳过远程 migration 和部署。

## CORS

环境变量 `CORS_ORIGINS` 接受逗号分隔的来源列表。未配置时只允许 `http://localhost:5173` 和 `http://127.0.0.1:5173`，生产环境不默认允许通配符来源。
