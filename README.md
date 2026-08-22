# HomeMew 家事喵

HomeMew 是构建在 LifeSpace 平台之上的家庭事务应用。LifeSpace 是 Identity、Space/Data Grant、领域模型、权限、业务数据、契约和平台部署的唯一权威来源；HomeMew 负责家庭场景的产品体验、微信 provider 适配和 Web 应用边界。

## 当前架构

```text
WeChat Mini Program
  -> HomeMew Cloudflare backend
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
  core/         旧 HomeMew Core，仅用于历史/迁移参考
```

## 生产状态

HomeMew 生产业务数据已经完成一次性迁移并切换到 LifeSpace。当前权威业务数据位于 LifeSpace production；旧 HomeMew Core/D1 仅在稳定化和回滚证据窗口内冻结保留，不再作为正常写入源。

当前生产入口：

```text
homemew.aisr.online -> homemew-backend-production
                       -> auth.aisr.online
                       -> core.aisr.online
```

生产域名目前仍承载小程序 `/api/v1/login/wechat`。HomeMew Web 在独立 staging hostname 验证 Cloudflare Access + LifeSpace Identity 0.5.0 流程之前，不接管该生产域名。

## Identity 边界

### Mini Program

微信 `openid` 是 HomeMew 应用自己的 provider identity，不进入 LifeSpace Identity。`apps/backend` 使用 SQLite-backed Durable Object 保存 `openid -> usr_*`，并使用 server-only `lsa_*` 向 LifeSpace Identity 换取短期用户 Token。

小程序永远不能获得：

- 微信 `appsecret`；
- `openid` 映射存储；
- LifeSpace `lsa_*` application credential；
- service credentials / signing keys。

### Web

Cloudflare Access 是 HomeMew Web 的长期登录/SSO 层。HomeMew Web 不保存 `Access sub -> usr_*` 映射；它把原始 `Cf-Access-Jwt-Assertion` 交给 LifeSpace Identity 独立验证，由 Identity 负责 `(iss, sub) -> usr_*` 解析和账户链接。

Web BFF 使用独立的 HomeMew-Web `lsa_*`，不能复用 Mini Program application credential。LifeSpace user bearer 只保存在签名、host-only、HttpOnly 的短期应用 session 中，不暴露给浏览器 JavaScript。

## HomeMew Web

确认的长期技术路线是 React + TypeScript + Vite + Cloudflare Worker，并采用 same-origin BFF。

第一个 Web 切片先实现 Identity × Access 边界：

- Access session exchange；
- explicit new-user registration；
- one-time existing-account link challenge；
- same-origin LifeSpace Core/Identity proxy；
- Cookie session + exact Origin CSRF protection。

之后再接 React 页面。首期产品路由：

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

HomeMew 可以在 UI DTO 中保留 `familyId`、`assigneeIds` 等产品语言，但必须在客户端/BFF 边界显式映射到 LifeSpace contract；不能重新建立第二套后端领域模型。

## 本地检查

要求 Node.js 24+，并使用仓库固定的 pnpm 版本。

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

Web BFF 测试可单独运行：

```bash
corepack pnpm test:web
```

## 开发前必读

- `AGENTS.md`
- `docs/architecture.md`
- `docs/product-rules.md`
- `apps/web/README.md`（Web 工作）
- 当前 LifeSpace 对应 contract / architecture（平台 API 与权限的唯一源码来源）
