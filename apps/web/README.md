# HomeMew Web

HomeMew Web is the primary browser application for HomeMew. It is a LifeSpace client and HomeMew application-orchestration surface, not a second business Core.

## Current stack

```text
React 19
TypeScript
Vite
React Router (SPA / library mode)
Tailwind CSS
local shadcn/ui-style primitives
Lucide Icons

Cloudflare Vite Plugin
Cloudflare Workers + Static Assets
pnpm workspace
```

The foundation includes the responsive App Shell, Today and the real household routes. Do not introduce Next.js, SSR/RSC or another framework layer for the signed-in household app.

Keep dependencies demand-driven:

- add TanStack Query only when current React context/local-state patterns stop being sufficient;
- add Schedule-X only when a richer Calendar renderer materially improves the product;
- prefer URL state, React Context and local browser/UI state before adding Redux/Zustand or another global state library.

## Product routes

- `/` — Today / household overview
- `/calendar` — 月/周日历，家庭全域日程搜索，按参与成员/全天类型筛选，以及密集日期的完整日程查看
- `/tasks` — 未完成/已完成状态、任务搜索、按负责人和截止日期（逾期/今天/未来 7 天/无日期）组合筛选
- `/days`
- `/activities` — Activity 容器与家庭参与者
- `/goals` — Goal 目标和生命周期 Actions
- `/habits` — Habit 单人归属、Check-in 与历史
- `/anniversaries` — Anniversary 年度纪念日（日历中同时展示）
- `/football` — FootballMatch + FootballPerformance：记录／统计双入口；快捷按钮只预填统一表单，确认后才保存；参赛人员优先家庭成员，其他 Person 可搜索；Performance 需要在 LifeSpace Staging/Production 独立 Publish 并完成旧 FootballGoal 迁移后才能正式写入。
- `/wishes`
- `/family`
- `/settings`
- `/settings/integrations` — HomeMew External System (`ext_*`) summary list
- `/settings/integrations/:integrationId` — one External System's basic metadata plus Service Access, Agent Access and Event Push capabilities

Desktop uses a sidebar. Mobile uses bottom navigation. Tablet adapts within the same codebase. The visual direction is warm, calm and household-oriented rather than enterprise-admin/ERP styled.

Global family/Space context is selected through an unframed logo-style family identity at the top of the desktop sidebar (subtle hover/focus affordance). On mobile/tablet, all primary pages share a centered 20px title bar with a left-aligned **uploaded family Logo/name switcher** and optional compact right-side icon actions. The family switcher opens a contextual panel with full family names, the active family's real LifeSpace member avatars, and a Family Management link. Mobile member lists use those same avatar assets; failed images fall back to initials. Home shows its personalized greeting below the common bar. Nested detail screens use Back + centered detail title without a family selector, and the four full-width bottom tabs stay safe-area-aware. The month calendar uses a selected-day agenda rather than squeezing event titles into seven narrow columns. The desktop shell intentionally has no duplicate persistent horizontal header: business pages own their own heading and actions, and the user avatar sits in the sidebar footer. `/family` always operates on this selected family rather than exposing a separate selector. Page headings now use the single-line shared `PageHeader` (no separate decorative icon row or generic subtitle). Calendar and Tasks expose search/filter controls only on demand through a button adjacent to creation; the Calendar week view uses a timed, timezone-local seven-column layout with collision lanes and stable participant colors (mobile: date strip and a single-day time grid). Month empty-cell clicks create an event for that date, and edit modals lock underlying page scroll with auto-hiding narrow scrollbars. Family switching remounts family-scoped routed page state and protects member loads from out-of-order responses. See `docs/decisions/2026-10-19-web-global-family-navigation.md`.

`apps/display/` is a separate future household-display runtime and is not implemented as a mode inside the normal signed-in Web app.

External-system administration is intentionally Web-only. The Web-only product boundary remains recorded in `docs/decisions/2026-08-24-external-integrations-web-only.md`; the current capability-container semantics are authoritative in `docs/decisions/2026-10-09-external-system-capability-container.md`.

