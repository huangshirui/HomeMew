# HomeMew Web Calendar

Updated: 2026-09-16

## Scope

`/calendar` is the LifeSpace-backed household Calendar surface. It consumes the published LifeSpace `event` model (`modelKey=event`) through the existing same-origin Web BFF. The BFF remains an authenticated transport boundary; it does not own or translate an alternate Event contract.

## Current slice

- 42-cell month grid with the selected family's IANA viewing timezone;
- Canonical Query overlap across the entire visible grid, including adjacent-month cells;
- cursor pagination;
- timed and all-day events, including multi-day overlaps;
- create, update and soft-delete;
- optimistic concurrency through the LifeSpace `version` field;
- attendee selection using current Space Person IDs;
- viewer role is read-only UX; LifeSpace remains the authorization authority.

## Time mapping

LifeSpace `when: temporal_range` is the only persisted Event time truth:

- timed events use `{ kind: "instant", start, endExclusive }`;
- all-day events use `{ kind: "date", start, endExclusive }`;
- both variants use half-open `[start, endExclusive)` ranges;
- `isAllDay` is derived in the editor from `when.kind`;
- the Web form shows an inclusive all-day end date and converts it to the exclusive canonical boundary on submission;
- month display projects Instant ranges through the selected family's viewing timezone;
- the saved Instant value is absolute and is not rewritten when viewing timezone changes.

The list request uses `when overlaps local_date_window` and sorts by `when`. The same explicit IANA timezone is sent in the window operand and `context.viewingTimezone`, so filtering, ordering, grouping, and rendering share one projection.

## API

The BFF preserves LifeSpace's canonical model-key Runtime paths:

```text
POST   /api/lifespace/core/v1/spaces/{spaceId}/models/event/records/query
POST   /api/lifespace/core/v1/spaces/{spaceId}/models/event/records
PATCH  /api/lifespace/core/v1/spaces/{spaceId}/models/event/records/{eventId}
DELETE /api/lifespace/core/v1/spaces/{spaceId}/models/event/records/{eventId}
```

Calendar no longer depends on split-field GET parameters or `calendarStart`; recurrence, display rules, and attendee semantics remain Calendar concerns above Generic Query.
