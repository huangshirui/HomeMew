# 2026-10-08 · HomeMew Web 外部系统增加 Agent 接入

## 决策

HomeMew Web 的「外部系统」继续作为一个外部 Runtime / 系统的产品容器。在现有 Service Access 与 Event Push 之外，详情页新增可选的 **Agent Access**。

本次只修改 HomeMew Web，不修改微信小程序，也不扩展 LifeSpace Console。

一个 HomeMew 外部系统在本阶段最多绑定一个由 HomeMew integrations Application 创建的稳定 Agent Identity（`agt_*`）。Agent API Credential（`lsp_agt_*`）不是 Service `api_token` / `oauth_client_credentials` 的第三种 Credential Mode，而是独立的 Agent 身份凭据。

```text
External Integration
├─ Service Access
│  ├─ Service Principal
│  ├─ Service API Token
│  └─ OAuth Client Credentials
├─ Agent Access
│  ├─ Agent Identity (agt_*)
│  ├─ Agent API Token (lsp_agt_*)
│  └─ Current Family Space Direct Data Grants
└─ Event Push
   └─ Service Principal subscriber + Webhook Endpoint
```

## Agent Authority

Agent 支持两种独立执行语义：

```text
Direct Agent
lsp_agt_*
→ Principal=Agent / Actor=Agent
→ Agent 自己在当前 Space 的 Data Grant

User Delegation
lsp_agt_* + dlg_*
→ Principal=User / Actor=Agent
→ 运行时 Delegation Authority
```

因此 HomeMew 不要求 Agent 的每次操作都先获得用户授权。Agent 可以拥有长期 Direct Authority；只有需要借用某个 User Authority 时才走 Delegation。

## Credential Scope 与 Direct Data Grant 分离

Agent API Credential Scope 是技术能力上限；Agent Data Grant 是某个 Space 中的真实直接 Authority。两者不能混成一个设置。

HomeMew Web 暴露两层配置：

1. **Agent API 能力上限**：只读 / 读取 + 写入；映射到 `resources:read` 与 `resources:write` Credential Scope。
2. **当前家庭直接权限**：日程 / 待办 / 日子分别为无权限 / 只读 / 读写；映射到当前 Family Space 给 `agt_*` 的 model Data Grant。

Direct Data Grant 不得超过 Credential Scope。

Credential Scope 也不能只由 Direct Data Grant 自动推导：一个 Agent 可以在当前家庭只有只读 Direct Authority，但仍需要 `resources:write` Scope，以便未来在明确的 User Delegation 下执行写操作。

允许当前家庭所有 Direct Data Grant 都为「无权限」。这种 Agent 仍有稳定身份和 Agent API Token，但家庭数据访问必须依赖运行时 Delegation。

## Space 边界

HomeMew Web **只管理当前 Family Space** 对 Agent 的 Direct Data Grant。

它不提供跨 Space 权限选择，不列出其它家庭、ALOHA Personal Space 或其它 Space。一个 Agent 同时访问多个 Space 的统一管理属于 LifeSpace Console 的平台控制面，不进入 HomeMew Web。

Agent API Token 本身不绑定单个 Space；HomeMew 仍向外部 Runtime 提供当前家庭的 Space-bound Connection Base URL 作为接入体验。

## 管理权限

HomeMew Web 仍要求当前家庭的 Owner / Admin 进入外部系统管理界面，并在每次管理操作时通过当前用户会话向 LifeSpace 请求 `grants:manage`。真正的 Data Grant 创建、修改和撤销继续由 LifeSpace Core Authority 校验。

HomeMew integrations Application 的 `lsa_*` 只保存在 Web BFF，用于调用 Identity 的 Application-owned Agent Identity / Agent API Credential 生命周期接口，不发送给浏览器。

浏览器不允许提交任意 `agt_*` 进行绑定。Agent Identity 必须由 HomeMew BFF 创建，避免把其它 Agent 偷绑到当前外部系统。

## HomeMew ownership binding

现有外部系统以 Service Principal description 的 HomeMew 私有 marker 表达「此 Service Principal 由哪个 Family Space 的 HomeMew UI 管理」。为了在不建立第二份业务数据库的前提下持久化 Agent Access 归属，marker 升级为向后兼容的 v2：

```text
v1: homemew:v1:space=<spc_*>
v2: homemew:v2:space=<spc_*>;agent=<agt_*>
```

用户填写的说明仍在 marker 后单独保存；UI 不展示 marker。没有 Agent Access 时继续使用 v1。移除 Agent Access 后恢复为 v1。

v1 外部系统继续完全兼容，不需要数据迁移；只有创建 Agent Access 的记录才自然升级为 v2。

## Credential lifecycle

Agent API Token 明文只在 Identity 创建成功后的响应中出现一次。HomeMew Web：

- 不把明文写入 Durable Object、KV、D1、localStorage、sessionStorage、URL 或日志；
- 仅保存在当前 React 页面运行期；
- 遗失后只能重新签发；
- 轮换时允许旧 Token 与候选新 Token 暂时同时有效；
- 用户验证新 Token 后完成轮换并撤销旧 Token；
- 取消轮换只撤销本次候选 Token。

Agent Credential Scope 在单把 Credential 上遵守 LifeSpace 的 reduction-only 规则；HomeMew 如果需要扩大 Scope，统一通过签发新 Token + 轮换完成，不原地扩大旧 Credential。

## Creation / cleanup Saga

Agent Access 创建顺序：

1. 创建稳定 Agent Identity；
2. 创建当前 Family Space 的 Agent model Data Grants；
3. 签发 Agent API Token；
4. 将 Service Principal HomeMew binding 从 v1 更新为带 `agent=<agt_*>` 的 v2。

若中途失败，HomeMew 必须尽力撤销已经创建的当前 Space Agent Grants 和 Agent API Credentials，并恢复 Service Principal binding。

当前 LifeSpace Application self-service Agent API 没有删除 / 禁用稳定 Agent Identity 的能力，因此若 Agent Identity 已创建但后续 Saga 失败或用户后来移除 Agent Access，`agt_*` 可以作为**无 Credential、无当前家庭 Data Grant 的稳定历史身份**保留。HomeMew 不伪造删除语义。

对 Agent Credential 的不确定写入采用与 Service Credential 一样的安全策略：先记录已有 Credential ID；若创建请求发生 5xx / 传输不确定，重新列出并撤销无法恢复明文的新 Credential，再安全重试，避免存在用户拿不到明文但仍有效的秘密凭据。

## Remove / disable

「移除 Agent 接入」：

- 撤销该 Agent 的全部有效 Agent API Credential；
- 撤销该 Agent 在当前 Family Space 的全部 Data Grant；
- Service Principal HomeMew binding 从 v2 恢复 v1；
- 稳定 `agt_*` Identity 保留为无权限历史身份。

「禁用外部系统」在原有 Service cleanup 之外，也执行上述 Agent Credential + 当前家庭 Agent Grant cleanup。

## Webhook 保持不变

本次不修改 LifeSpace Eventing subscriber 模型。Webhook Endpoint / Subscription 继续绑定外部系统的 Service Principal；事件订阅不改为 Agent subscriber。

因此 Service Access、Agent Access、Event Push 在产品上属于同一个 External Integration，但底层身份与 Authority 语义保持独立。
