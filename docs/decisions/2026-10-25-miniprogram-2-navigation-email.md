# Mini 2.0 navigation and explicit Web mailbox authorization

Date: 2026-10-25
Status: Accepted by user; implementation not deployed
Scope: Mini UX, stable Mini BFF, Web session behavior and separately approved LifeSpace Identity capability.

## Navigation

More starts with 计划与成长, then 生活与回忆, then 家庭管理. No personal/family header above features. The family tile shows the real current-family avatar/name; without a family it reads 加入家庭 and opens a page offering both join and create. Settings owns personal profile editing, account/email and time preferences. About is named 关于 and uses the existing HomeMew logo.

`pages/family/detail` is the unified family manager: current profile, switcher, edit, members, invitations, create/join and leave/close. Historical `pages/profile/profile` stays registered and redirects to it. Switching refreshes the manager in place. LifeSpace remains the membership/authorization authority.

Normal startup, invitation/deep-link targets and no-family Home stay unchanged. Neither profile nor mailbox editing is a first-use gate. Failed family loading must never be presented as a successful empty list.

Family switching uses a bottom sheet, matching the Mini calendar/task chooser pattern: avatar/name rows, current-family indication, a bounded scrollable list, safe-area padding, backdrop/cancel dismissal and downward dismissal from the header. Background page scrolling is locked while open. Selecting another family closes the sheet and refreshes management in place; selecting the current family only closes it.

## Explicit mailbox authorization; no email OTP

The authenticated user enters a syntactically valid mailbox and explicitly authorizes its holder to access the current account through Web. No mail is sent; no mailbox ownership verification is claimed. Cloudflare Access still proves the Web identity using the trusted issuer and registered Application audience. This is an explicit application-scoped Authority grant, not contact metadata or implicit account merge.

LifeSpace Identity 0.13 owns the authorization and audit. Mini GET/PATCH `/api/v1/miniprogram/me/web-login` forwards through the fixed Identity binding to `/api/v1/me/web-login`. Response is `{data:{email,version,linked}}`; version 0 means no mailbox authorization exists. PATCH accepts only `{email,version}`, requires profile:write and optimistic concurrency, and is never blindly replayed. HomeMew does not store identity mappings.

With a mailbox configured, Settings shows masked email and 修改邮箱, hides the one-time code flow, and Identity rejects challenge confirmation for that user/Application. Legacy code-linked users retain access until they explicitly configure a mailbox. Existing principals are never reassigned or merged because of email. Conflicts are rejected; unsigned/raw claims grant nothing.

Changing the mailbox atomically replaces its authority after explicit confirmation. Old Access principals cannot bypass the new Application restriction. Cached HomeMew Web sessions call `/internal/v1/access/session-check` before reuse, compare the resolved user to the subject in their signed cached token, and fail closed on denial/unavailability. Existing bearer credentials outside this BFF retain their short TTL; this is not platform-wide JWT revocation and does not modify Core.

This supersedes the code-only onboarding restriction in `2026-08-25-web-existing-user-link-only.md` for explicitly authorized mailboxes. Web still cannot create HomeMew users. Access remains the IdP; no parallel password/email-OTP service is introduced.

## Release

Mini package metadata, lockfile and About advance to 2.0.0. Release Identity migration 0012 and 0.13 on Staging and verify first, then HomeMew BFF/Web, then Mini upload/review. Old Mini contracts and users without mailbox authorization remain compatible. Production migrations, deployment and Mini upload have not been performed.

## Mini UI follow-up

New domain pages reuse the shared nav-bar without a second content heading. List creation follows Days/Wishes with a floating action; filtering uses a nav action. Restore the standard container top inset for domain and football pages.

Detail navigation titles describe the page type (活动详情 / 目标详情 / 习惯详情); the record name appears only in the content summary and must not overwrite the navigation title after loading. Days, Wishes, Events, Tasks, Football and Family detail pages already follow this separation.

About diagnostics are hidden until five consecutive logo taps (at most 1.5 seconds between taps); unlocking does not run requests. Leaving resets partial tap progress.

Before the mailbox rollout, the exact missing-route error (BFF_ROUTE_NOT_FOUND/NOT_FOUND) is represented as unavailable email capability, preserving the legacy link-code entry. It never asserts mailbox binding succeeded. Auth/network/user-not-found failures remain errors; profile loading is independent of mailbox status. Live verification on 2026-10-25 found production me/web-login returning 404 BFF_ROUTE_NOT_FOUND. This compatibility adapter does not replace the required Identity/BFF deployment.
