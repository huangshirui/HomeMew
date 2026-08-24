# HomeMew Web Calendar

Updated: 2026-08-24

## Scope

`/calendar` is the LifeSpace-backed household Calendar surface. It uses the published LifeSpace `event` model (`route=events`) and Calendar capability directly through the existing same-origin Web BFF.

HomeMew does not introduce a calendar database or compatibility API.

## Current slice

- 42-cell month grid with the selected family's IANA timezone;
- real LifeSpace Calendar overlap query across the entire visible grid, including adjacent-month cells;
- pagination through `nextCursor`;
- timed and all-day events, including multi-day overlaps;
- create, update and soft-delete;
- optimistic concurrency through the LifeSpace `version` field;
- attendee selection using current Space Person IDs;
- viewer role is read-only UX; LifeSpace remains the authorization authority;
- switching family Space closes any editor opened for the previous family.

## Time mapping

LifeSpace remains authoritative for time semantics:

- timed events persist `startAt` / `endAt` as UTC RFC 3339 instants and preserve independent IANA `startTimezone` / `endTimezone` metadata;
- when editing an existing timed event, HomeMew reconstructs each endpoint in its own stored timezone so saving does not silently reinterpret an end instant using the start timezone;
- all-day events persist the half-open `[startDate, endDateExclusive)` range;
- the Web form shows an inclusive all-day end date and converts it to `endDateExclusive` on submission;
- month display groups timed events using the selected family's timezone;
- the Calendar query uses the visible grid's family-local midnight boundaries for timed overlap and the same grid dates for all-day overlap. This keeps the query range aligned with exactly what the month UI renders.

The current W6 slice intentionally keeps the existing lightweight HomeMew UI primitives while correctness and staging behavior converge. Schedule-X remains the intended richer renderer after the staging acceptance pass; it is not required for LifeSpace range/CRUD/time correctness.

## API

```text
GET    /api/lifespace/core/v1/spaces/{spaceId}/events
POST   /api/lifespace/core/v1/spaces/{spaceId}/events
PATCH  /api/lifespace/core/v1/spaces/{spaceId}/events/{eventId}
DELETE /api/lifespace/core/v1/spaces/{spaceId}/events/{eventId}
```

Calendar list queries use both timed and all-day half-open overlap bounds plus `calendarStart:asc`, and follow cursors until exhausted.