HomeMew onboarding is intentionally asymmetric across clients. The Mini Program is the base client and first-use/account-entry client; HomeMew Web is an advanced client for an existing HomeMew user. The accepted policy is recorded in `docs/decisions/2026-08-25-web-existing-user-link-only.md`.

## Cloudflare deployment model

One Cloudflare Worker deployment owns both the SPA assets and the thin same-origin BFF:

```text
Browser
  -> homemew.aisr.online
       -> Workers Static Assets -> React SPA
       -> /api/* and /health -> Worker BFF
```

The Worker hosts two deliberately separate application boundaries:

- the Web same-origin BFF, an authentication/session/application-orchestration boundary whose server-controlled Web client follows the current LifeSpace contract;
- explicit public Mini BFF product routes, a stable anti-corruption/release-lag contract for the reviewed Mini Program.

Both boundaries must not:

- create a HomeMew `/families/...` business contract;
- persist Spaces, events, tasks, day records, wishes or other household business truth;
- duplicate LifeSpace authorization/model validation;
- become another business Core.

HomeMew application metadata such as Family Catalog classification and External System `ext_*` containers belongs to `apps/backend/` Durable Objects and is reached from Web through the `HOMEMEW_BACKEND` Service Binding.

## Web code deployments / LifeSpace target

The existing Cloudflare Worker project, `homemew-web`, hosts both **Web Production** and a named **Web Preview** code version.

- **Web Production** serves `homemew.aisr.online` and always uses LifeSpace Production / `homemew-backend-production`.
- **Web Preview** is another code version under the same Worker project, with its own staging bindings/Secrets, and always uses LifeSpace Staging / `homemew-backend-staging`.
- The URL does not select environment. No `?env=staging`, no `/_stage/api/*` proxy, no per-page business switch. The unpublished `?env=staging` selector is not implemented: query parameters do not change the bound environment and no special notice is needed.
- Mini Program developer, trial and release builds always use the HomeMew production BFF; they never call Web Preview.
- Backend Workers and their independent Durable Objects remain deployed in both environments.

Previews Base settings are defined in `apps/web/wrangler.production.jsonc`, while the two required Preview secrets are set only on the named Preview. Before staging acceptance, protect the Preview host via Cloudflare Access and register its Access audience with the staging HomeMew Application.

Decision: `docs/decisions/2026-10-22-fixed-deployment-environments.md`.
Manual configuration and release runbook: `docs/runbooks/2026-10-22-web-preview-and-environment-routing.md`.

## Authentication boundary

Cloudflare Access is the long-term Web authentication and SSO layer. Authorization Code + PKCE is **not** the target LifeSpace browser architecture.

```text
Browser
  -> Cloudflare Access
  -> HomeMew Web Worker
       reads Cf-Access-Jwt-Assertion
       never trusts browser-supplied sub/email/userId
       -> LifeSpace Identity /internal/v1/access/* with server-only HomeMew lsa_*
       -> Identity independently verifies Access JWT + audience
       -> Identity resolves (iss, sub) -> global usr_*
       -> short-lived HomeMew-scoped LifeSpace user token
  -> signed host-only HttpOnly HomeMew session
  -> same-origin BFF -> LifeSpace Identity/Core
```

HomeMew Web never stores its own Access-subject -> `usr_*` mapping. That mapping belongs to LifeSpace Identity.

The BFF session is HMAC-authenticated with `WEB_SESSION_SECRET` and bound to a SHA-256 fingerprint of the current Access assertion. If the Access principal changes, the previous LifeSpace session is not reused.

State-changing BFF/proxy requests require an exact same-origin `Origin` header. Cookies, Access assertion headers and application credentials are never forwarded as arbitrary browser headers to Core/Identity; the BFF adds only the resolved LifeSpace user bearer.

## Implemented BFF routes

`worker.mjs` currently provides:

