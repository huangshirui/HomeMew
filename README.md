# HomeMew

HomeMew 是一个面向家庭场景的 monorepo。MVP 当前只实现 Core API 骨架，网页大屏和微信小程序保留目录，待产品需求明确后再选择框架。

## 目录

```text
apps/
  core/         Cloudflare Worker + Hono + D1 API
  web/          网页大屏预留目录（未来绑定 Cloudflare Pages）
  miniprogram/  微信小程序预留目录
```

项目使用 pnpm workspace，不包含 Turborepo，也暂不创建没有消费者的共享 package。

## 本地开发

要求 Node.js 24 或更高版本，并通过 Corepack 使用仓库指定的 pnpm 版本。

```powershell
corepack enable
corepack pnpm install
corepack pnpm --filter @homemew/core db:migrate:local
corepack pnpm dev
```

默认开发地址由 Wrangler 输出。可将 `apps/core/.dev.vars.example` 复制为 `apps/core/.dev.vars`，配置允许访问 Core 的浏览器来源。

常用命令：

```powershell
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
```

## Core API

- `GET /health`：不访问数据库的部署探活。
- `GET /api/v1/status`：验证 API 与 D1，并返回当前 schema 版本。

成功响应使用 `{ "data": ... }`，错误响应使用 `{ "error": { "code", "message", "requestId" } }`。Core 接受或生成 `x-request-id`，并在响应头中返回它。

详细配置与首次部署步骤见 [apps/core/README.md](apps/core/README.md)。

## 自动化

- `Core Check` 在 pull request 和推送到 `main` 时运行测试、类型检查和 dry-run 构建。
- `Deploy Core` 只在推送到 `main` 且 Core 相关路径变化时运行；先执行检查和远程 migration，再使用 Wrangler CLI 部署。
- 网页大屏尚未初始化，因此当前没有 Cloudflare Pages workflow。未来由 Pages 直接绑定 `apps/web`。
