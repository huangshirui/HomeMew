# Decision: HomeMew Mini Home Life and Football Detail Revalidation Optimization

Date: 2026-10-31
Status: Implementation of previously accepted global silent refresh and 60-second foreground throttling
Scope: HomeMew WeChat Mini Program only

## Motivation / 背景

Although Home/Event/Task tab pollers use a 60-second interval, Home still fetches the three Life summary modules (habits, activities, goals) and the family member lookup on every ordinary onShow. Football detail revalidation fetches schema, two teams, competition and up to 50 individual players every time even when match version and display references are unchanged. Both contribute redundant requests after short unlock/foreground recovery.

## Approach / 决策

1. Home applies the existing AutoRefreshGate to the combined Life modules: fresh for 60 seconds, invalidated by the shared domains revision. The key includes family, identity, Home Scope and family-local date. The initial load, date transition, family/scope change and explicit manual update remain effective; full Life fetches triggered by polling/first load also stamp the gate.
2. A successful Home habit check-in marks the domains revision so other UI surfaces revalidate without waiting out the TTL. Existing optimistic in-place check-in updates and pending-button protections remain unchanged.
3. Football detail still fetches the authoritative match and selected player's performances at every permitted refresh. Only presentation metadata (team names/icons, competition label, roster) and the published performance schema can be temporarily reused for up to 5 minutes in the same page instance.
4. Metadata fingerprint includes family, principal, match version, team IDs, competition ID, roster IDs, football revision and domains revision. If those change, fetch metadata immediately. Incomplete metadata fetches are not marked fresh; schema failures can reuse existing on-screen data without claiming a new successful fetch.
5. This optimization is client-local only. It does not grant access, replace LifeSpace authority, store household business facts persistently, or add new Mini BFF endpoints.
6. Before real-device publication, verify unlocking, local edit return, remote concurrent updates, family/scope switches and actual WeChat account status. Remote edits to team names that do not change the match or local revision may take up to 5 minutes to appear in detail, which is an explicit freshness trade-off.

## Regression tests / 验证

- Home onShow 60-second suppression and local domains invalidation (home-life).
- Football repeated refresh keeps match/performance reads, skips repeated metadata/schema, and revalidates after match version change or local football edits (football-ui).
- CI: Mini Program tests/build/typecheck plus Web/Backend checks, and real-device follow-up.
