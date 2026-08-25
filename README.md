# HomeMew 家事喵

HomeMew 是构建在 LifeSpace 平台之上的家庭事务应用。LifeSpace 是 Identity、Space/Data Grant、领域模型、权限、业务数据、契约和平台部署的唯一权威来源；HomeMew 负责家庭场景的产品体验、微信 provider 适配和 Web 应用边界。

## 当前架构

```text
WeChat Mini Program
  -> HomeMew Web front door
       -> /api/v1/login/wechat -> HomeMew Cloudflare backend
            -> WeChat jscode2session
            -> Durable Object: openid -> LifeSpace usr_*
            -> LifeSpace Identity trusted application exchange
  -> LifeSpace Identity / Core

HomeMew Web
  -> Cloudflare Access
  -> HomeMew Web Worker / same-origin BFF
       -> LifeSpace Identity Access principal exchange/linking
       -> LifeSpace Identity / Core
```

HomeMew 不再拥有独立的家庭业务 Core。`apps/core/` 仅保留为历史迁移/参考代码，不得继续新增业务行为。

## 目录

```text
apps/
  backend/      微信 provider 信任适配器；维护 openid -> LifeSpace usr_* 映射
  miniprogram/  微信小程序
  web/          HomeMew Web + same-origin BFF；Cloudflare Access 登录
  display/      未来独立家庭大屏
  core/         旧 HomeMew Core，仅用于历史/迁移参考
```

## 生产状态

HomeMew 生产业务数据已经完成一次性迁移并切换到 LifeSpace。当前权威业务数据位于 LifeSpace production；旧 HomeMew Core/D1 仅在稳定化和回滚证据窗口内冻结保留，不再作为正常写入源。

2026-08-24，HomeMew Web 已正式接管生产前门：

```text
homemew.aisr.online -> homemew-web-production
  -> Web / same-origin BFF -> auth.aisr.online / core.aisr.online
  -> POST /api/v1/login/wechat
       -> HOMEMEW_BACKEND Service Binding
       -> homemew-backend-production
       -> auth.aisr.online / core.aisr.online
```

生产 Web 根路径由 Cloudflare Access 保护；小程序登录路径使用精确 Access bypass，并继续由既有 `homemew-backend-production` 提供微信 provider 适配。最终 cutover 已通过 Web Access、Mini Program login、LifeSpace production runtime 与 Worker secret-binding 验证。

## Identity 边界

### Mini Program

微信 `openid` 是 HomeMew 应用自己的 provider identity，不进入 LifeSpace Identity。`apps/backend` 使用 SQLite-backed Durable Object 保存 `openid -> usr_*`，并使用 server-only `lsa_*` 向 LifeSpace Identity 换取短期用户 Token。

### Web

Cloudflare Access 是 HomeMew Web 的长期登录/SSO 层。HomeMew Web 不保存 `Access sub -> usr_*` 映射；它把原始 `Cf-Access-Jwt-Assertion` 交给 LifeSpace Identity 独立验证，由 Identity 负责 `(iss, sub) -> usr_*` 解析和账户链接。

Web BFF 使用独立的 HomeMew-Web `lsa_*`，不能复用 Mini Program application credential。LifeSpace user bearer 只保存在签名、host-only、HttpOnly 的短期应用 session 中，不暴露给浏览器 JavaScript。

## HomeMew Web 技术栈

当前 Web foundation 已采用：

```text
React 19
TypeScript
Vite
React Router（SPA / library mode）
Tailwind CSS
shadcn/ui 风格的本地基础组件
Lucide Icons

Cloudflare Vite Plugin
Cloudflare Workers + Static Assets
pnpm workspace
```

暂不引入 TanStack Query、Schedule-X、Redux/Zustand。TanStack Query 在真实 LifeSpace server-state 接入时再加；Schedule-X 仅在现有日历展示确实需要更丰富能力时再引入；全局状态优先 URL、Context 和浏览器本地 UI state。

不使用 Next.js / SSR。HomeMew 是登录后的家庭应用，SEO 价值有限，不承担 SSR/RSC/Server Actions 的额外维护复杂度。

首期产品路由：

```text
/
/calendar
/tasks
/days
/wishes
/family
/settings
/settings/integrations
```

Desktop 使用 Sidebar，Mobile 使用 Bottom Navigation；视觉保持家庭、温暖、轻量，不做企业 ERP/管理后台风格。

## Web BFF

同一个 Cloudflare 部署物同时承载 React SPA 与极薄 Worker：

```text
homemew.aisr.online
  = Workers Static Assets
  + /api/* same-origin session/API gateway
  + /api/v1/login/wechat provider pass-through
```

BFF 只负责 Access assertion、App Session、HttpOnly Cookie、Origin/CSRF 防护、凭据隔离和 LifeSpace 请求转发；不建立 `/families/...` 兼容 API，不保存家庭业务数据，也不复制 LifeSpace 授权逻辑。

生产已实现并验证 Access session exchange、existing-user link challenge、same-origin Core/Identity proxy、外部系统管理编排与微信登录 provider pass-through；HomeMew Web 不暴露 LifeSpace Access registration。

## LifeSpace 模型映射

| HomeMew | LifeSpace |
| --- | --- |
| family | `Space(kind=family)` |
| family admin | Space `owner` / `admin` |
| writable member | Space `editor` |
| member relation | Space Person |
| event | `event` + Calendar capability |
| task | `task` + Actions |
| day | `day_record` + Temporal capability |
| wish | `wish` + Actions |
| 喵一下 | Registry Creation Draft capability |

## 本地检查

要求 Node.js 24+，并使用仓库固定的 pnpm 版本。

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

Web 可单独运行：

```bash
corepack pnpm dev:web
corepack pnpm typecheck:web
corepack pnpm build:web
corepack pnpm test:web
```

## 开发前必读

- `AGENTS.md`
- `docs/architecture.md`
- `docs/product-rules.md`
- `docs/web-plan.md`
- `apps/web/README.md`
- 当前 LifeSpace 对应 contract / architecture（平台 API 与权限的唯一源码来源）
