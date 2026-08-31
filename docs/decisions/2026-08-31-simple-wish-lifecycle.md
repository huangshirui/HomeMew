# 2026-08-31 · Simplify Wish to aspiration → fulfillment

## Decision

HomeMew Wish（愿望）is intentionally a very small domain model. It records an aspiration and whether that aspiration has become true; it is not a task-assignment or commitment workflow.

The business lifecycle is therefore only:

```text
open -> fulfilled
fulfilled -> open   # correction only
```

- `open`: the wish is waiting to be realized.
- `fulfilled`: the wish has been realized.
- `reopen` exists only as a correction for an accidental fulfillment.

## Authorization

- The current Space Person creates a wish for themselves and becomes `ownerPersonId`.
- The owner remains the only person allowed to edit wish content or soft-delete it.
- Any principal that passes the normal LifeSpace Space/Application/Grant/model write boundary and resolves to a Space Person may execute `fulfill` or `reopen`.
- The client may hide or show controls for usability, but LifeSpace remains authoritative.

## Removed workflow semantics

The Wish model no longer contains or exposes:

- `claimed` / `claim` / `unclaim`;
- `claimantPersonId` / `claimedAt`;
- `archived` / `archive` / `restore` / `archivedFromStatus`;
- `fulfilledByPersonId`.

`fulfilledByPersonId` is intentionally omitted because the person clicking the UI is not necessarily the real-world person who made the aspiration happen. LifeSpace audit data still records who performed the state transition.

`fulfilledAt` is retained because the moment a wish became true is meaningful domain data.

Soft deletion remains a technical/data-management lifecycle and is not a Wish business status.

## Existing-data migration

When LifeSpace publishes the breaking Wish Model Contract（模型契约）:

- existing `fulfilled` wishes remain `fulfilled`;
- `archived` wishes whose prior state was `fulfilled` become `fulfilled`;
- `open`, `claimed`, archived-from-open, and archived-from-claimed wishes become `open`;
- old claimant/fulfiller relation rows are removed;
- typed Wish storage is rebuilt to enforce only `open | fulfilled`.

LifeSpace must be deployed before HomeMew clients that consume the simplified contract.

## Mini Program experience

The simpler data model is paired with stronger emotional feedback rather than more workflow states:

- successful creation: a restrained “wish enters the pool” star/ripple Micro-interaction（微交互） plus light haptic feedback;
- waiting wishes: quiet breathing/glow treatment;
- successful fulfillment: warm light, star burst, short celebration copy, and light haptic feedback;
- fulfilled wishes: warmer, memory-like visual state;
- reopening: intentionally low-key because it is a correction, not a celebrated domain event.

The interaction should stay warm and slightly playful, not become a heavy fireworks/game effect.
