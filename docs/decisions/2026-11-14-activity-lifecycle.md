# Activity explicit lifecycle / 活动显式生命周期

- Date: 2026-11-14
- Status: Accepted design; implementation candidate pending verification and release.
- References: [HomeMew #186](https://github.com/huangshirui/HomeMew/issues/186), [LifeSpace #578](https://github.com/huangshirui/LifeSpace/issues/578), [LifeSpace #579](https://github.com/huangshirui/LifeSpace/pull/579).

## Contract and UX / 契约与体验

LifeSpace Core is the sole source of truth. Activity status is planned / active / completed / cancelled (计划中 / 进行中 / 已完成 / 已取消). Existing dates remain scheduling information, not lifecycle rules. Migration defaults all existing records to active; no inferred completion or background transition. New records default to active.

Web and Mini list/home queries use explicit status (default active). Detail uses the lifecycle actions start, complete, cancel, reopen, reset with the record version. The UI does not write status by ordinary PATCH. Non-default initial status is implemented by Create followed by an allowed Action; these are not atomic. If the Action fails, retain the created record, show the failure and navigate to its detail for review instead of retrying Create. 

This supersedes the date-period filtering of new Activity clients in the earlier Activity UX and Mini home decisions. The Mini BFF still accepts the original period-based query from released clients during the review/release interval; the old period and new status filters cannot be mixed. No direct Mini-to-Staging connection is introduced.

## Release / 发布

The new Web/BFF release requires Core contract 0.54.0 and schema >=79; Identity gate unchanged. Deploy LifeSpace staging first; verify HomeMew CI, Web Preview and BFF against staging. Production order is LifeSpace Core, HomeMew Web/BFF, then Mini device verification and submission/release. Existing Mini builds always use the production BFF. No production deployment or Mini review submission is implied by this decision. Owner manually dispatches release workflows. 
