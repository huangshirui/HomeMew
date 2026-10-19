# Decision: HomeMew Web global family navigation and page headers

Date: 2026-10-19
Status: Proposed (implemented in PR; pending review)

## Scope

HomeMew Web desktop, tablet, and mobile navigation. No LifeSpace platform or HomeMew BFF contract change.

## Decision

- Family/Space selection is a **global application context** owned by the existing `HouseholdProvider`; every family-scoped page reads the same current family.
- Desktop sidebar top area is the **unframed family identity**, with avatar, bold family name and secondary member count arranged like the former HomeMew wordmark. It must not look like a permanent button/card: for multiple-family users, show a subtle background and chevron on hover/focus and expose an accessible full-row native selector. Single-family users see identity only.
- Desktop has **no persistent horizontal shell header**. Each business page owns its one context-specific page heading and actions. Keep the account/avatar context at the bottom of the desktop sidebar.
- Mobile and tablet (below `lg`) retain a compact top bar containing the same family identity, member count, always-visible switch chevron (touch has no hover), and user avatar. Long names truncate safely; bottom navigation remains safe-area-aware.
- Mobile page headings place icon and title on one line with smaller type, retaining desktop title hierarchy and primary actions. Mobile monthly calendar uses date-selection cells plus a focused daily agenda below; desktop retains event details inside the full month grid.
- Family administration displays/edits the **already selected** family. Do not expose a second family selector there.
- The Today heading shows the current date and personalized greeting without repeating the family name already visible in the navigation.

## Family switching behavior

- The current family ID remains a browser UI preference only, never authority. The server-provided family list is consulted before selecting a remembered family and LifeSpace remains the authorization authority.
- Switching families remounts the nested business route subtree to prevent stale page-local data, draft state, and in-flight responses from a previous family appearing under the new family.
- Reset the member list immediately and guard its fetch with a request generation so an earlier family's slow response never overrides the latest family's members.
- Preserve the current URL during a switch: identical routes are scoped to the newly selected family.
- If there is no accessible family, existing creation/join flows remain available in Family administration.

## Rollout and validation

- Web-only frontend change, no Worker API or platform migration.
- Verify desktop/mobile layout, switching among two families, quick repeated switches, switching while on the family management page, single-family and no-family states.
- HomeMew Web has no persistent staging environment; deploy to production only after PR review and CI validation. Preserve the existing Mini BFF/front-door deployment contract.

## Tasks filters (2026-10-19 follow-up)

- **Task-specific filters:** Preserve existing Pending/Completed tabs and free-text search. Add assignee (any Space Person from the active family, or all) and due-date presets: all, overdue, today, next seven calendar days, or no due date.
- **Contract:** Combine status, assignee membership (`assigneePersonIds contains <Space Person ID>`) and nullable `dueDate` scalar predicates in one LifeSpace Canonical Query. Overdue is `pending AND dueDate < family-local today`; “next 7 days” uses a half-open `local_date_window` `[today, today+7)` in the family's IANA timezone. `dueDate isNull` identifies undated work. No client-only filtering of a partial page, new backend route or schema change.
- **Interaction:** Place status tabs, search and filter selects in a single responsive toolbar, matching Calendar's lightweight controls. Reset searches and filters on family change. The overdue option only appears in Pending, so completed work is never misleadingly labeled overdue. Empty states provide an action to clear search and filters.
- **Correctness:** Guard paginated async queries by request generation, so rapid family/filter/status changes cannot show stale records. Retain existing per-task grouping and the LifeSpace write/actions contract.
- **Validation:** `apps/web/task-filters-ui.test.mjs`, Web CI, and mobile/desktop tests for combinations, family switching, near-midnight timezone behavior, due-date window boundaries, and null dates. No LifeSpace or BFF change; PR #128 remains pending review.

## Calendar search, filters and week exploration (2026-10-19 follow-up)

- **Search scope:** Submitting a keyword switches to a paginated **whole-current-family search result list**. The existing LifeSpace Event Canonical Query searches `summary`, `description`, and `location`; search mode intentionally omits the displayed month/week temporal restriction, but retains the active-status and selected member/type filters. Results use the current family viewing timezone and support `nextCursor`/load more. Clearing the keyword returns to the calendar.
- **Filters:** The same participant (`attendeePersonIds contains <Space Person ID>`) and type (`when kindIs date|instant`) selections apply across calendar and global search. Only active events are displayed, preserving the established Event UI lifecycle. UI filters are not a new LifeSpace permission boundary.
- **Month overflow:** The first four event cards remain visible in each desktop month cell. A visible `查看全部 N 项（还有 M 项）` affordance opens a scrollable day dialog showing **all** matching events. Date numbers can open the same dialog; the dialog supports close/Escape and reuses the normal event editor. Mobile continues using a selected-date agenda below the compact month grid.
- **Week view:** Month/week toggle shares one selected family, filter state, timezone and editor. Week starts Monday and queries exactly one seven-day half-open `local_date_window`; previous/next period and Today navigation respect the active view. Desktop displays seven day columns with every event; phones show a seven-day date strip plus the selected day's agenda, without compressing event titles.
- **Data correctness and performance:** Keep existing Canonical Query semantics, including real temporal overlap and family IANA timezone. Loading a new view clears previous result rows, guards in-flight responses by generation, and loads global search in bounded pages. No new dependencies, persistence, generic endpoint, or LifeSpace contract change.
- **Tests and release:** Add `apps/web/calendar-exploration-ui.test.mjs` assertions and maintain existing shell/mobile calendar tests. Validate CI (Web tests/typecheck/build), search pagination, multi-day/all-day events, dense day expansion, filters, view changes and small-screen accessibility before any production deployment.
