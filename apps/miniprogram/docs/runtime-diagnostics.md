# HomeMew Mini Program runtime diagnostics

`我的 -> 关于家事喵`包含一个只读的 Core 响应时间测试。进入页面时自动测试，也可以手动重新测试。

## Measurements

每项执行 3 次并显示中位数，同时保留 3 次原始耗时。

- `GET /health`: LifeSpace Core 的最小 Worker 路径。该路由不访问 D1，因此用作设备到 Cloudflare Edge/Core Worker 的端到端基线。
- `GET /api/v1/status`: LifeSpace Core status 路径。该路由读取 `schema_metadata`，明确包含一次 D1 查询，因此用作设备 -> Core Worker -> D1 -> Core Worker -> 设备的轻量完整链路基准。
- Real business path: 使用当前家庭执行 `GET /api/v1/spaces/{spaceId}/tasks?status=pending&sort=dueDate:asc&limit=1`。请求走 Mini Program 正常共享认证层，包含用户 Token、Core 鉴权、Space/Application × Model Access 与真实 Task 模型 D1 查询。没有当前家庭时跳过，不创建或修改任何业务数据。
- Network RTT: 若当前微信网络栈在 `wx.request` profile 中提供 `rtt`，页面显示 health 请求的 RTT 中位数；不可用时显示 `—`。
- Worker + D1 extra: `status median - health median`，下限为 0。它只是附加耗时估算，包含 Core route 差异、D1 往返、连接复用和瞬时网络抖动，不能当作 D1 SQL 执行时间。

`health` 与 `status` probe 使用当前 runtime 的 canonical Core URL，并带 cache-busting query 参数与 `Cache-Control: no-cache`。真实业务 probe 使用正常认证请求层。所有 probe 都是只读，不写业务数据，不需要新增 HomeMew backend 或 LifeSpace API。

## Interpretation

优先一起观察三档结果：

- health 与 status 都高：更像设备网络、Edge 路由或区域路径问题；
- health 低而 status 明显高：更值得检查 Worker 到 D1 的 I/O/placement；
- status 尚可但真实业务链路明显更高：更值得检查 LifeSpace Core 内部鉴权、Space/Model Access、业务查询的串行 D1 round-trip；
- 单次异常但中位数正常：更可能是瞬时网络抖动。

该诊断用于用户可见的快速定位，不替代 Cloudflare Workers/D1 Metrics、Tracing 或正式性能基准。