- `GET /health`
- `GET /api/session`
- `POST /api/session/logout`
- `POST /api/access/link-challenge`
- `/api/integrations*` bounded External System/capability orchestration
- `/api/lifespace/core/v1/*`
- `/api/lifespace/identity/v1/*`

An unknown Access principal is never silently merged by email and HomeMew Web does not create a new LifeSpace user. The only HomeMew Web onboarding path is **Link existing account**: Web creates a one-time link challenge and an already-authenticated HomeMew Mini Program confirms it as its current LifeSpace user.

Identity derives the target `usr_*`; Web never submits a target user ID. LifeSpace may retain Access registration as a platform capability for other applications, but HomeMew Web does not expose or proxy it.

### Existing-account linking UX

```text
HomeMew Web
  -> POST /api/access/link-challenge
  -> show alc_... one-time challenge

HomeMew Mini Program
  -> 我的 -> 设置 -> 关联 Web 登录
  -> paste alc_...
  -> POST LifeSpace Identity /api/v1/me/access-link-challenges/{challengeId}/confirm
     with the Mini Program's existing LifeSpace user bearer

HomeMew Web
  -> GET /api/session again
  -> same global usr_* session
```

The challenge is high-entropy, short-lived and single-use. The Mini Program never accepts or sends a target `userId`; the authenticated bearer is the only proof of which LifeSpace user is confirming the link.

Manual copy/paste is the initial confirmation UX. A later QR code or Mini Program deep-link may carry the same `challengeId`, but it must not weaken or replace the Identity challenge/confirmation contract.

If a person has never used HomeMew, the Web UI directs them to complete first use in the Mini Program and return to link the Web login. This avoids creating a second global LifeSpace user as a normal HomeMew onboarding outcome. Future LifeSpace user-merge capability remains a platform concern rather than a prerequisite for normal HomeMew Web onboarding.

## External System boundary

`/settings/integrations` is a low-frequency list of HomeMew-owned External System containers. Selecting one opens `/settings/integrations/:integrationId`.

An External System is **not** a LifeSpace Service Principal. Creating it records only application metadata:

```text
External System ext_*
├── display name / description
├── owning HomeMew family Space
├── Service Access (optional)
├── Agent Access (optional)
└── Event Push (optional)
```

HomeMew backend persists the `ext_*` container and optional `servicePrincipalId` / `agentId` references. It does not persist credential plaintext, LifeSpace user bearers, Data Grant copies, Webhook signing secrets or an effective-authority table. LifeSpace remains authoritative for all identities, credentials, Grants and Eventing resources.

Creating `ext_*` does not create any LifeSpace identity or authority. Capability creation is explicit and independent so an external system can use only what it needs.

### Service Access

Service Access is optional machine/service access:

```text
ext_*
  -> svc_*
      -> Service API Token or OAuth Client Credentials
      -> model-scoped family Data Grants
      -> LifeSpace Core
```

The UI exposes `none`, `read`, or `write` for `event`, `task`, and `day_record`. Stable service credential scopes remain `resources:read` / `resources:write`; effective authority remains the intersection of credential scope, Application × Model Access and current Data Grants.

One Service Access has one selected authentication mode and one active credential at steady state. Rotation is a controlled temporary exception: create the replacement, update and verify the external runtime, then complete by revoking old credentials; cancel revokes the candidate and keeps the previous credential.

Credential plaintext is returned once by LifeSpace and rendered only in current React/module memory. Service API Tokens and OAuth Client Secrets are never written to URLs, React Router history state, localStorage/sessionStorage, HomeMew storage, logs or analytics.

The detail page shows the selected family's LifeSpace Core Connection Base URL. Machine clients call LifeSpace Core directly with the service credential; they do not call the Cloudflare Access-protected HomeMew Web hostname.

Removing Service Access disables the Service Principal first, revokes active service credentials/current-family Data Grants, cleans Event Push endpoints bound to that Service Principal, and only then clears the `ext_*` reference. Agent Access is independent and is not removed.

### Agent Access

Agent Access is optional and independent from Service Access:

