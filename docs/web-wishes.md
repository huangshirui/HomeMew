# HomeMew Web Wishes

Updated: 2026-08-31

`/wishes` is backed directly by the published LifeSpace `wish` model and its lifecycle Actions.

Current slice:

- `open` and `fulfilled` views only;
- create for the current authenticated user's Space Person;
- owner-only content editing/deletion;
- any authorized Space Person with effective Wish write authority may `fulfill` or `reopen`;
- no claim/unclaim or archive/restore workflow;
- current owner names are resolved from current family Space Persons;
- optimistic `version` concurrency on all writes.

HomeMew does not reproduce the Wish state machine. UI controls are only a convenience; LifeSpace policy and Action guards remain authoritative.

The Mini Program adds the richer emotional interaction for successful wish creation and fulfillment. Web intentionally keeps the same contract with a quieter interaction style.
