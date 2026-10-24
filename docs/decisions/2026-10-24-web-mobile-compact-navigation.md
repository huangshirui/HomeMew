# Decision: Compact mobile app chrome and docked tab bar / 移动端导航收口

Date: 2026-10-24
Status: Accepted for UX implementation; PR review and Preview acceptance pending
Scope: HomeMew Web responsive presentation only; desktop sidebar and LifeSpace/Core contracts unchanged.
This decision supersedes the mobile top-bar and floating-tab presentation clauses of the 2026-10-19 global family navigation decision; family switching ownership and authority remain unchanged.

## Problem / 问题

On mobile, the global 64px family header duplicates the page heading and crowds the calendar controls. The floating black pill tab bar wastes horizontal and bottom spacing and differs from expected native-app navigation.

## Decision / 决策

- Move mobile family context to each primary page's heading row. The compact selector uses a home glyph, one-line truncated family name, bounded width (112px at most), native family switching for multi-family users, and an accessible label/full-name tooltip. No member count or user avatar is persistently displayed there. Family selection still uses the shared HouseholdProvider and does not confer authority.
- Calendar uses a mobile-specific short title **日程** beside the family selector and two 40px icon-only controls for **搜索与筛选** and **新建日程**. Full labels are retained for larger screens; screen-reader labels, disabled state and filter-active state remain available. Desktop keeps **家庭日程**.
- The mobile calendar period toolbar shows date plus compact month/week native selector, previous/Today/next controls; hide the redundant timezone subtitle and refresh button on phones (data refresh remains available on large screens). The IANA timezone still drives query and display semantics.
- Dock four full-width fixed mobile tabs **首页 / 日程 / 待办 / 更多** against the bottom viewport edge. Use a light surface, clear active state, thin top divider, 56px minimum tab height and bottom `safe-area-inset-bottom` padding. Content receives corresponding bottom clearance. Remove floating side gutters, black pill, and oversized shadow.
- For Activity/Goal/Habit record detail and football/integration nested screens, hide the bottom tab bar. Container detail gets an explicit compact back bar with family selector. Account avatar moves from the persistent top bar to the mobile More hub; desktop retains its account footer.
- Keep standard page headers responsive and let lower-priority page actions wrap when there is insufficient room; only the calendar's mobile actions are forced to a single compact row. The fallback compact selector truncates names rather than squeezing touch targets.

## Validation / 验收

- Test narrow widths (320/375/390/430px), iOS safe area, keyboard-focus/native family switch, long family names, multiple/single/no family, page reload on family switch, calendar month/week/search, disabled create for viewers, nested-route back/Tab behavior and desktop >= lg.
- Run Web test/typecheck/build in PR CI, then manual authenticated Worker Preview smoke test before Production deployment. Do not deploy automatically or modify LifeSpace, BFF, Identity, grants or Cloudflare environment routing.
- Update relevant source-based regressions in Web tests.
