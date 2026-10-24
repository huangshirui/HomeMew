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

## 2026-10-24 UI review follow-up: centered primary title and image identity / 二次验收后更新

- The 2026-10-24 mobile Preview screenshots revealed inconsistent title typography and layout on Home/Calendar/Tasks/More/Activity/Goal. The accepted correction is a single shared Mobile PageHeader at **20px / semibold / one line**, with equal flexible left/right tracks and a genuinely centered current-page title. Desktop PageHeader stays separate and unchanged.
- Left: compact family selection (Logo + truncated family name + chevron, max 112px), never occupying the centered title slot. Right: the page's accessible 40px icon actions, omitting actions when unavailable; preserve the full desktop buttons. All module landing pages use this component. Home retains the date/greeting as page content below its **首页** header.
- Family Logo uses LifeSpace Space `avatarUrl` (including the Mini's stable same-origin `/api/v1/miniprogram/media/families/:spaceId/avatar` route); no new image ownership or cache. A missing/error image shows a letter fallback. Member portraits use the Mini BFF's existing same-origin `/api/v1/miniprogram/media/users/:userId/avatar` route, which proxies the stable LifeSpace Identity public asset. No bulk profile retrieval, unbounded queries or HomeMew shadow member table.
- Due to 320px phone constraints, multiple member portraits **do not occupy the fixed title bar**. Tapping the family selector opens an anchored panel: available families with their Logos, the selected family's member avatar group (first five +N), and Family Management. The Family & Members page also shows real member portraits for every listed member. An unavailable avatar falls back to initials. Panel closes on selection, outside pointerdown or Escape.
- Nested Activity/Goal/Habit detail pages use Back + centered context-specific title; Football and Integration detail headers use an explicit Back affordance. Bottom tabs remain hidden on nested screens, unchanged on main routes.
- This replaces the provisional clause in this file that placed family identity to the right of the page title and moved all account context into a permanent center gap. No LifeSpace/BFF/API/auth/schema changes; only existing Mini public image routing is reused.
- Validation: update source-regression tests, Web CI test + typecheck + build, then manual 320/375/390/430px Preview audit of heading position, overflowing controls, missing image assets and family switching before merge/Production.
