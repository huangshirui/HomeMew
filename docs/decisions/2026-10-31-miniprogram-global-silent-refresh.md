# Decision: HomeMew Mini Program Global Silent Refresh

Date: 2026-10-31
Status: Accepted by user
Scope: Every HomeMew Mini Program page (not Web or LifeSpace)

## Context / 背景

On screen unlock, returning to foreground, page `onShow`, or periodic refresh, some Mini pages clear the current list or activate a full-screen loading branch before network requests complete. Users observe a blank screen and lose context even though the page has already displayed valid data.

## Decision / 决策

1. **Stale-While-Revalidate (SWR)** for all automatic refresh triggers: `App.onShow`, page `onShow`, background polls, and domain dirty notifications. Preserve the last successfully rendered state while asynchronously requesting updated data. Successful responses update only the relevant view.
2. **Initial vs subsequent loading**: show skeleton/primary loading only before the first valid view; a successful **empty response is already loaded**. Automatic refresh must not reopen the first-load state based solely on array length. Explicit user pull-to-refresh may show a non-destructive refresher indicator.
3. **Failure**: keep the last successful data and UI controls, avoid disruptive automatic refresh toasts or blank states; for first load with no data, show a retryable error. Stale responses must not overwrite a newer request or a different family.
4. **UI continuity**: keep scroll position, filter, selected tab, search text and in-progress edits during automatic updates. Do not reset a page's data array in `onShow` for the same user/family.
5. **Authority exception**: on a confirmed logout, identity change, family/Space change, or access revocation, immediately invalidate and clear old-scope data instead of displaying it as a stale cache. The client must never use cached data to bypass LifeSpace access checks.
6. **Architecture**: no new authoritative persistent store, new backend endpoint, LifeSpace change, or generic global `Page()` monkey-patching. Apply the shared behavioral rule at existing page refresh boundaries; future Mini pages are subject to this decision.

## Implementation / 落地范围

- Home sections: track successful loads including empty results, show content while refreshing and reset those flags only on family switch.
- Activity / Goal / Habit lists: do not clear the same-family records in `onShow`, background failures keep the list, preserve filters and typed search.
- Activity / Goal / Habit and Football details: only initial load may activate full-screen loading; in-place revalidation preserves the record and Football performance list.
- Football lists and management: show retained rows for automatic revalidation; reset on real family or user-directed scope switch.
- Settings and Account Linking: do not hide an already-loaded account panel or link form on foreground recovery.
- Events / Tasks / Day / Wishes flows already using non-destructive local refresh remain in force.

## Validation / 验收

- Mini TypeScript typecheck/build and regression tests; verify foreground recovery while responses are delayed, empty-result polling, failed network requests, true family switch, and manual refresher separately.
- WeChat Developer Tools/physical-device verification is still required before releasing the Mini client.
