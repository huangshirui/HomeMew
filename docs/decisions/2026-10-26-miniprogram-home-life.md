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

- CI regression fix (2026-10-27): 首页范围选择 `all` never widens the explicitly personal 「我的习惯」; missing current-user Space Person mapping yields no habit query/rows/check-in. Settings home-scope hydration is independent from email account loading. Both 待办提醒 and 生活进行时 hide only when all relevant results are successfully empty; loading/errors retain retry UI.

Validation: Mini typecheck/build and behavior tests for pagination/owner filtering, domain failures, sorting/limits, stale family results, duplicate and concurrent check-ins, and version-conflict recovery. Visual/device verification is performed manually by the user.
