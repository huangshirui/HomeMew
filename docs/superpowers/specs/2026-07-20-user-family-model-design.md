# HomeMew 用户与家庭模型设计

## 目标与范围

在现有 Cloudflare Workers、Hono 和 D1 Core 骨架上实现 HomeMew 第一版用户与家庭领域。Core 仅识别内部用户 ID，不保存或解析微信 `openid`、企业微信 `userid` 等外部身份。

第一版实现以下 API，沿用现有 `/api/v1` 前缀：

- `GET /me`
- `PATCH /me`
- `GET /me/families`
- `POST /families`
- `GET /families/{familyId}`
- `PATCH /families/{familyId}`
- `GET /families/{familyId}/members`
- `PATCH /families/{familyId}/members/{userId}`
- `DELETE /families/{familyId}/members/{userId}`
- `POST /families/{familyId}/leave`
- `POST /families/{familyId}/invites`
- `GET /families/{familyId}/invites`
- `POST /families/{familyId}/invites/{inviteId}/revoke`
- `GET /family-invites/{code}`
- `POST /family-invites/{code}/join`
- `POST /internal/users`

`POST /internal/users/resolve`、家庭归档、物理删除、所有权转移、复杂邀请审批、加入申请、自定义权限和多家庭身份档案不在第一版范围内。

## 架构与模块边界

采用分层领域服务设计，而不是在 Hono 路由中直接混合 SQL、认证和业务规则：

- 认证模块验证 JWT，并向请求上下文提供内部用户 ID 和授权范围。
- 用户、家庭、成员和邀请路由只负责 HTTP 输入输出。
- 对应领域服务负责权限、状态转换、数量限制和事务边界。
- D1 repository 负责持久化查询与记录映射。
- 统一错误类型映射到既有 `{ "error": { "code", "message", "requestId" } }` 响应。

每个模块保持单一职责，路由不接受请求参数中的“当前用户 ID”，所有当前用户身份都来自已验证 Token。

## 认证与授权

Core 使用 HS256 JWT。签名密钥通过 Cloudflare Worker Secret 提供，不写入仓库或普通环境变量示例值。

- 普通用户 Token 必须包含非空字符串 `sub`，值为 HomeMew `users.id`。
- `POST /api/v1/internal/users` 必须额外包含 `scope: internal`。
- Token 缺失、格式无效、签名错误、过期或必要 claim 缺失时返回 `UNAUTHORIZED`。
- 普通用户访问内部接口时返回 `FORBIDDEN`。
- 已认证但不存在的用户返回 `USER_NOT_FOUND`。
- `disabled` 用户不能访问普通业务接口。

JWT 不携带微信身份字段。外部身份服务首次调用内部接口创建用户，之后签发以 HomeMew 用户 ID 为 `sub` 的 Token。

## 数据模型

新增 D1 migration，建立以下表：

- `users`：内部用户资料、状态、创建来源和时间戳。
- `families`：家庭资料、创建者、状态和时间戳。
- `family_members`：用户与家庭的角色、有效状态和移除历史。
- `family_invites`：邀请码哈希、状态、有效期、使用限制、创建与撤销审计字段。

数据库约束包括：

- `family_members(family_id, user_id)` 唯一。
- 枚举字段通过 `CHECK` 约束限制合法值。
- 外键引用用户和家庭。
- 常用成员、邀请和创建者查询建立索引。
- `max_uses` 为正数，`used_count` 非负且不大于 `max_uses`。

API 使用 camelCase，数据库使用 snake_case。ID 使用带领域前缀的随机唯一值：`usr_`、`fam_`、`fmem_` 和 `inv_`。

## 用户与家庭行为

内部用户创建接口验证显示名、头像和创建来源，并返回新用户。普通用户可以读取和更新自己的 `displayName`、`avatarUrl`，不能改变状态或创建来源。

创建家庭时，在同一个 D1 原子批次中创建家庭和创建者的管理员成员记录。一个用户创建的 active 家庭最多为 3 个。创建者自动成为管理员。

家庭详情和成员列表只对 active 成员开放。家庭资料只允许 active 管理员修改。所有家庭查询以 `family_id` 和 active membership 为权限边界，避免跨家庭数据泄露。

