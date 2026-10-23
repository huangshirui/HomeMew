# Decision: Restore four desktop navigation groups and compact grouped Mobile More

Date: 2026-10-23
Status: Accepted for HomeMew Web PR #142, pending Preview acceptance
Scope: HomeMew Web desktop side navigation and mobile/tablet More hub. This does not change LifeSpace authentication, Space Membership, Grants or domain model contracts.

## Navigation hierarchy / 导航信息架构

The approved HomeMew Web desktop sidebar has exactly four groups:

1. **日常** — 今天、日程、待办
2. **计划与成长** — 活动、目标、习惯
3. **生活与回忆** — 日子、纪念日、许愿池、足球比赛
4. **家庭管理** — 家庭与成员、设置

The mobile/tab bar remains 首页、日程、待办、更多. Because the three everyday actions already have top-level tabs, Mobile More groups only 计划与成长 / 生活与回忆 / 家庭管理; no duplicate home/calendar/tasks icons in More. Use a three-column compact, icon-led tile grid on phones instead of full-width descriptive cards, with responsive 4+ columns at larger widths.

## Missing management menus / 家庭管理菜单消失

The old desktop sidebar never gated the two management navigation links on owner/admin roles. However, navigation content was too tall for the fixed sidebar and lacked an independently scrollable area, so the lower group could be pushed outside the viewport while the profile footer occupied the bottom. Fix this layout, rather than arbitrarily granting management permissions or hiding the links.

- Keep Family/Settings navigation **visible to all signed-in users**, including editor/viewer; actual mutating actions are gated by current LifeSpace Space/Grant authority.
- Give desktop navigation `min-height:0`, `flex:1`, and independent `overflow-y:auto`, with fixed family selector and account footer.
- Family page already displays the authoritative user's `currentFamily.role` as owner/admin/editor/viewer; Mobile More now shows the same role label to aid staging acceptance.
- This code review does **not** establish that the particular Staging user is Owner. Verify the badge on a real authenticated Preview session rather than guessing or altering LifeSpace identity/membership.
- No automatic role upgrades, no local owner flag, no backend security bypass.

## Verification

Update `desktop-nav-hierarchy.test.mjs` for exact section order, compact tile columns, unconditional management menu and independently scrolling sidebar. Run Web tests, typecheck, build in PR CI. Preview deployment requires manual trusted-branch workflow; Production stays unchanged until separately approved.
