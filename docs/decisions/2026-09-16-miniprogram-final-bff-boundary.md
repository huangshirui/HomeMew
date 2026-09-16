# Decision: Mini Program Final BFF Contract Boundary

Date: 2026-09-16  
Status: Accepted  
Tracking: HomeMew #79; LifeSpace #234

## Context / 背景

The **primary trigger** for this boundary change is the LifeSpace Query / Sort / Time semantics convergence, not WeChat review by itself.

LifeSpace is moving ordinary-model consumption toward one Canonical Query model built from Search / Filter / Sort / Cursor Pagination, typed operators, explicit `local_date_window`, stable multi-sort/cursor behavior, and first-class `TemporalRange`. Event is the first concrete HomeMew model whose published resource truth will move from the current Calendar split fields to a canonical `when: temporal_range` value.

Platform authority for that work lives in the LifeSpace repository, especially:

- `docs/canonical-query.md`;
- `docs/time-space-semantics.md`;
- current Model Definition / generated contracts / Runtime / tests;
- LifeSpace issue #234 for the compatibility-classified Event migration.

The corresponding LifeSpace Notion pages `09 · Query 语义与能力设计` and `10 · 时间与空间语义设计` record the confirmed design and rationale, but repository Specification / Contract / Runtime remain the implementation source of truth.

HomeMew Web can move with the current LifeSpace contract because it is server-controlled and can be released together with platform changes. The Mini Program cannot safely share that coupling: a published client can remain in circulation while LifeSpace changes, and WeChat review adds an unavoidable release lag.

The 2026-09-15 decision therefore introduced a bounded HomeMew Mini BFF, initially only for Event. That decision correctly established the anti-corruption boundary, but its **initial Event-only scope and rollout sequence are no longer sufficient**. If the Mini Program remains directly coupled to other LifeSpace wire surfaces, the same class of platform evolution can force another reviewed client migration later.

The next Mini Program review candidate should therefore finish the application boundary once, not migrate one model now and require another Mini Program contract migration later.

The accepted target is:

```text
Mini Program
  -> stable HomeMew-owned Mini BFF contract
       -> active LifeSpace Core / Identity contract through application adapters
```

The Mini-facing contract is designed as a HomeMew application contract from the start. LifeSpace wire details such as Canonical Query AST, generic `modelKey` addressing, TemporalRange canonical representation, compatibility GET parameters, sort/cursor mechanics, or later compatible platform revisions remain behind the BFF.

This decision supersedes the **"Initial scope: Event"** and **release sequence** sections of `2026-09-15-miniprogram-bff-contract-boundary.md`. The earlier decision's security, authority, statelessness and no-second-Core rules remain binding.

## Decision / 决策

### 1. The next reviewed Mini Program uses the final HomeMew BFF contract

Before the next WeChat review submission, every runtime dependency that currently requires the Mini Program to address LifeSpace Identity/Core directly must be inventoried and moved behind explicit HomeMew-owned Mini routes.

The Mini Program may continue to hold the short-lived LifeSpace user bearer obtained through the trusted HomeMew login flow, but it must not depend on public LifeSpace base URLs or LifeSpace wire routes for normal runtime behavior after this migration.

The existing WeChat login route remains a HomeMew application route and may delegate to the narrow `apps/backend` provider adapter. This does not make `apps/backend` a business Core.

### 2. Mini-facing APIs are product contracts, not LifeSpace mirrors

The Mini-facing contract must use stable HomeMew concepts and DTOs suitable for the product. It must not expose platform implementation detail merely because the current LifeSpace contract happens to use it.

Examples of platform details that belong behind the BFF include:

- Canonical Query AST details;
- direct `modelKey`-oriented generic routing where a HomeMew domain route is clearer;
- Event migration details between legacy split time fields and first-class `TemporalRange`;
- platform-specific sort/cursor mechanics;
- future compatible platform contract revisions.

The BFF may translate `familyId` to Space IDs, HomeMew member references to Space Person IDs, and product query DTOs to the active LifeSpace contract. Observable HomeMew semantics must remain stable.

### 3. Compatibility is internal to the BFF

During the review-isolation phase, the BFF may contain temporary adapters that translate the final Mini contract to the **current production LifeSpace contract**.

After LifeSpace migrates Event/Query/TemporalRange behavior, the Mini contract stays unchanged. Only the BFF's LifeSpace-side adapter changes.

After the new platform path is stable, old-LifeSpace compatibility branches are deleted from the BFF. The Mini Program does **not** perform another API migration and does not require another review solely for this cleanup.

### 4. BFF -> LifeSpace uses Cloudflare internal networking

HomeMew BFF requests to LifeSpace Core/Identity should use Cloudflare Service Bindings instead of public Internet round-trips where the target Worker topology supports it.

