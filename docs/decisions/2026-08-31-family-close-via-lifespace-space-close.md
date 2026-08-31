# 2026-08-31 · 家庭注销映射到 LifeSpace Space Close

Status: **Accepted**

## 决策

HomeMew 的“注销家庭”不在应用侧实现第二套家庭删除逻辑，而是直接映射为 LifeSpace Kernel 的 Space 生命周期动作：

```http
POST /api/v1/spaces/{spaceId}/close
```

HomeMew `family` 仍然只是 LifeSpace `Space(kind=family)` 的产品映射。LifeSpace 是家庭 Shared Reality（共享现实）、成员关系和 Data Grant（数据授权）的权威来源。

## 权限与产品语义

- 只有 LifeSpace 当前 `owner` 可以注销家庭。
- HomeMew 的普通 `admin` 即使拥有日常家庭管理权限，也不能注销家庭。
- Space Owner 在家庭详情页看到“注销家庭”，不再看到“退出家庭”。
- 非 Owner 成员仍使用现有“退出家庭”路径，只终止自己的 Space Membership（空间成员关系）。
- 注销是高风险操作，小程序采用两次明确确认；确认文案必须说明所有成员和外部系统会立即失去访问权限。

## 数据与失效语义

注销家庭是**逻辑关闭（logical close）**，不是物理删除：

- LifeSpace 关闭 Space，并使其退出普通活动 Space 列表；
- 活跃 Membership / Space Person 失效；
- 活跃邀请失效；
- 该 Space 发出的 Data Grant 全部撤销；
- Webhook / Event Subscription 等 Space Eventing 配置被禁用；
- 家庭的 Event、Task、Day Record、Wish 等 Shared Reality 记录保留，不由 HomeMew 逐条删除；
- 当前版本不向用户提供恢复已注销家庭的能力。

HomeMew 不新增家庭业务数据库、不增加隐藏 BFF 清理逻辑，也不直接操作 LifeSpace D1。

## 并发与调用路径

小程序通过现有共享 LifeSpace 请求层：

1. 读取当前 Space 取得 `version`；
2. `POST /api/v1/spaces/{spaceId}/close` 并提交该 `version`；
3. LifeSpace 使用乐观并发控制执行关闭；
4. 成功后 HomeMew 刷新可访问家庭列表并重新选择当前家庭。

`SPACE_OWNER_REQUIRED` 和 `SPACE_VERSION_CONFLICT` 必须在产品层给出明确提示，不得静默重试高风险写操作。

## 依赖与发布顺序

HomeMew 此能力依赖 LifeSpace Core Kernel `0.16.0` 及其 Space lifecycle migration。LifeSpace 必须先完成迁移与 Core 部署，再发布启用“注销家庭”的 HomeMew 版本。

## 不在本次范围

以下能力属于独立的未来生命周期契约，不从 `close` 行为中推断：

- Ownership Transfer（所有权转移）；
- Restore Space（恢复 Space）；
- Purge / Physical Delete（清除 / 物理删除）；
- 保留期及合规删除策略。

本决策不改变“家庭物理删除不属于当前 MVP”的既有原则；它补充的是一个平台支持的逻辑终止路径。
