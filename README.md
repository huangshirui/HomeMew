# HomeMew 家事喵

HomeMew 是构建在 LifeSpace 平台之上的家庭事务应用。LifeSpace 是 Identity、Space/Data Grant、领域模型、权限、业务数据、契约和平台部署的唯一权威来源；HomeMew 负责家庭场景的产品体验、微信 provider 适配和 Web 应用边界。

## 当前架构

```text
WeChat Mini Program
  -> homemew.aisr.online
       -> /api/v1/login/wechat -> HomeMew provider backend
            -> WeChat jscode2session
            -> Durable Object: openid -> LifeSpace usr_*
            -> LifeSpace Identity trusted application exchange
       -> stable HomeMew Mini BFF contract
            -> fixed adapters
            -> LifeSpace Identity / Core Service Bindings

HomeMew Web
  -> Cloudflare Access
  -> HomeMew Web Worker / same-origin Web session BFF
       -> LifeSpace Identity Access principal exchange/linking
       -> current LifeSpace Identity / Core contract
```

HomeMew 不再拥有独立的家庭业务 Core。旧 HomeMew Core 已在 2026-08-26 从 active tree 退休；需要追溯旧实现、OpenAPI 或 migration 时使用 Git 历史，不再把历史 Core 作为当前工作区的一部分。

## 目录

```text
apps/
  backend/      微信 provider 信任适配器；维护 openid -> LifeSpace usr_* 映射
  miniprogram/  微信小程序
  web/          HomeMew Web + same-origin BFF；Cloudflare Access 登录
  display/      未来独立家庭大屏
```

## 生产状态

HomeMew 生产业务数据已经完成一次性迁移并切换到 LifeSpace。当前权威业务数据位于 LifeSpace production。仓库中的旧 HomeMew Core、Core Actions 和一次性迁移/切流工具已退出 active tree。

旧 HomeMew Worker/D1 等运行资源不因代码清理而自动删除；如果仍处于稳定化/回滚证据窗口，应保持冻结、只读，并在后续独立运维决策中确认观察期、回滚需求和删除顺序。

2026-08-24，HomeMew Web 已正式接管生产前门：

```text
homemew.aisr.online -> homemew-web-production
  -> Web / same-origin BFF -> auth.aisr.online / core.aisr.online
  -> POST /api/v1/login/wechat
       -> HOMEMEW_BACKEND Service Binding
       -> homemew-backend-production
       -> auth.aisr.online / core.aisr.online
```

生产 Web 根路径由 Cloudflare Access 保护；小程序登录路径使用精确 Access bypass，并继续由 `homemew-backend-production` 提供微信 provider 适配。日常 production workflow 只部署现有 Worker 配置，不重新执行 Custom Domain 切流或 Access provisioning。

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

同一生产 Worker 承载两类边界：Web same-origin BFF 负责 Access assertion、App Session、HttpOnly Cookie、Origin/CSRF 与浏览器凭据隔离；Mini BFF 提供稳定、显式的 HomeMew 产品路由并在内部适配当前 LifeSpace 契约。两者都不保存家庭业务数据、不复制 LifeSpace 授权逻辑，也不接受任意上游 URL/路径或提供通用模型代理。

当前已完成 Final Mini BFF 全量迁移与 LifeSpace Event `when: temporal_range` production cutover。Mini-facing 路由/DTO 保持稳定，BFF 只使用当前 LifeSpace Canonical Query + TemporalRange Event adapter；旧 Event precursor、split Calendar adapter 和 old/new selector 属于已退休兼容层。后续状态由 `docs/plans/2026-09-16-miniprogram-final-bff-rollout.md` 跟踪；HomeMew Web 不暴露 LifeSpace Access registration。

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
| 喵一下 | 当前下线；未来由 HomeMew BFF 承担有界草稿编排，确认后的领域记录仍写入 LifeSpace |

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
