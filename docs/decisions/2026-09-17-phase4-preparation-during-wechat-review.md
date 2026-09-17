# Decision: Allow Phase 4 Preparation During WeChat Review

Date: 2026-09-17  
Status: Accepted  
Tracking: HomeMew #79; LifeSpace #234

## Context / 背景

HomeMew Mini Program 1.6.3 has completed real-device verification and has been submitted to WeChat review. The final Mini-facing HomeMew BFF contract is therefore frozen for review.

The 2026-09-16 rollout decision correctly blocked the **production Event cutover** until the reviewed Mini version is approved and production-active. Its wording also said that LifeSpace Event breaking migration remained blocked during Phase 3. That wording is broader than necessary.

The risk we need to avoid is production incompatibility with an older Mini version. Non-production engineering work does not create that risk as long as it cannot change production behavior.

## Decision / 决策

### 1. Phase 3 and Phase 4 preparation may run in parallel

While Mini Program 1.6.3 is under WeChat review, the team may prepare Phase 4 work in branches, draft PRs, automated tests and non-production environments.

Allowed preparation includes:

- LifeSpace Event Model Definition migration design;
- Event `TemporalRange` schema/runtime/migration/backfill implementation;
- compatibility classification and generated-contract updates;
- migration and rollback verification;
- LifeSpace staging-only validation where explicitly safe;
- HomeMew Web migration to the new Event resource/query contract on a non-production branch;
- HomeMew Mini BFF internal new-contract adapter work and old/new compatibility tests;
- re-evaluation/reimplementation of useful ideas from HomeMew PR #77 against current `main`;
- cross-repository integration fixtures and cutover runbooks.

### 2. Production cutover remains a hard gate

Until the reviewed Mini Program version is both **approved and production-active**, none of the following may change production behavior:

- LifeSpace production Event resource/storage truth must remain the current split Calendar representation;
- production HomeMew BFF must continue to work with the current production LifeSpace Event contract;
- HomeMew Web production must not require the new Event resource contract;
- old production-compatible Event paths/adapters must not be removed;
- Phase 5 compatibility cleanup must not start.

The gate is therefore:

```text
Development / branch / tests / non-production preparation: allowed during review
Production Event/Query/TemporalRange cutover: blocked until reviewed Mini is production-active
```

### 3. Use fresh Phase 4 preparation branches

HomeMew PR #77 was created before Phase 0-2 completed and is now structurally stale relative to current `main`.

Do not merge or mechanically rebase #77 as the Phase 4 implementation. Reuse only ideas/tests that still match current LifeSpace contracts and the final Mini BFF boundary.

Phase 4 implementation should start from current `main` in fresh preparation branches.

### 4. Mini-facing contract remains frozen

Phase 4 preparation must not change the reviewed Mini-facing route/DTO/query/time contract except for a strictly backward-compatible review fix required by WeChat review.

The whole purpose of parallel preparation is to finish server/platform work while preserving the submitted client contract.

## Consequences / 结果

- WeChat review time is no longer idle engineering time.
- LifeSpace migration, HomeMew Web adaptation and BFF new-adapter work can be ready before approval.
- Approval still remains the production safety gate.
- PR #77 becomes reference material rather than the implementation branch.
- A rejected/revised Mini review does not require reverting platform work because that work has not reached production.

This decision narrows the Phase-3 blocking language in `2026-09-16-miniprogram-final-bff-boundary.md`: **production cutover is blocked; non-production Phase 4 preparation is allowed.**