This is a transport/topology change only. It must not alter authority semantics:

- the current LifeSpace user bearer remains the principal credential for user operations;
- LifeSpace remains authoritative for Application × Model Access, Space/Data Grant, Model and Policy checks;
- the BFF must not mint replacement user authority or duplicate permission tables;
- request IDs, errors, timeouts and contract semantics must remain observable and diagnosable.

### 5. HomeMew Web has no staging environment going forward

The dedicated HomeMew Web staging deployment is retired. Future HomeMew Web/BFF changes are released to production after repository test/build gates and explicit production smoke checks.

This decision applies to HomeMew Web staging only. It does not imply removing LifeSpace staging or unrelated backend/test environments.

### 6. Documentation alignment is a hard prerequisite

Because `AGENTS.md` requires architecture/product/decision documents to be read before code changes, conflicting normative documents are themselves a migration risk.

Before broad BFF implementation continues, HomeMew must synchronize the documents that still describe direct Mini -> LifeSpace business calls, Event-only BFF scope, or active Web staging. Until that synchronization is merged, this decision and the active rollout plan supersede conflicting wording.

The execution plan must keep an explicit document-alignment checklist and may not mark implementation phases complete while normative HomeMew docs contradict the target architecture.

## Final release sequence / 最终发布顺序

### Phase 0 — Documentation and authority alignment

Synchronize HomeMew `AGENTS.md`, nested Mini instructions, architecture/product rules and client READMEs with the accepted target. Verify the LifeSpace repository specifications that drive this migration and link them explicitly from the rollout plan.

No broad BFF business implementation should proceed from stale architectural wording.

### Phase 1 — Final BFF contract + current-LifeSpace compatibility

Define the complete final Mini-facing HomeMew API contract and implement it against the current production LifeSpace contract. Complete Core/Identity Service Binding wiring and retire HomeMew Web staging configuration/workflow.

### Phase 2 — One-time Mini Program migration

Migrate the Mini Program completely to the final HomeMew BFF contract and remove direct runtime LifeSpace API dependencies. Run full Mini Program checks and real-device / WeChat Developer Tools smoke coverage.

The resulting build is the review candidate.

### Phase 3 — WeChat review

Submit the Phase-2 Mini Program. Freeze the Mini-facing API contract except for strictly backward-compatible fixes required to complete review.

LifeSpace Event's breaking resource migration remains blocked during this phase.

### Phase 4 — LifeSpace + BFF coordinated cutover

After the submitted Mini Program is approved and production-active:

- LifeSpace performs the compatibility-classified Event migration and related Query/TemporalRange cutover;
- HomeMew Web moves directly to the new LifeSpace contract;
- the HomeMew BFF changes only its internal LifeSpace adapter while preserving the already-approved Mini-facing contract.

Because Cloudflare Worker deployments are not physically atomic across repositories, temporary dual-compatible BFF logic is allowed when required for a safe rolling cutover. This compatibility remains internal and temporary.

### Phase 5 — BFF compatibility cleanup only

After production stabilization, remove obsolete old-LifeSpace mapping, fallback, compatibility DTO conversion and tests from the BFF.

**Do not change the Mini Program for this cleanup.**

## Non-goals / 禁止项

- Do not recreate a HomeMew business Core.
- Do not persist family/Space, Event, Task, Day, Wish or other household business truth in the BFF.
- Do not duplicate LifeSpace authorization or accept client-supplied actor/user authority.
- Do not create a generic arbitrary upstream proxy.
- Do not expose arbitrary LifeSpace Core/Identity path selection to Mini Program input.
- Do not make the Mini Program adopt Canonical Query or TemporalRange merely to simplify BFF implementation.
- Do not invent a second HomeMew query language that competes with LifeSpace Canonical Query; HomeMew product DTOs must lower deterministically to the active platform contract.
- Do not merge HomeMew PR #77 as the immediate next step; its Event/TemporalRange work belongs to Phase 4 and must be re-evaluated against the final Mini BFF contract first.

## Consequences / 结果

- The Mini Program performs one contract migration before review instead of repeated application migrations as LifeSpace evolves.
- Query/Sort/TemporalRange platform evolution is isolated behind a stable application boundary for the review-constrained client.
- WeChat review lag becomes a release constraint handled by the application boundary rather than a reason for LifeSpace to retain product-specific compatibility indefinitely.
- Temporary compatibility becomes easier to delete because it exists only inside the BFF.
- HomeMew Web remains free to track the current LifeSpace contract directly.
- LifeSpace remains the sole source of truth and authorization authority.
- Future sessions have an explicit authority chain and cannot treat outdated HomeMew architecture prose as equal to the accepted decision.

Execution details and continuously updated progress are normative in `docs/plans/2026-09-16-miniprogram-final-bff-rollout.md`.