# Decision: LifeSpace 0.39 production cutover window

Date: 2026-09-24  
Status: Accepted  
Tracking: HomeMew #105, #111; LifeSpace #278

## Context / 背景

HomeMew permanent code has already stopped reading or sending LifeSpace `Space.kind`, and the HomeMew Family Catalog is the sole family-classification source.

The remaining production rollout is intentionally ordered:

```text
HomeMew backend production
  -> production Family Catalog import/reconcile
  -> HomeMew Web/BFF no-kind production
  -> LifeSpace Core 0.39/schema45+ production
```

Before the LifeSpace step, production is still on the 0.38 compatibility side of the breaking `Space.kind` removal. HomeMew therefore needs a bounded release-gate window that permits deploying its no-kind Web/BFF before LifeSpace removes the field.

## Decision / 决策

The HomeMew production LifeSpace release gate temporarily accepts exactly:

- LifeSpace Core `0.38.0 + schema 44` as the migration source;
- LifeSpace Core `0.39.0 + schema >=45` as the target state.

The 0.38 exception applies only to `production`. Staging remains pinned to the 0.39 target contract.

This exception changes only the HomeMew deployment gate. It does **not** restore any runtime read/write/fallback for `Space.kind`.

## Removal / 退役

Issue #111 owns deletion of the 0.38 production exception immediately after:

1. production Family Catalog exact ID/count reconciliation is complete;
2. the no-kind HomeMew Web/BFF is live;
3. LifeSpace production is Core 0.39/schema45+;
4. production smoke checks pass.

After those conditions, HomeMew returns to a single target LifeSpace release baseline and the migration-only gate is removed rather than retained as permanent compatibility.
