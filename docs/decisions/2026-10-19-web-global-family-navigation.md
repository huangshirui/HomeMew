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
