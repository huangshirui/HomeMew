# HomeMew Monorepo 与 Core 骨架设计

## 目标

建立一个面向 MVP 的轻量 monorepo，为 Core、网页大屏和微信小程序提供稳定目录边界。Core 必须能本地运行、测试并通过 Wrangler 部署到 Cloudflare Workers，使用 D1，并为未来各端、Agent 和其他系统提供一致的 HTTP API 基础。

## Monorepo 结构

- 使用 pnpm workspace，不引入 Turborepo。
- `apps/core` 包含可运行的 Cloudflare Worker API。
- `apps/web` 仅保留目录和说明，不选择前端框架。
- `apps/miniprogram` 仅保留目录和说明，不生成微信小程序工程。
- 根目录集中提供安装、开发、测试、类型检查和构建脚本；具体实现委托给 workspace package。
- 暂不创建没有实际消费者的共享 package。出现跨应用共享的 API 类型或工具后，再新增 `packages/*`。

## Core 架构与 API

- 使用 TypeScript、Hono、Cloudflare Workers 和 D1。
- `GET /health` 是不访问数据库的基础探活接口，成功时返回 `{ "data": { "status": "ok" } }`。
- `GET /api/v1/status` 验证 API 路由和 D1 绑定。它执行轻量查询；成功时返回服务状态和数据库可用状态。
- 后续业务 API 统一放在 `/api/v1/*`，本次不虚构业务资源。
- 成功响应统一为 `{ "data": ..., "meta"?: ... }`。
- 错误响应统一为 `{ "error": { "code": string, "message": string, "requestId": string } }`。
- 每个请求生成或沿用 `x-request-id`，在响应头返回，并用于错误追踪。
- 未匹配路由返回统一的 `404` 错误；未捕获异常返回不泄露内部细节的统一 `500` 错误。
- MVP 默认允许跨域调用，CORS 允许来源通过 Worker 环境变量配置；未配置时仅允许本地开发来源，不使用生产环境通配符。

## D1、配置与部署

- Worker 环境绑定名固定为 `DB`，TypeScript 环境类型显式声明该绑定。
- 首个 D1 migration 创建一个仅用于数据库初始化与连通性验证的 schema metadata 表，不引入业务表。
- Wrangler 配置包含 Worker 入口、兼容日期、D1 binding 和可替换的数据库标识占位说明；真实 Cloudflare database ID 不提交为伪值。
- 本地开发和测试使用 Wrangler/Cloudflare 官方测试运行时支持的本地 D1，不依赖线上资源。
- GitHub Actions 分为检查与部署：拉取请求和推送执行类型检查与测试；推送到 `main` 时，在检查通过且 secrets 可用后使用 Wrangler 部署 Core。
- 部署所需 secrets 明确记录为 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。D1 数据库创建及真实 ID 配置属于首次部署操作，不由初始 CI 自动创建。
- Cloudflare Pages 工作流暂不创建；网页大屏开发后由 Pages 直接绑定 GitHub 目录。

## 开发体验与文档

- 固定 pnpm 与 Node.js 版本范围，并提交 lockfile。
- 提供 `.env.example` 或 `.dev.vars.example`，只包含安全的示例配置。
- README 说明目录职责、安装、Core 本地运行、D1 migration、测试、部署和 GitHub secrets 配置。
- 各预留 app 的 README 明确当前状态，避免空目录无法被 Git 跟踪。

## 测试与验收

- 单元/集成测试覆盖 `/health`、D1 可用的 `/api/v1/status`、未知路由和未捕获异常响应。
- 验证所有响应结构及 `x-request-id` 行为。
- 验证本地 migration 可以应用，Core 类型检查、测试和构建全部通过。
- 验证根目录脚本能够正确调用 `apps/core` 的脚本。
- GitHub Actions 配置通过静态检查，且不会在拉取请求中触发生产部署。

## 明确不在本次范围内

- 网页大屏和微信小程序的框架、页面及构建配置。
- 具体业务数据模型、认证授权、Agent 专用协议、OpenAPI 文档生成。
- Cloudflare Pages 部署配置和线上 D1 资源的自动创建。
