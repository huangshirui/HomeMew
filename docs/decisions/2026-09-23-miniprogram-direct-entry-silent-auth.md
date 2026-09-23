# 2026-09-23 · Mini Program direct entry + silent identity recovery

Status: Accepted / 已接受

## 背景 / Context

HomeMew Mini Program previously registered `pages/launch/launch` as the first page. Every cold start therefore showed a branded launch page and exposed internal initialization text such as “正在登录… / 正在加载家庭数据…”. Deep-link pages already had partial runtime bootstrap support, but token refresh, activity reporting and launch initialization still contained duplicated identity-recovery paths.

HomeMew 的用户身份恢复本质上是：短期 LifeSpace User Access Token 过期后，通过新的 `wx.login()` code 交给 HomeMew Backend，再由 Backend 使用服务端长期 Application Credential 向 LifeSpace 换取新的短期 User Token。Token 过期不是用户需要感知的“重新登录”。

## 决策 / Decision

1. 不再设置应用级 Logo / Launch 中转页；`pages/home/home` 成为默认页面。
2. 外部路径（分享、扫码、通知、企业微信菜单、直接页面路径）保持原目标页面，不先跳 Home。
3. 新增统一 `ensureAccessToken()`：所有调用共享一个 in-flight Promise，统一执行 `wx.login -> HomeMew Backend -> LifeSpace token exchange`。
4. `App.onShow` 负责跨页面入口协调：
   - 正常用户：不改导航，只并行准备 runtime；
   - 首次用户/资料未完成：进入资料设置；
   - 资料完成后：恢复进入小程序时的原始 path + query；
   - 禁用用户：进入专用禁用状态页。
5. Activity reporting 只依赖有效 Access Token，不再触发完整 user/family bootstrap。
6. Runtime bootstrap 并行加载 current user 与 accessible families，并与入口页面共享 single-flight。
7. GET 等安全重放请求允许在 401 后静默换票并自动重试一次；POST/PATCH/DELETE 等非幂等写请求不盲目自动重放。写请求收到 401 后可以先静默刷新凭证，再由用户明确重试。
8. 用户界面不展示“Token 过期 / 正在登录 / 重新登录”等基础设施语义。

## 用户体验 / UX

- 普通打开：直接看到首页框架与数据加载，不经过 Logo 页。
- 深链打开：直接看到目标业务页面框架，例如待办详情。
- Token 过期：后台静默换票，导航不变化。
- 首次使用：直接进入必要的资料设置，完成后回到原始入口。
- 网络失败：保留目标页面，由页面自己的错误/重试状态处理。
- 账号禁用：显示明确的账号不可用状态，而不是登录失败。

## 影响 / Consequences

- `pages/launch/launch` 从应用注册表与源码中退役。
- Auth、API、Activity、Media 共用同一套 token recovery。
- HomeMew 不新增 Refresh Token，也不把长期 LifeSpace Application Credential 暴露给 Mini Program。
- LifeSpace 的 Access Token TTL 可独立调整，不应改变 Mini Program 的用户可见导航和登录体验。