```text
ext_*
  -> agt_*
      -> lsp_agt_* Agent API credential
      -> optional direct model Data Grants
      -> direct Principal=Agent / Actor=Agent execution
      -> optional User Delegation for represented execution
```

The Agent API credential scope is a technical read/write ceiling. Direct model Data Grants determine what the Agent may do without user delegation; all direct permissions may be `none` when the Agent is intended to operate only through explicit User Delegation.

The External System catalog directly binds `ext_* -> agt_*`. Agent identity is not encoded inside a Service Principal description and creating Agent Access does not create a Service Principal.

Agent credential plaintext follows the same one-time/no-persistence rule. Removing Agent Access revokes current-family Agent Grants and active Agent API credentials before clearing `agentId`; Service Access and Event Push remain untouched.

### Event Push

Event Push is a separate HomeMew capability, but the current LifeSpace Eventing contract requires each Webhook Endpoint to reference a `subscriberServicePrincipalId` and re-check that Service Principal's current model-read authority before delivery.

Therefore HomeMew currently requires Service Access before Event Push can be configured. This dependency is explicit in the UI; HomeMew must not create a hidden Service Principal merely to make Webhook configuration appear independent.

The current product exposes one Webhook Endpoint per External System/Service Access pair: one callback URL, one signing secret, one endpoint-level enable/disable switch, one test action and one combined delivery history.

Under that Endpoint, `event` (日程) and `task` (待办) are selectable Event Subscription filters. Selecting a model does not create another Webhook or secret; it only attaches selected model/event types. Subscription filters grant no data authority. LifeSpace requires the subscriber Service Principal to retain current model-read authority and re-checks it before matching/delivery.

Webhook payloads remain reference-only and contain no full business record or actor identity. The external runtime uses its current Service Access to read full data when needed.

### Lifecycle and compatibility

External System `servicePrincipalId` and `agentId` binding changes use compare-and-swap semantics so concurrent capability setup/removal cannot silently overwrite a newer binding.

Capability setup is a cross-system Saga: HomeMew creates the required LifeSpace identity/resources, binds the resulting identity to `ext_*` only after successful setup, and compensates partial authority if binding fails.

The previous implementation where `svc_*` itself acted as the HomeMew External System ID is retained only as a bounded compatibility path for historical cleanup and old orchestration tests. New UI and new production setup use `ext_*` containers.

Future synchronization rules, notification channels, MCP configuration or similar system-specific capabilities should be added to the External System detail surface rather than becoming new top-level Settings entries.

## Required configuration

Server-only Worker secrets:

- `LIFESPACE_APPLICATION_CREDENTIAL` — trusted canonical **HomeMew Application** backend credential (`lsa_*`) used for Web Access exchange and integration orchestration;
- `WEB_SESSION_SECRET` — at least 32 characters.

`LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL` survives only as an internal compatibility alias populated from `LIFESPACE_APPLICATION_CREDENTIAL` by the HomeMew front door. It is **not** a separately provisioned production secret and must not be interpreted as another LifeSpace Application.

The canonical HomeMew LifeSpace Application must allow the management scope ceilings and Application × Model Access required by enabled HomeMew capabilities. The normal ambient Web session intentionally does not request elevated integration-management scopes; integration operations perform fresh privilege-on-demand Access exchanges and LifeSpace Core re-checks current Space authority.

Non-secret configuration:

- `ENVIRONMENT`
- `LIFESPACE_IDENTITY_URL`
- `LIFESPACE_CORE_URL`

Production Service Bindings:

- `HOMEMEW_BACKEND` -> `homemew-backend-production` for WeChat provider/login, activity, Family Catalog and External System application metadata;
- `LIFESPACE_CORE` -> `lifespace-core` for fixed Mini domain/media adapters;
- `LIFESPACE_IDENTITY` -> `lifespace-identity` for fixed Mini profile/avatar/access-link adapters.

The backend deployment must include the `EXTERNAL_SYSTEM_CATALOG` Durable Object binding before or together with a Web release that enables `ext_*` External Systems.

