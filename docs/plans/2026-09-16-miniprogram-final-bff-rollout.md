# HomeMew Mini Program Final BFF Rollout Plan

Status: Active / Living Plan  
Started: 2026-09-16  
Tracking issue: HomeMew #79  
Related platform work: LifeSpace #234  
Accepted architecture decision: `docs/decisions/2026-09-16-miniprogram-final-bff-boundary.md`

> This file is the cross-session execution source of truth for the current HomeMew Mini Program BFF rollout. Chat history is not required to continue the work.

## 0. How a new session must resume / 新会话接力方法

Before changing code, a new session must:

1. Read repository `AGENTS.md` and the nearest nested `AGENTS.md` for every surface that will change.
2. Read `docs/decisions/2026-09-16-miniprogram-final-bff-boundary.md` and this plan.
3. Read HomeMew issue #79, HomeMew PR #77, and LifeSpace issue #234 for current execution/dependency state.
4. Re-check `main` rather than trusting this file blindly if code or PR state has moved since the last update.
5. Work only on the **Next action** section unless a newly discovered blocker requires the plan to be amended first.
6. Before ending a significant work session, update this file's **Current state**, **Evidence**, **Next action**, and any affected phase checklist; then leave a short progress comment on HomeMew #79.
7. If the work changes an important architecture/product/engineering decision, append that decision to the project's Notion `99 · 架构演进与决策日志` as required by project instructions.

Do not use old chat conclusions as implementation authority when repository evidence disagrees.

## 1. Final target / 最终目标

The next Mini Program review candidate must already use the final HomeMew-owned BFF contract for all of its runtime LifeSpace dependencies.

```text
WeChat Mini Program
  -> HomeMew front door / final Mini BFF contract
       -> HomeMew provider backend where needed for WeChat trust
       -> LifeSpace Core / Identity through Cloudflare Service Bindings
```

The Mini-facing contract remains stable while the LifeSpace-side contract evolves.

After the Mini version is approved, LifeSpace Event/Query/TemporalRange can cut over and the BFF changes only its internal adapter. Final cleanup removes old-LifeSpace compatibility code from the BFF without another Mini Program migration.

## 2. Non-negotiable invariants / 不可破坏的边界

- LifeSpace remains the sole source of truth for Identity, Spaces/Grants, business models and authorization.
- The Mini Program is a client only; the BFF is a stateless application anti-corruption layer only.
- The final Mini contract is a HomeMew product contract, not a mirror of LifeSpace REST or Canonical Query wire shape.
- After Phase 2, Mini runtime code must not address public LifeSpace Core/Identity base URLs or LifeSpace API paths directly.
- The short-lived LifeSpace user bearer may still be held by the Mini Program and forwarded through the HomeMew BFF; this does not make the BFF the authorization authority.
- BFF -> LifeSpace transport uses Cloudflare Service Bindings where supported, while preserving bearer, request/error semantics and LifeSpace authorization behavior.
- The BFF must not persist household business truth, duplicate Space/model authorization, accept arbitrary upstream URLs/paths, or become a generic proxy.
- HomeMew Web has no dedicated staging environment after Phase 1. This does not affect LifeSpace staging or unrelated environments.
- Compatibility required by review/release lag lives inside the BFF only.
- Phase 5 must not require a Mini Program code change or another WeChat review.
- HomeMew PR #77 is not the next merge target; it belongs to Phase 4 and must be re-evaluated/rebased before use.
- LifeSpace #234 Event breaking migration is gated until the submitted final-BFF Mini version is approved and production-active.

## 3. Current state / 当前状态

Last verified: 2026-09-16

| Area | State | Evidence / Note |
| --- | --- | --- |
| Final architecture decision | ✅ Defined | `docs/decisions/2026-09-16-miniprogram-final-bff-boundary.md` |
| Durable execution tracking | ✅ Defined | HomeMew #79 + this living plan |
| Event-only Mini BFF precursor | ✅ Merged | HomeMew PR #74, merge commit `6225c3959d1765eedb5b2690c64b20a7f2c87c1f` |
| Full Mini -> LifeSpace call inventory | ⬜ Not done | Must be generated from current `apps/miniprogram` code, not guessed |
| Final Mini BFF route/DTO contract | 🟡 Partial | Event precursor exists; complete cross-surface contract not yet designed |
| All Mini runtime LifeSpace dependencies behind BFF | ⬜ Not done | Current repo still contains direct LifeSpace paths outside Event |
| BFF -> LifeSpace Core/Identity Service Bindings | ⬜ Not done | Current Event BFF uses configured public Core URL/fetch path |
| HomeMew Web staging retirement | ⬜ Not done | staging workflow/config/docs still exist |
| Mini one-time migration to final BFF | ⬜ Not done | Phase 2 |
| WeChat review submission | ⬜ Not done | Phase 3 |
| LifeSpace TemporalRange platform foundation | ✅ Complete | LifeSpace #247/#248/#249: CRUD + filters/local-date-window + sort/cursor |
| LifeSpace Event model/storage migration | ⏸ Gated | LifeSpace #234 remains open; do not cut over yet |
| HomeMew Event new-contract cutover | ⏸ Gated | PR #77 Draft; Phase 4 only |
| BFF old-LifeSpace compatibility cleanup | ⬜ Not started | Phase 5 |

