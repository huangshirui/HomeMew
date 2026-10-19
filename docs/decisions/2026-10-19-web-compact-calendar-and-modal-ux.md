# Decision: Compact Web page headers, collapsible search, and timed family week calendar

Date: 2026-10-19
Status: Proposed (implemented for review in PR #130)

## Product design

- Normal page headings (Calendar, Tasks, Days, Wishes, Family, Settings, More, Integrations) share the one-line `PageHeader` typography and action alignment. Remove standalone decorative icon rows and unnecessary generic subtitles; Today retains a useful date and greeting as its context-specific header.
- Calendar and Tasks place a single `搜索与筛选` toggle **next to the primary creation action**. Filters are closed by default; opening reveals the existing Canonical Query-backed controls. Calendar search results remain global to the selected family and a header indicator stays visible while search or filters are active. Tasks' Pending/Completed status tabs remain directly visible.
- Restore desktop month-grid **blank cell click -> create on that exact date**, including days from adjacent months. Cell background has a dedicated accessible button behind day controls and event chips to avoid accidental edits; mobile preserves selected-day agenda and explicit New action.

## True time-grid week view

- Week view is a 24-hour wall-clock time grid in the current family IANA timezone, not seven unordered card columns. Every timed event is clipped to each local calendar date it intersects, and its top/height are proportional to its local start and end time.
- Overlapping events use stable sorted interval clustering and lane assignment. Two events occupying the same moment cannot obscure each other; touching endpoints may reuse a lane. A test checks concurrency and overnight clipping.
- Each Space Person is assigned a stable color from an eight-color palette; the event's deterministically selected attendee determines its color. An explicit neutral style denotes events without an assigned/known attendee. This is **visual identity**, not new LifeSpace responsibility ownership. Multiple attendees remain represented by the Event `attendeePersonIds`, with no authority or schema change.
- All-day events live in a separate row. Desktop shows seven day columns; mobile keeps a seven-day selector but shows a single selected day's time grid and all-day lane. Tapping an empty time slot creates an event with the corresponding date and rounded local time.
- Search/date query remains the existing LifeSpace `when overlaps local_date_window` contract; no new calendar projection or persistence.

## Dialog ergonomics

- Every currently implemented editing dialog (Event, Task, Day, Wish), and Calendar's day-details dialog, locks the outer page while open. The shared lock is reference-counted, handles iOS body positioning and restores prior scroll/state on close.
- Internal dialog panels still scroll independently. The `scrollbar-overlay` utility uses a narrow unobtrusive scrollbar, shown temporarily in response to actual inner scrolling and hidden afterwards; scrolling cannot chain into the page underneath.
- Keep current version/optimistic concurrency, role read-only gates, and LifeSpace actions. UI overlays do not replace platform authorization.

## Validation and rollout

- PR #130 carries the implementation and new regression checks for overlapping layouts, overnight boundaries, search toggle, month blank-cell creation and modal scroll locking.
- CI must pass Web tests, TypeScript typecheck and build. Manually verify desktop/tablet/mobile layouts, scrolling, overlays, date/time offsets, multi-member colors, all-day events and view/filter navigation.
- HomeMew Web change only. No LifeSpace model, BFF, credential, Cloudflare configuration or production deployment change. Merge/production deployment requires separate review and human action.