The public LifeSpace URL variables remain for the server-controlled Web session/integration BFF. Mini BFF adapters must use the fixed Service Bindings and must not fall back to those public URLs.

The Worker must sit behind the intended Cloudflare Access application. The original assertion comes from `Cf-Access-Jwt-Assertion`; browser JSON must never be accepted as an assertion source.

`/health` reports base `ready` and separate `integrationsReady`; `integrationsReady` requires both LifeSpace integration prerequisites and the `HOMEMEW_BACKEND` binding that owns the External System catalog.

## Production release

HomeMew Web has no dedicated staging environment after the accepted 2026-09-16 final-BFF decision. This does not remove LifeSpace staging or unrelated test environments.

The user-facing domain is:

```text
homemew.aisr.online
```

Since the accepted production cutover on 2026-08-24, that hostname is owned by `homemew-web`. Browser Web traffic remains behind Cloudflare Access. The exact Mini login route `POST /api/v1/login/wechat` uses its narrow Access bypass and delegates through the `HOMEMEW_BACKEND` Service Binding to `homemew-backend-production`. The stable Mini BFF surface uses only explicit routes, requires the LifeSpace user bearer where applicable, and delegates only to fixed internal operations.

Release path:

```text
repository tests / typecheck / build
-> CI
-> deploy HomeMew backend first when a new Durable Object migration is required
-> verify backend health/migration
-> deploy HomeMew Web
-> production smoke verification
```

Normal production deployment configuration intentionally does not claim or move the Custom Domain. Domain ownership transfer or rollback remains a separate confirmation-gated operation and must preserve all Mini routes.

## Tests and builds

```bash
pnpm dev:web
pnpm typecheck:web
pnpm build:web
pnpm test:web
pnpm check
```

`pnpm test:web` runs dependency-free Worker/BFF tests for the normal Access session boundary, legacy Service orchestration compatibility and the new External System capability-container boundary. It also asserts that HomeMew Web does not expose the LifeSpace Access registration flow.

The root check validates the active HomeMew application surfaces: backend syntax/tests, Mini Program tests/typecheck, and Web BFF tests/typecheck/build. The retired legacy HomeMew Core is not part of the active workspace.

## Fixed deployment targets / 固定环境

The same HomeMew Web Worker project has two independently deployed code versions: Production always binds the Production LifeSpace and HomeMew backend, and its protected Preview always binds Staging LifeSpace and the independent staging HomeMew backend. The environment is **not** chosen through the URL or client code. In particular, `?env=staging` was never released and requires no special warning or compatibility handling; an unrecognized query parameter is ignored.

Mini development/trial/release always use `https://homemew.aisr.online` and the Production Mini BFF. Staging-only Web testing happens on the protected Cloudflare Worker Preview URL, with its own staging credential and Web session secret.

See `docs/decisions/2026-10-22-fixed-deployment-environments.md` and `docs/runbooks/2026-10-22-web-preview-and-environment-routing.md`.

### 足球球队和赛事本机最近选择
Web 足球表单/筛选的球队、赛事支持最近使用候选。按登录用户、家庭 Space、模型存储最近 12 条（90 天）；× 仅删除本机缓存，不删记录。选择缓存需重新按 ID 验证 LifeSpace 权限；Web 与小程序不跨设备自动同步。缓存不定义业务目录。


### 足球管理边界（2026-10-23）

/football/manage 为球队与非家庭球员管理子页：球队使用 LifeSpace PersonGroup，球员使用 Space Person Directory（未绑定用户的 Person），不修改家庭成员 Person。赛事统一由 /activities 管理，足球页提供快捷导航；比赛中新建赛事只是搜索无结果后的快捷 Activity 创建，不提供独立活动目录。球队、赛事、球员搜索为空时，新建按钮携带输入词。统计页改版方案仍需 UX 确认。

### 足球统计看板（月度趋势）

