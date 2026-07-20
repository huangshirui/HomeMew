# HomeMew Core

Core 是部署到 Cloudflare Workers 的 Hono API，使用 D1 binding `DB`。

## API 约定

```http
GET /health
GET /api/v1/status
```

`/health` 不查询 D1，适合负载均衡与部署探活。`/api/v1/status` 查询 `schema_metadata`，用于验证路由、D1 binding 和 migration。

业务接口统一添加到 `/api/v1/*`。成功响应使用 `{ "data": ... }`，错误响应使用 `{ "error": { "code", "message", "requestId" } }`。所有响应都包含 `x-request-id`。

## 本地 D1

```powershell
corepack pnpm --filter @homemew/core db:migrate:local
corepack pnpm --filter @homemew/core dev
```

测试会在本地 Workers 运行时中自动应用 `migrations/`，不会访问 Cloudflare 线上资源。

## 首次 Cloudflare 配置

登录 Cloudflare 并创建 D1：

```powershell
corepack pnpm --filter @homemew/core exec wrangler login
corepack pnpm --filter @homemew/core exec wrangler d1 create homemew-core
```

将命令返回的 `database_id` 写入 `wrangler.jsonc`，替换全零的本地占位 UUID。随后执行：

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
