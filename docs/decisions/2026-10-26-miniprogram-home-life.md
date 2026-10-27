# Decision: Mini home / 生活进行时

Date: 2026-10-26
Status: Accepted by user; local implementation only, manual WeChat Developer Tools verification
Scope: Mini home and the personal Habit list entry. No platform or deployment change.

- Home order is 需要关注 → 今天安排 → 待办提醒 → 生活进行时. Keep existing attention/calendar semantics, task name, due-date window, member scope and completion action. Hide 待办提醒 only after a successful empty result; loading and failures retain their feedback/retry UI.
- Remove 常用工具 from live Home and skeleton. Existing complete feature entries remain in 更多. The bottom navigation and central ＋ creation sheet are unchanged this release.
- 生活进行时 switches between 我的习惯 / 活动 / 目标, initially 我的习惯. Each tab shows at most three records and offers 查看全部. Hide the complete module when every category is successfully empty; errors remain visible and retryable, including a marker on the affected tab. A successful category is usable while another fails.
- 我的习惯 means `habit.subjectPersonId` equals the current verified user's mapped Space Person, never creator identity. Only active personal Habits are displayed; unchecked-today rows sort first. Quick check-in forwards the current version through the existing Mini product Action, preserves row position on success and uses Core-computed today/streak. Viewer controls are read-only; LifeSpace remains authoritative. No proxy check-ins, backdating, undo or new schedule semantics.
- 活动 uses the current Space-local date window, with dated endings before undated endings. 目标 uses active status, with dated targets before undated targets. Both retain household visibility and label personal involvement. Clicking opens the existing detail. No invented percentage or automatic goal completion.
- The shipped Mini BFF currently does not lower Habit owner filters. This local-only change reuses its active-status query and walks bounded cursor pages, retaining only personal Habits, rather than assuming the first family page contains the user's records. The `mine=1` list entry keeps that same filter across search, status tabs and pagination. No new server query parameter or backend deployment is required.
- Home refresh/return/poll reloads these summaries. Domain requests have independent failure states and generation guards; changing or leaving a family clears summaries and invalidates old reads/writes. Check-in is never automatically replayed after a failure or version conflict. These are transient UI projections, not a second source of household truth.

Validation: Mini typecheck/build and behavior tests for pagination/owner filtering, domain failures, sorting/limits, stale family results, duplicate and concurrent check-ins, and version-conflict recovery. Visual/device verification is performed manually by the user.

## 2026-10-27 · 后续首页需求覆盖旧隐藏规则（Mini Program）

- **用户确认的新交互优先于 2026-10-26 的旧描述**：首页「待办提醒」即使成功加载为空也保留完整模块并展示「还没有待办」的操作入口；「生活进行时」即使所有分类为空也保留模块与当前 Tab 的空状态。不可因 CI 中的旧断言重新隐藏这些模块。
- **统一首页范围（Home Scope）**：设置页「只看我的 / 看全家」按家庭与用户保存；`me` 下习惯按映射的当前 Space Person 过滤，`all` 下显示全家进行中的习惯、活动和目标；全家习惯展示不等于获得代打卡权限，打卡仍遵从用户映射和 LifeSpace 权限。
- **首屏无闪动**：进入设置页时在同步的 `onLoad` 读取并呈现已保存的 `homeScope`，不等待邮箱账户异步加载完成。
- **CI 防回退原则**：2026-10-27 main 已实现以上规则；小程序测试必须模拟当前 `loadHomeScope` / `currentFamilyStore` 依赖并验证最新行为，不能拿 2026-10-26 的旧交互断言当作规格。
- **纠正记录**：[HomeMew PR #160](https://github.com/huangshirui/HomeMew/pull/160) 首稿错误地把上述用户修改当成回归并逆向恢复旧行为。后续提交撤销首稿运行时代码修改，仅调整测试与决策记录，待 GitHub Actions 重新验收。