总体显示参赛场次、进球、助攻、有效出场分钟及覆盖率。月度趋势为三视图：进攻场均进球/助攻、进攻每次进球/助攻分钟、防守场均抢断/拦截。图表按 YYYY-MM 自然月对齐，上方两条折线、下方每月参赛场次柱图；没有比赛时场均无定义且断线。没有做 90 分钟换算。分钟效率只计算所有已记录 appearance 片段有分钟值的场次，且进球/助攻必须来自**同批比赛**，缺失则显示“—”而非补零。未来若需要严格识别遗漏了整个片段的比赛，需引入用户明确的时间完整性确认，不能单靠当前记录自动推断。

### 足球比赛详情路由

点击比赛列表「记录」进入独立 `/football/:matchId` 详情页（按 ID 读取，可直接刷新），只展示比赛详情、家庭球员选择、快捷记录和已记录表现。搜索筛选、新建比赛、记录/统计主切换只出现在 /football 列表页面。返回按钮可回列表；通过临时、每用户和家庭隔离的 sessionStorage 状态保留最近一次列表筛选、搜索及滚动位置（30 分钟有效，不代表业务真相）。详情编辑及快捷表现记录不影响平台数据模型。

### 足球统计 · 胜率与月度趋势标签

总体指标：参赛场次、胜率、进球、助攻及已记录比赛时间。胜率以已填写双方比分的参赛场次为分母，只统计代表球队获胜的场次；平局和失利计入分母，缺少双方任一比分时不参与；无有效比分显示“—”，并显示“有比分 X/Y 场”。胜率不受时长缺失影响。专项趋势标签为「场均进攻／进攻效率／场均防守」，月度趋势和时间样本规则保持不变。

### 足球列表分页与球队成员管理（2026-10-24）

比赛列表每页读取 40 场，按日期倒序，底部使用“加载更多比赛”通过 LifeSpace Canonical Query cursor 追加，不在初次打开时读取全部。球队管理（PersonGroup）支持显示成员数，在“管理球员”/“编辑”弹窗中搜索选择家庭成员和其他 Space Person，新增或移除 `memberPersonIds` 并保存；从球队移除成员只修改球队名单，不会删除球员 Person 或历史比赛。已有球队成员按 ID 有界并发读取用于显示名称，不全量拉取人员目录。

### 足球管理搜索与筛选弹层布局

球队管理页使用搜索框直接筛选球队列表，不使用选择/指定球队组件。空搜索展示用户近期或比赛引用过的球队；输入至少两个字后调用 LifeSpace Canonical Query 查询匹配球队（320ms 防抖、每页 20 条、支持加载更多），不读取全量 PersonGroup 目录。足球比赛页“赛事／代表球队／对手球队”筛选候选以输入框下方的绝对定位浮层展示，弹出时不改变整行筛选器高度，支持点击外部/Escape 关闭；比赛表单里的同类 Picker 保留适合弹窗滚动容器的原有布局。

### 足球年份筛选 / 搜索框

球队管理的搜索框使用 `type="text" inputMode="search"` 和一枚清除按钮，避免浏览器内置搜索叉号与自定义 × 重复。足球比赛年份筛选默认仅显示当前年份及之前四年（每年自动滚动），支持「其他年份…」浮层输入任意有效四位年份（1900–9999）；选中值保留在下拉中，可选择「全部年份」清空。避免把最近一页比赛年份误当作完整年份列表，也不执行全表扫描或新增业务缓存。


## Explicit Web mailbox authorization rollout

Accepted decision: `docs/decisions/2026-10-25-miniprogram-2-navigation-email.md`. Identity 0.13/schema 12 owns authenticated Application-scoped mailbox consent and audit. Fixed Mini GET/PATCH `/api/v1/miniprogram/me/web-login` forwards to Identity; cached Web sessions revalidate via `/internal/v1/access/session-check`. No HomeMew mailbox persistence or email OTP. Release Identity Staging first, then Web Preview acceptance, then Identity Production and Web Production. Mini upload is separate. Tracking: HomeMew #153 / LifeSpace #408.
