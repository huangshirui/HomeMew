# Mini 2.0 navigation and explicit Web mailbox authorization

Date: 2026-10-25
Status: Accepted by user; implementation not deployed
Scope: Mini UX, stable Mini BFF, Web session behavior and separately approved LifeSpace Identity capability.

## Navigation

More starts with 计划与成长, then 生活与回忆, then 家庭管理. No personal/family header above features. The family tile shows the real current-family avatar/name; without a family it reads 加入家庭 and opens a page offering both join and create. Settings owns personal profile editing, account/email and time preferences. About is named 关于 and uses the existing HomeMew logo.

`pages/family/detail` is the unified family manager: current profile, switcher, edit, members, invitations, create/join and leave/close. Historical `pages/profile/profile` stays registered and redirects to it. Switching refreshes the manager in place. LifeSpace remains the membership/authorization authority.

Normal startup, invitation/deep-link targets and no-family Home stay unchanged. Neither profile nor mailbox editing is a first-use gate. Failed family loading must never be presented as a successful empty list.

Family switching uses a bottom sheet, matching the Mini calendar/task chooser pattern: avatar/name rows, current-family indication, a bounded scrollable list, safe-area padding, backdrop/cancel dismissal and downward dismissal from the header. Background page scrolling is locked while open. Selecting another family closes the sheet and refreshes management in place; selecting the current family only closes it.

## Account linking correction

The email authorization model originally recorded here was rejected by the user on 2026-10-26. It is superseded by `2026-10-26-unified-access-account-link.md`: email-first and code-first linking complete the same Access principal relation. There is no separate mailbox authorization table or permanent email-based login path. The navigation decisions above remain in scope and unchanged.

## Release

Mini package metadata, lockfile and About advance to 2.0.0. The interrupted rollout applied Identity migration 0012/0.13 to Staging. The correction adds 0013/0.14 through a new PR. Deploy only after required CI and merge, then exact-candidate Staging/Preview acceptance before Production. Mini upload/review remains separate. Old Mini contracts and users without mailbox authorization remain compatible. Production migrations, deployment and Mini upload have not been performed.

## Mini UI follow-up

New domain pages reuse the shared nav-bar without a second content heading. List creation follows Days/Wishes with a floating action; filtering uses a nav action. Restore the standard container top inset for domain and football pages.

Detail navigation titles describe the page type (活动详情 / 目标详情 / 习惯详情); the record name appears only in the content summary and must not overwrite the navigation title after loading. Days, Wishes, Events, Tasks, Football and Family detail pages already follow this separation.

About diagnostics are hidden until five consecutive logo taps (at most 1.5 seconds between taps); unlocking does not run requests. Leaving resets partial tap progress.

Before the mailbox rollout, the exact missing-route error (BFF_ROUTE_NOT_FOUND/NOT_FOUND) is represented as unavailable email capability, preserving the legacy link-code entry. It never asserts mailbox binding succeeded. Auth/network/user-not-found failures remain errors; profile loading is independent of mailbox status. Live verification on 2026-10-25 found production me/web-login returning 404 BFF_ROUTE_NOT_FOUND. This compatibility adapter does not replace the required Identity/BFF deployment.