## 成员规则

一个家庭最多有 8 名 active 成员。成员角色为 `admin` 或 `member`，成员状态为 `active` 或 `removed`。

- 只有 active 管理员可以修改角色或移除他人。
- active 成员才能被修改或移除。
- 不能降级、移除或退出最后一名管理员。
- 管理员不能通过成员移除接口移除自己；主动离开使用 `/leave`。
- 被移除或主动退出时保留原成员记录并记录时间与操作者。
- 被移除用户以后通过有效邀请重新加入时恢复原记录，角色重置为 `member`，移除审计字段清空。

## 邀请生命周期

邀请码由加密安全随机数生成，显示格式为 `HM-XXXX-XXXX`。创建响应只返回一次原文，D1 仅保存 SHA-256 哈希和可识别前缀。

默认有效期为 1,440 分钟，默认最大使用次数为 8。创建接口允许管理员显式指定正整数值，并执行合理上限验证。

邀请状态按以下优先级判断：

1. 已撤销：`revoked`
2. 当前时间达到或超过 `expires_at`：`expired`
3. `used_count >= max_uses`：`exhausted`
4. 其他：`active`

邀请预览只返回家庭基本资料、成员数量、到期时间和 `canJoin`，不泄露成员列表、管理员资料或家庭业务数据。

加入操作按需求规定的顺序验证认证、邀请码、撤销、过期、用尽、重复成员和家庭人数。在同一个 D1 原子批次中创建或恢复成员记录并增加 `used_count`。重复加入返回 `ALREADY_FAMILY_MEMBER`，且不消耗邀请次数。

## HTTP、校验与错误处理

成功响应沿用现有 `{ "data": ... }` 包装，`204 No Content` 接口不返回响应体。错误响应沿用统一结构并包含请求 ID。

请求体必须为 JSON 对象；未知字段不影响既定字段，但所有已支持字段严格验证类型、长度和可空性。空白家庭名或显示名无效。头像允许 `null` 或有效 HTTP(S) URL。

领域错误映射到适当 HTTP 状态：

- `UNAUTHORIZED`：401
- `FORBIDDEN`：403
- 资源不存在类错误：404
- 重复成员、最后管理员、成员/家庭上限等业务冲突：409
- 请求格式或字段校验错误：400

未捕获异常继续使用现有 `INTERNAL_ERROR` 处理，不向客户端泄露 SQL、Token 或内部堆栈。

## 测试策略

严格按 TDD 增量实现。Cloudflare Workers Vitest 环境自动应用 migrations，并使用真实本地 D1，尽量不模拟数据库。

测试覆盖：

- HS256 JWT 的缺失、无效、过期、用户和 internal scope 行为。
- 用户创建、读取、更新、禁用用户拒绝访问。
- 家庭创建事务、创建上限、成员隔离与管理员权限。
- 成员列表、角色变更、移除、退出和最后管理员保护。
- 邀请创建、哈希存储、一次性原文、预览、撤销、过期、用尽和加入。
- 8 人上限、重复加入不消耗次数、removed 记录恢复。
- 统一响应、错误码、HTTP 状态和 request ID。

完成后运行 Core 测试、类型检查、Wrangler dry-run 构建和 `git diff --check`。

## 配置与文档

Worker bindings 增加 JWT 密钥。`.dev.vars.example` 仅展示变量名和明显不可用于生产的占位值。README 记录：

- 如何配置本地及生产 JWT Secret。
- 用户 Token 与 internal Token 所需 claims。
- 如何应用本地和远程 migrations。
- 第一版 API 清单与示例调用。
- Core 不负责外部微信身份映射的边界。

## 验收标准

- 第 14 节列出的第一版最小 API 全部可用。
- 所有家庭数据访问都经过 active membership 或管理员权限检查。
- 家庭创建上限、成员上限和至少一名管理员规则无法被并发业务路径绕过。
- 邀请码原文不落库，加入成员和邀请计数原子更新。
- Core 数据模型中不存在微信 `openid` 或企业微信 `userid` 字段。
- 测试、类型检查、dry-run 构建和差异检查全部通过。
