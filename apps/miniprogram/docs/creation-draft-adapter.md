> Status: historical / inactive since 2026-09-16. “喵一下” is offline and this LifeSpace adapter is not an active runtime contract. A future implementation belongs to the HomeMew BFF and requires a new accepted contract; see `docs/decisions/2026-09-16-meow-bff-ownership-and-temporary-offline.md`.

# LifeSpace Creation Draft -> HomeMew form mapping

The retired implementation treated LifeSpace Registry Creation Drafts as platform-native model drafts and adapted them to product form fields at the Mini Program service boundary.

## Event time mapping

LifeSpace timed event drafts use UTC instants:

- `startAt`
- nullable `endAt`
- optional `startTimezone`
- optional `endTimezone`

HomeMew event forms edit local wall-clock fields:

- `startDate` / `startTime`
- `endDate` / `endTime`

`miniprogram/services/creation-draft-adapter.ts` converts timed event instants using the same `viewingTimezone` that was supplied to LifeSpace for interpretation. If LifeSpace supplies endpoint timezone metadata, it is used for that endpoint conversion; otherwise the viewing timezone is used.

When LifeSpace omits `endAt`, HomeMew applies an application-level default duration of **60 minutes** and pre-fills the form end date/time as `startAt + 60 minutes`. This is a HomeMew UX default only; it does not change the LifeSpace model contract, where `endAt` remains nullable in Creation Drafts. If LifeSpace explicitly supplies `endAt`, the explicit value always wins and HomeMew does not replace it.

The default is calculated from the UTC start instant before conversion to wall-clock fields, so date rollover is preserved correctly. For example, a start time of `23:30` produces a default end time of `00:30` on the following day.

Examples:

- `周六上午10点足球比赛` -> start date/time filled, end date same as start date, end time defaults to `11:00`.
- `周六晚上11点半足球比赛` -> start `23:30`, default end `00:30` on the following day.
- `周六上午10点到11点足球训练` -> both start and explicit end date/time are filled from LifeSpace; no default is applied.

All-day drafts preserve LifeSpace's half-open `startDate` / `endDateExclusive` semantics and convert the exclusive end date to HomeMew's inclusive form end date for display/editing.

## Boundary rule

This mapping belongs in HomeMew's Mini Program service layer. LifeSpace remains authoritative for model fields and time semantics; HomeMew may apply product-specific form defaults without requiring LifeSpace to emit UI-specific fields such as `startTime` or to change the platform's nullable `endAt` semantics.