## 4. Phase 1 — Final BFF contract + compatibility against current LifeSpace

### Objective

Create the **final Mini-facing HomeMew contract now**, while the BFF still adapts that contract to the current production LifeSpace APIs.

### 4.1 Inventory every current Mini runtime dependency

Do not infer the list from documentation. Search current Mini Program source and produce an explicit route/call inventory covering at least:

- WeChat login / token acquisition;
- current-user profile/avatar and any Identity operations;
- family/Space list, create, detail, update, close/leave as actually used;
- members and role management;
- invitations / join flows;
- Event list/get/create/update/delete;
- Task list/get/create/update/Actions/delete;
- Day Record operations;
- Wish operations;
- Creation Draft / `喵一下`;
- Access-link challenge confirmation used for Web account linking;
- media upload/download calls actually used by Mini;
- notification/deep-link detail reads if they introduce separate routes;
- any hidden/shared request helper that can still choose LifeSpace directly.

Output of this step must be written back into this plan or a linked contract document with exact current source files and intended final HomeMew route for each call.

### 4.2 Design the final Mini-facing contract

For each inventoried dependency, decide one explicit HomeMew route and DTO.

Rules:

- Prefer HomeMew semantic routes over leaking generic LifeSpace model/query mechanics.
- Preserve stable HomeMew terms such as `familyId`, attendee/assignee/member concepts where appropriate.
- Keep LifeSpace IDs opaque; translate only where the HomeMew product contract intentionally differs.
- Keep date/time semantics exact: UTC Instant vs date-only vs half-open all-day ranges.
- Preserve optimistic concurrency/version behavior where required.
- Define list/filter/sort DTOs from the Mini product need, then map them internally to the active LifeSpace query contract.
- Do not make the Mini Program understand Canonical Query AST, TemporalRange physical representation, capability internals, or future platform revisioning.
- Route allowlists must be fixed; no client-controlled upstream path.

Before broad implementation, add contract tests that make this route surface explicit.

### 4.3 Implement current-LifeSpace adapters

Implement the final routes at the HomeMew front-door/BFF and translate them to the **current production LifeSpace contract**.

Temporary compatibility may exist here, including Event legacy-time mapping or current query parameter mapping, but it must be isolated from Mini-facing DTOs.

LifeSpace bearer forwarding remains mandatory for user authority. HomeMew role checks are validation/UX only.

### 4.4 Switch BFF -> LifeSpace to Service Bindings

Inspect LifeSpace production Worker service names and current HomeMew wrangler config; do not guess them.

Add explicit Core and Identity Service Bindings where the LifeSpace Workers support service-to-service `fetch`.

Requirements:

- preserve `Authorization: Bearer <LifeSpace user token>` for user operations;
- preserve request method/body/content type/multipart behavior;
- preserve/propagate request IDs;
- retain timeout/error-envelope behavior;
- no fallback to a client-controlled URL;
- any temporary public-URL fallback must be explicit, bounded and scheduled for deletion, not silent permanent behavior.

### 4.5 Retire HomeMew Web staging

Remove only the dedicated **HomeMew Web** staging deployment path and stale documentation/configuration that claims it is an active release environment.

Do not remove LifeSpace staging or other unrelated environments.

Production release safety becomes:

```text
local tests/typecheck/build
-> CI gates
-> explicit production deploy
-> production smoke verification
```

### 4.6 Phase-1 tests / gate

Phase 1 is complete only when all of the following are true:

- every currently used Mini LifeSpace dependency has a final HomeMew route and DTO;
- BFF routes run successfully against the current production-compatible LifeSpace contract;
- Core/Identity internal Service Bindings are wired and tested where supported;
- route tests prove the BFF cannot become an arbitrary proxy;
- bearer forwarding and deny-path tests prove LifeSpace remains authority;
- HomeMew Web staging workflow/config is retired;
- documentation reflects that the Mini-facing contract is final before review.

## 5. Phase 2 — One-time Mini Program migration

### Objective

Change the Mini Program exactly once so all normal runtime LifeSpace dependencies use the final HomeMew BFF contract.

### Work

- migrate shared request/service layers to HomeMew routes;
- remove direct LifeSpace Core/Identity route selection from Mini runtime code;
- remove stored/returned public LifeSpace service URLs if no longer required by any supported Mini flow;
- preserve the short-lived user bearer and refresh behavior through the HomeMew login flow;
- keep page-friendly DTOs and UI behavior stable unless the final contract deliberately improves them;
- ensure deep-link startup flows go through the same BFF boundary.

### Automated review gate

Add a durable test/check that fails when Mini production source reintroduces direct LifeSpace API addressing. The check should be architectural rather than only a brittle hostname grep when possible; hostname/path scans can supplement it.

### Manual smoke coverage

At minimum verify in WeChat Developer Tools and, before review, on a real device:

