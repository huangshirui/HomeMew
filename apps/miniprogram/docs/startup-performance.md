# 小程序启动性能约定

最后更新：2026-09-08

## 背景

真机诊断显示一次 HomeMew -> Cloudflare/LifeSpace 请求存在较高固定端到端成本，因此客户端必须避免把独立请求无必要地串行叠加，也不能在 Launch 刚拿到结果后立即重复请求。

本约定只优化 HomeMew 小程序请求编排与首屏体验，不改变 LifeSpace 的权威数据与授权边界。

## 启动流程

有效 Token 场景：

1. Launch 并行请求 LifeSpace Identity 当前用户资料与 Core 当前可访问 Family Spaces；
2. 用户禁用状态、首次资料设置与当前家庭都以本次远端结果为准；
3. Family 列表在同一小程序进程内保留 5 秒复用窗口，只用于消除 Launch -> Home 紧接着发生的同一请求；下一次启动仍强制远端刷新；
4. Home 在已确认 `userId + familyId` 后读取对应的本地首页 UI cache，立即恢复可展示内容；
5. Home 随即并行刷新 Events、Tasks、Attention Days，远端成功结果覆盖页面并更新本地 cache。

Token 无效时仍先完成微信登录与 LifeSpace Token 交换，再执行上述流程。

## 本地首页缓存边界

本地缓存是可随时丢弃的展示缓存，不是业务数据源，也不参与授权判断：

- 按 LifeSpace `userId` 与 `familyId` 隔离；
- 最长保留 24 小时；
- 今日 Events 只有在查看日期仍相同时才允许恢复，避免把昨日事件当成今日事件；
- Tasks 与 Attention Days 允许先显示最近缓存，但进入首页后立即刷新；
- 退出登录或运行环境切换时清除；
- 缓存读取/写入失败不得阻塞真实业务请求；
- LifeSpace 始终是用户、Family 权限和业务数据的唯一权威来源。

## 不在本次 P0 范围

- 首页 Tasks 查询范围进一步收窄；
- 下拉刷新路径的请求去重；
- 60 秒轮询向事件驱动更新演进；
- Cloudflare/网络链路本身的基础 RTT 与连接建立成本优化。
