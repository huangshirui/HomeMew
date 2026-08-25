# HomeMew Web staging acceptance

This checklist is the final browser-level acceptance layer for the household Web application. LifeSpace Core semantics are verified in the LifeSpace staging gate; HomeMew CI additionally guards the page-to-model/Action route contract. The checks below prove the remaining real browser, Cloudflare Access and cross-client behavior.

## Preconditions

- Use `homemew-web-staging.aisr.online` behind the staging Cloudflare Access application.
- Sign in with an Access principal already linked to an existing HomeMew/LifeSpace user through the Mini Program.
- Prefer a disposable staging family and disposable records.
- The test user must have write permission unless the case explicitly tests a viewer.
- Keep DevTools open for deny/error cases; no LifeSpace bearer token should appear in browser storage or browser-visible API responses.

## Acceptance matrix

| Surface | Real browser checks | Expected result |
| --- | --- | --- |
| Session / linking | Open Web with a linked Access principal; logout and sign in again | Existing `usr_*` and family data are reused; Web never offers account creation |
| Home | Load today; complete one due/overdue task | Today data comes from current family; task disappears after successful `complete` and is completed in other clients |
| Calendar | Create a timed event; create an all-day event; edit name/time/attendees; delete both | Range refresh is correct; family timezone/all-day semantics survive round-trip; Mini Program sees the same records |
| Tasks | Create with due date + assignee; search; edit; complete; reopen; delete | Pending/completed grouping follows server state and every mutation refreshes the current version |
| Days | Create elapsed, countdown and cycle records; edit; record occurrence for elapsed/cycle; archive; restore; delete | Temporal computed state refreshes from LifeSpace; countdown has no occurrence action; archive/restore switches lists |
| Wishes | Create; edit; fulfill; reopen; archive; restore; delete | Owner lifecycle follows LifeSpace Actions and current Space Person identity |
| Wishes — second member | A different family member claims then unclaims a wish | Claimant is the acting member; owner cannot be silently substituted |
| Concurrency | Open one record in Web, change it in another client, then save stale Web editor | Stale version is rejected; UI shows the LifeSpace error/request ID rather than overwriting |
| Viewer authorization | Repeat representative create/action controls as a viewer | Write controls are disabled/hidden and direct mutation attempts remain denied by LifeSpace |
| Cross-client consistency | After representative Web mutations, refresh the Mini Program | Both clients show the same authoritative LifeSpace state; no HomeMew Web-only copy exists |

## CI-owned route contract

`apps/web/household-domain-contract.test.mjs` keeps the following page contracts from drifting silently:

- Calendar → `event` CRUD.
- Tasks → `task` CRUD + `complete` / `reopen`.
- Days → `day_record` CRUD + `archive` / `restore` / `record-occurrence`.
- Wishes → `wish` CRUD + `claim` / `unclaim` / `fulfill` / `reopen` / `archive` / `restore`.
- Home → read `event` / `task` / `day_record` and complete a task.

This is intentionally not a substitute for the browser matrix. Cloudflare Access user identity, visual interaction, cross-client observation and a true second-member claim flow require a real user session.

## Exit criteria

W6 household-domain staging acceptance is complete when every row above has been exercised on staging without an unresolved correctness, authorization, timezone, concurrency or cross-client issue. Record any defects as normal repository work; do not encode staging-only business behavior to make the checklist pass.
