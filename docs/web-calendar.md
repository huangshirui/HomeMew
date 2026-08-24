# HomeMew Web Calendar

Updated: 2026-08-24

## Scope

`/calendar` is the first W5 household-domain page. It uses the published LifeSpace `event` model (`route=events`) and Calendar capability directly through the existing same-origin Web BFF.

HomeMew does not introduce a calendar database or compatibility API.

## Current slice

- month grid with the selected family's IANA timezone;
- real LifeSpace Calendar overlap query;
- pagination through `nextCursor`;
- timed and all-day events;
- create, update and soft-delete;
- optimistic concurrency through the LifeSpace `version` field;
- attendee selection using current Space Person IDs;
- viewer role is read-only UX; LifeSpace remains the authorization authority.

## Time mapping

LifeSpace remains authoritative for time semantics:

- timed events persist `startAt` / `endAt` as UTC RFC 3339 instants and preserve IANA timezone metadata;
- all-day events persist the half-open `[startDate, endDateExclusive)` range;
- the Web form shows an inclusive all-day end date and converts it to `endDateExclusive` on submission;
- month display groups timed events using the selected family's timezone.

The first W5 slice intentionally uses the existing lightweight HomeMew UI primitives. Schedule-X remains the intended richer calendar renderer once the basic LifeSpace-backed CRUD and range semantics are proven; no additional calendar dependency is introduced in this slice.

## API

```text
GET    /api/lifespace/core/v1/spaces/{spaceId}/events
POST   /api/lifespace/core/v1/spaces/{spaceId}/events
PATCH  /api/lifespace/core/v1/spaces/{spaceId}/events/{eventId}
DELETE /api/lifespace/core/v1/spaces/{spaceId}/events/{eventId}
```

Calendar list queries use both timed and all-day overlap bounds plus `calendarStart:asc`, and follow cursors until exhausted.
