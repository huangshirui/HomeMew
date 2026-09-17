# HomeMew Web Calendar

Updated: 2026-09-17

## Scope

`/calendar` is the LifeSpace-backed household Calendar surface. It uses the published LifeSpace `event` model (`modelKey=event`) and the current Event v6 / TemporalRange contract directly through the existing same-origin Web boundary.

HomeMew does not introduce a calendar database or a second calendar compatibility API. LifeSpace remains authoritative for Event persistence, authorization, Canonical Query, TemporalRange validation, optimistic concurrency and audit.

## Current slice

- 42-cell month grid with the selected family's IANA timezone;
- LifeSpace Canonical Query overlap across the entire visible grid, including adjacent-month cells;
- pagination through `nextCursor`;
- timed and all-day events, including multi-day overlaps;
- create, update and soft-delete;
- optimistic concurrency through the LifeSpace `version` field;
- attendee selection using current Space Person IDs;
- viewer role is read-only UX; LifeSpace remains the authorization authority;
- switching family Space closes any editor opened for the previous family.

## Time mapping

LifeSpace Event v6 uses one authoritative `when: temporal_range` value:

- all-day events persist `{ kind: "date", start, endExclusive }` with half-open `[start, endExclusive)` semantics;
- timed events persist `{ kind: "instant", start, endExclusive }` as absolute RFC 3339 instants;
- timezone is viewing/editor context, not Event persisted truth;
- the Web form uses the selected family's IANA timezone to project timed instants into local date/time controls and to convert edited local values back to absolute instants;
- the Web form shows an inclusive all-day end date and converts it to the exclusive TemporalRange end on submission;
- month display groups timed events using the selected family's timezone;
- changing the family timezone changes projection only and does not rewrite Event instants.

The old split Calendar fields (`isAllDay`, `startAt`, `endAt`, endpoint timezone metadata, `startDate`, `endDateExclusive`) belong to the historical LifeSpace Event contract. They are not the current Web persistence contract. The reviewed Mini Program may still use equivalent HomeMew-owned DTO fields at its stable BFF boundary; that is an application projection and does not recreate the old LifeSpace resource truth.

## Query

The visible grid is queried with the LifeSpace Canonical Query endpoint:

```text
POST /api/lifespace/core/v1/spaces/{spaceId}/models/event/records/query
```

The query combines:

- `when overlaps { kind: "local_date_window", startDate, endDateExclusive, timezone }`;
- `status = active`;
- `sort: when asc`;
- cursor pagination;
- `context.viewingTimezone` equal to the selected family timezone.

The client does not compute UTC midnight query bounds and does not use the legacy Calendar GET compatibility parameters.

Create/update/delete continue to use the ordinary model record routes:

```text
POST   /api/lifespace/core/v1/spaces/{spaceId}/models/event/records
PATCH  /api/lifespace/core/v1/spaces/{spaceId}/models/event/records/{eventId}
DELETE /api/lifespace/core/v1/spaces/{spaceId}/models/event/records/{eventId}
```

The Calendar keeps the existing lightweight HomeMew UI primitives. A richer renderer such as Schedule-X remains optional product polish and is not required for LifeSpace range/CRUD/time correctness.
