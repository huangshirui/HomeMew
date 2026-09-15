# Decision: Mini Program BFF Contract Boundary

Date: 2026-09-15
Status: Accepted

## Context

LifeSpace Query/Time/Spatial semantics are converging toward Canonical Query plus first-class TemporalRange/Location semantics. HomeMew Web can move with the platform contract directly, and currently-unused adapters do not require compatibility. The HomeMew Mini Program is different: released versions are subject to WeChat review and rollout delay, so a breaking LifeSpace model migration cannot assume every active Mini Program has already switched contracts.

The previous HomeMew architecture had normal Mini Program business requests call LifeSpace Core directly and kept the HomeMew backend limited to WeChat provider trust. That made the Mini Program depend directly on platform wire representation. This decision revises that boundary for HomeMew business-model requests that need release-lag protection.

## Decision

HomeMew introduces a stateless application BFF contract boundary for the Mini Program.

The boundary is intentionally narrow:

```text
Mini Program
  -> HomeMew Mini BFF route
  -> current LifeSpace Core contract
```

LifeSpace remains the only source of truth for Spaces, authorization and household business records. The BFF may translate HomeMew/Mini Program request and response DTOs to the current LifeSpace contract, but it must not persist Events/Tasks/Day Records/Wishes, duplicate LifeSpace authorization, create a HomeMew permission table, or become a second business Core.

The BFF forwards the current short-lived LifeSpace user bearer to Core. Core continues to perform the authoritative Application × Model Access, Space/Data Grant, Model and Policy checks. The BFF never accepts a client-controlled upstream URL, Core path or replacement Authorization value.

## Initial scope: Event

The first protected business surface is Event because Event will move from the current Calendar compatibility fields to first-class TemporalRange semantics.

The Mini Program calls a HomeMew-owned Event BFF route. During the first release, that route maps to the current LifeSpace Event wire contract. When LifeSpace later migrates Event to TemporalRange, only the BFF's LifeSpace-side mapping changes; the deployed Mini Program-facing Event contract can remain stable.

This is not a generic arbitrary-model proxy. Additional HomeMew model routes are added only when there is a concrete reason to place that application contract behind the BFF.

## Release sequence

1. Ship the Event BFF route while LifeSpace still supports the current Event contract.
2. Release a Mini Program version that routes Event reads/writes through the HomeMew BFF.
3. Keep the current LifeSpace Event compatibility surface until that Mini Program version passes WeChat review and is the production version.
4. Migrate LifeSpace Event to first-class TemporalRange and update HomeMew BFF's LifeSpace-side translation in the same controlled rollout.
5. HomeMew Web moves directly to the new LifeSpace contract and does not receive a legacy compatibility branch.
6. Remove obsolete LifeSpace Event compatibility once production Mini Program traffic no longer depends on it.

The HomeMew BFF boundary remains after migration; temporary legacy translation code does not.

## Routing boundary

Production `homemew.aisr.online` is owned by the HomeMew Web Worker/front door. Therefore Mini Program BFF routes are implemented at that front door and forwarded only to fixed LifeSpace Core operations. They are not exposed through a broad arbitrary `/api/v1/*` proxy.

Cloudflare Access must bypass only the explicit Mini Program BFF paths that need to be callable by the Mini Program. Endpoint authorization still requires the LifeSpace user bearer and Core remains authoritative.

## Compatibility policy for related consumers

- **Mini Program:** temporary release-lag compatibility is required and belongs at the HomeMew BFF boundary.
- **HomeMew Web:** no legacy compatibility; move directly with the new LifeSpace contract.
- **n8n nodes:** no compatibility requirement for the unused List/Query implementation; production use of Get is unaffected.
- **MCP/adapters:** no compatibility requirement because they are not yet production consumers.

## Consequences

- LifeSpace does not need to accumulate application-specific compatibility abstractions merely because WeChat review delays client rollout.
- HomeMew Mini Program becomes less coupled to LifeSpace wire evolution while still using LifeSpace as the sole business source of truth.
- The BFF remains stateless and narrow, so this decision does not restore the retired HomeMew business Core.
- Event migration can proceed after the BFF-enabled Mini Program release is approved, without requiring n8n/MCP/Web compatibility layers.

Tracking: HomeMew #70; LifeSpace #234/#241.