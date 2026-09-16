# Decision: take Meow offline and keep future draft orchestration in HomeMew BFF

Date: 2026-09-16  
Status: Accepted

## Context

The Mini Program's “喵一下” surface currently calls LifeSpace Registry Creation Draft endpoints and polls an ephemeral interpretation job before handing a draft to the Event, Task, Day, or Wish editor.

HomeMew #79 is moving all normal Mini runtime dependencies behind the final bounded HomeMew Mini BFF. During that migration, product direction changed: “喵一下” is temporarily unavailable, and its eventual implementation belongs to the HomeMew application boundary rather than the LifeSpace platform contract.

## Decision

1. “喵一下” is taken offline now. The Mini Program removes its user-facing create-sheet entry and page registration.
2. The dormant page and client adapter may remain in source history/current source for later redesign, but they are not an active or reachable product surface and must not be migrated to a LifeSpace-backed final Mini route in this rollout.
3. Future “喵一下” interpretation, provider orchestration, rate limiting, and ephemeral draft-job lifecycle belong to a bounded HomeMew BFF capability.
4. A future implementation requires a separate product/contract decision before re-enabling the Mini surface. It must define the stable Mini DTO, job lifetime/storage, provider trust, abuse controls, observability, and failure semantics.
5. When the user confirms a draft, durable Event, Task, Day Record, or Wish creation still uses the normal bounded Mini BFF product route and LifeSpace remains authoritative for those household records and authorization.
6. The HomeMew BFF must not use this exception to become a generic AI proxy or a second household business Core. Draft state is application orchestration only and must not become an authoritative copy of LifeSpace domain data.

## Supersession

For “喵一下” only, this decision supersedes current wording that maps the feature to LifeSpace Registry Creation Draft capability or requires a current-LifeSpace Creation Draft adapter in HomeMew #79.

It does not change the accepted final Mini BFF boundary for Identity, Space/Grant, Event, Task, Day Record, Wish, diagnostics, or other active runtime dependencies.

## Consequences

- The current Phase 1 Day / Creation Draft / diagnostic slice becomes Day / diagnostic only.
- Creation Draft routes are removed from the active final Mini contract inventory.
- Phase 2 does not migrate the dormant Meow client calls.
- No LifeSpace repository or LifeSpace #234 change is required.
- Re-enabling Meow is a later HomeMew-owned feature project and is not part of the current WeChat review candidate.