```text
login / token refresh
first-use profile
family create/join/switch/detail/manage
members / invitation flows
event list/detail/create/edit/delete
task list/detail/create/edit/complete/reopen/delete
day records
wishes
喵一下 / Creation Draft
Web-link challenge confirmation
avatar/media flows actually present in current Mini
notification/deep-link entry paths
startup directly into a business page
```

### Phase-2 gate

The review candidate must satisfy:

- Mini runtime does not call public LifeSpace Core/Identity APIs directly;
- all supported product flows pass through final HomeMew routes;
- Mini typecheck/build/tests pass;
- BFF/Web tests pass;
- smoke coverage passes;
- no server secret or service credential reaches Mini code;
- no temporary compatibility detail is encoded into the Mini contract.

## 6. Phase 3 — WeChat review and contract freeze

Submit the Phase-2 build for WeChat review.

During review:

- freeze the Mini-facing API shape;
- allow only backward-compatible server fixes unless WeChat review itself requires a client change;
- do not start the LifeSpace Event breaking cutover;
- prepare Phase-4 BFF/LifeSpace/Web changes behind the frozen contract.

Phase 3 completes only when the submitted build is approved and production-active.

## 7. Phase 4 — Coordinated LifeSpace + BFF cutover

### Preconditions

- Phase 3 is complete;
- LifeSpace #234 migration plan/data backfill/contract tests are ready;
- PR #77 is re-evaluated against current `main` and the final Mini BFF contract; reuse code only where still correct.

### Target

```text
Approved Mini
  -> unchanged final HomeMew BFF contract
       -> new LifeSpace Event/Query/TemporalRange contract

HomeMew Web
  -> new LifeSpace contract directly through its Web BFF/session boundary
```

### Rolling release safety

There is no assumption of a physically atomic multi-repository deploy.

Preferred sequence:

1. Deploy BFF logic that can safely tolerate the old/new upstream contract for the cutover window if required.
2. Deploy the LifeSpace Event/model/storage migration and activate the new contract according to LifeSpace #234's compatibility plan.
3. Switch/verify BFF new-adapter behavior while the Mini-facing contract stays unchanged.
4. Deploy/verify HomeMew Web against the new LifeSpace contract.
5. Observe production evidence before declaring the old adapter removable.

Temporary dual compatibility is permitted only inside the BFF and only for the cutover window.

## 8. Phase 5 — Remove BFF compatibility redundancy only

Delete obsolete compatibility that exists solely for the pre-migration LifeSpace contract, for example:

- old Event split-time conversion branches;
- old query parameter translators/fallbacks;
- legacy upstream DTO mapping;
- temporary old/new upstream detection;
- old compatibility-only tests and metrics.

Keep tests that assert the stable Mini-facing contract.

**No Mini Program code change is part of Phase 5.**

Final gate:

```text
Mini contract unchanged since review candidate
BFF has one current LifeSpace adapter path
LifeSpace new Event/Query/TemporalRange contract is authoritative
HomeMew Web uses current platform contract
old compatibility code removed
```

## 9. Evidence / 已确认依据

As of 2026-09-16:

- HomeMew PR #74 is merged and provides an Event-only BFF precursor.
- HomeMew PR #77 is open Draft for Event -> TemporalRange cutover and must stay out of the immediate path.
- `AGENTS.md`, `apps/miniprogram/AGENTS.md`, `docs/architecture.md`, `docs/product-rules.md`, `README.md`, and `apps/web/README.md` still contain older direct-LifeSpace/Event-only/staging wording; the 2026-09-16 accepted decision supersedes those conflicting statements until they are synchronized during implementation.
- LifeSpace #234 records that TemporalRange CRUD, typed filters/local-date-window, and sort/cursor foundation are complete via #247/#248/#249; Event model/storage migration is still open.

## 10. Current blockers / 当前阻塞

No external blocker prevents starting Phase 1.

The main correctness risk is beginning implementation before producing the complete Mini call inventory and final HomeMew route/DTO map. Therefore contract inventory/design is a hard gate before broad proxy migration.

## 11. Next action / 下一步动作

**Start Phase 1 on a fresh implementation branch from current `main`; do not build on PR #77.**

The first implementation session must:

1. read `AGENTS.md`, `apps/miniprogram/AGENTS.md`, and relevant current LifeSpace contracts;
2. enumerate every direct/indirect Mini -> LifeSpace call from current source;
3. add the exact inventory and proposed final BFF route/DTO mapping to this plan (or a linked contract doc);
4. identify which calls target Core, Identity, or the HomeMew provider backend;
5. verify actual LifeSpace Worker service names/bindings from the LifeSpace repository;
6. only after that inventory is reviewed internally against the accepted decision, begin implementing the complete final BFF surface.

Do not merge PR #77 and do not start LifeSpace Event's breaking migration during this step.

## 12. Session handoff template / 每轮交接模板

At the end of each significant work session, append/update the following information in this file and mirror a concise version to HomeMew #79:

```text
Date:
Branch / PR:
Phase:
Completed:
Evidence (tests/commits/PRs):
Changed assumptions/decisions:
Remaining:
Blockers:
Exact next action:
Do not do yet:
```

The **Exact next action** must be specific enough that a fresh session can continue without asking what happened in chat.