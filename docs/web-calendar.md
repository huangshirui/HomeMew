# HomeMew Web Calendar

Updated: 2026-09-15

## Scope

`/calendar` is the LifeSpace-backed household Calendar surface. It uses the published LifeSpace `event` model (`modelKey=event`) and current Calendar compatibility semantics directly through the existing same-origin Web BFF.

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

These split Event time fields and Calendar GET parameters are the current compatibility transport. They remain in use until LifeSpace completes the `temporal_range` platform layers and explicitly migrates the Event model to `when`; HomeMew must not invent that migration locally.

The current Calendar keeps the existing lightweight HomeMew UI primitives. A richer renderer such as Schedule-X remains optional product polish and is not required for LifeSpace range/CRUD/time correctness.

## API

The BFF preserves LifeSpace's canonical model-key Runtime paths:

```text
GET    /api/lifespace/core/v1/spaces/{spaceId}/models/event/records
POST   /api/lifespace/core/v1/spaces/{spaceId}/models/event/records
PATCH  /api/lifespace/core/v1/spaces/{spaceId}/models/event/records/{eventId}
DELETE /api/lifespace/core/v1/spaces/{spaceId}/models/event/records/{eventId}
```

Calendar list queries currently use the canonical records GET route with the timed and all-day half-open overlap compatibility parameters plus `calendarStart:asc`, and follow cursors until exhausted. These parameters are a migration transport, not a second caller-visible Query language; after Event migrates to `when: temporal_range`, overlap queries converge on Canonical Query.
