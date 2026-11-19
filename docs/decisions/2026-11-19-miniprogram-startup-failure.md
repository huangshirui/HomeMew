# Decision: Mini startup failure is not an empty household / 初始化故障不等于无家庭

Date: 2026-11-19
Status: Owner requested implementation.

- D1 quota, Core/Identity unavailable, failed auth recovery, malformed response, Family Catalog outage and network timeout are not successful empty family lists. Home displays a retryable system-unavailable state (request ID when available); no create/join before successful user and family initialization.
- Cold Home entry shares runtime bootstrap with App. Remove the family-list subscription that prematurely marked loaded before identity/selection. Explicit retry revalidates; no new polling, no duplicate manual refresh. Same verified user/family with an existing view may retain rendered content during transient failure with a warning. Confirmed permission/identity changes do not retain old content.
- Mini Family BFF preserves upstream failure and rejects malformed Core/Catalog/members success payloads rather than fabricating empty arrays. No LifeSpace or provider Backend changes.
- Existing direct-entry navigation remains unchanged. Web/front-door deployment (Preview then Production), then Mini build/device acceptance. Synthetic tests; no actual D1 exhaustion induced.

- Same startup error priority applied to Event/Task, domains (Activity/Goal/Habit/Anniversary), Football lists and More entry wording. The fixed Mini CI test list includes both health-ui and startup-failure behavioral tests; previous health PR CI did not execute its newly added Mini test file until this change.
