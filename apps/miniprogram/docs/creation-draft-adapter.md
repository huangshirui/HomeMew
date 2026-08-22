# LifeSpace Creation Draft -> HomeMew form mapping

HomeMew treats LifeSpace Registry Creation Drafts as platform-native model drafts and adapts them to product form fields at the Mini Program service boundary.

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

When `endAt` is absent, HomeMew does **not** infer a duration. The adapter carries the start date forward as the form end date and sets `endTime` to an empty string. This intentionally overrides the normal manual-create default time. The existing event form submission validation then requires the user to choose an end time before the record can be created.

Examples:

- `周六上午10点足球比赛` -> start date/time filled, end date same as start date, end time empty.
- `周六上午10点到11点足球训练` -> both start and end date/time filled.

All-day drafts preserve LifeSpace's half-open `startDate` / `endDateExclusive` semantics and convert the exclusive end date to HomeMew's inclusive form end date for display/editing.

## Boundary rule

This mapping belongs in HomeMew's Mini Program service layer. LifeSpace remains authoritative for model fields and time semantics; HomeMew must not require LifeSpace to emit UI-specific fields such as `startTime` or an invented default duration.
