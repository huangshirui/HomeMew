# HomeMew Mini 2.1.1 · Lifecycle and idle-aware polling / 生命周期及空闲轮询

Date: 2026-11-26
Status: Accepted direction; implementation candidate, physical-device verification pending.

## Evidence / 背景
On 2026-11-26 00:00–08:00 Asia/Shanghai, Core read 320,421 rows. HomeMew Mini BFF and Core Event logs matched 204 requests; 202 Mac WeChat requests repeatedly loaded the same 67-day window, 101 two-page cycles. Core Event runtime reads totaled 275,523 rows across all 204 requests. The Mac window state is unverified.

## Decision / 决策
- Supersedes item 5 of the 2026-10-31 foreground revalidation decision for Home, Event and Task tab network polling only.
- Both App and page foreground are required. App hide cancels registered page network timers even if page hide is missing. Page hide/unload unregisters. No new background network poll after hide; already dispatched requests may finish.
- Active: 60 seconds; 5 minutes without observed user input: 5-minute cadence; 15 minutes: no network timer. Foreground return or captured touch/tap re-arms the scheduler, subject to existing page freshness/scope guards. Local display ticks are independent. No generic Page monkey-patch.
- Preserve explicit refresh, dirty invalidation, selected filters, scroll, existing SWR and authority checks. No LifeSpace or BFF contract/storage changes. No claim of delta sync or data-version checking in this release.
- Desktop wheel-only input may not be captured by touch/tap; explicit interaction/foreground restore resumes. Verify WeChat Mac and mobile lifecycle/input behavior on real devices before releasing.

## Acceptance / 验收
Automated policy and wiring tests; Mini CI typecheck and existing tests. On real Mac client leave calendar open 20 minutes, then minimize/lock overnight; confirm no new periodic Event API calls after pause, resume on click and manual refresh. Repeat on mobile, verify Tab switch, family switch and local edits. Compare Cloudflare D1/runtime logs with previous baseline.
