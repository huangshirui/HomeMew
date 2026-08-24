# HomeMew Web Wishes

Updated: 2026-08-24

`/wishes` is backed directly by the published LifeSpace `wish` model and its lifecycle Actions.

Current slice:

- open/claimed, fulfilled and archived views;
- create for the current authenticated user's Space Person;
- owner-only content editing/deletion;
- claim/unclaim, fulfill, reopen, archive and restore through LifeSpace Actions;
- current owner/claimant names are resolved from current family Space Persons;
- optimistic `version` concurrency on all writes.

HomeMew does not reproduce the Wish state machine. UI controls are only a convenience; LifeSpace policy and Action guards remain authoritative.

With this slice, the first real-data pass for W5 Calendar, Tasks, Days and Wishes is complete; the next product slice is the Home/Today aggregation and cross-page polish.
