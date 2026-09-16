# LifeSpace Query/Temporal -> HomeMew Final Mini BFF Rollout Plan

Status: Active / Living Plan  
Started: 2026-09-16  
Tracking issue: HomeMew #79  
Current phase: Phase 1 — source-derived inventory and final Mini BFF contract design  
Related platform work: LifeSpace #234  
Accepted architecture decision: `docs/decisions/2026-09-16-miniprogram-final-bff-boundary.md`

> This file is the single cross-session execution plan for the current LifeSpace Query/Sort/TemporalRange -> HomeMew migration. The historical filename is retained because existing issues/PRs already link to it. Chat history is not required to continue the work.

## 0. Why this migration exists / 为什么要做

The primary change is upstream in **LifeSpace**, not in the Mini Program.

LifeSpace Query and time semantics are converging on:

```text
Canonical Query
= Search
+ Filter
+ Sort
+ Cursor Pagination
```

with typed operators, nested Boolean filters, explicit `local_date_window`, stable effective sort/cursor behavior, and first-class `TemporalRange`.

For HomeMew Event specifically, the long-term LifeSpace resource truth changes from the current Calendar split representation:

```text
isAllDay
startAt / endAt
startTimezone / endTimezone
startDate / endDateExclusive
```

to one canonical temporal value:

```text
when: TemporalRange
  -> kind=date    + [start, endExclusive)
  -> kind=instant + [start, endExclusive)
```

This platform evolution is desirable, but it exposes a release-coupling problem:

- HomeMew Web is server-controlled and can track the current LifeSpace contract directly.
- Mini Program releases are review-constrained and old versions can remain active while LifeSpace evolves.
- Therefore the Mini Program must stop depending directly on LifeSpace wire details before the breaking Event migration.

The BFF is an **application anti-corruption / release-lag boundary**. It is not introduced to replace LifeSpace, duplicate authorization, or create another business Core.

## 1. Authority chain / 权威链

Future sessions must use the following precedence when documents disagree.

### 1.1 LifeSpace platform semantics — authoritative

Repository source of truth:

1. `huangshirui/LifeSpace/docs/canonical-query.md`
2. `huangshirui/LifeSpace/docs/time-space-semantics.md`
3. `docs/model-definition-spec.md` and generated Model Contract behavior where relevant
4. current Runtime implementation and automated tests
5. LifeSpace issue #234 for the compatibility-classified Event resource/storage migration

Confirmed upstream state as of 2026-09-16:

- Canonical Query composition is Search / Filter / Sort / Cursor Pagination.
- Query is single-model; adapters do not expose Standard Query vs Capability Query as competing public concepts.
- typed scalar/range/list predicates and nested AND/OR are implemented.
- direct `temporal_range` CRUD is implemented.
- TemporalRange filter/local-date-window is implemented.
- TemporalRange sort/cursor with explicit `context.viewingTimezone` is implemented.
- Calendar-backed Event still uses a compatibility `when` projection; Event resource/storage migration remains open in #234.

### 1.2 LifeSpace Notion — confirmed design/rationale, not implementation source

Relevant pages:

- `09 · Query 语义与能力设计`
- `10 · 时间与空间语义设计`

These pages explain the confirmed design and seven-layer reasoning. If they diverge from current repository Specification / Contract / Runtime, investigate and synchronize rather than silently choosing one.

### 1.3 HomeMew application architecture — authoritative for product boundary

Use:

- `docs/decisions/2026-09-16-miniprogram-final-bff-boundary.md`
- `docs/architecture.md`
- `docs/product-rules.md`
- root and nested `AGENTS.md`
- current client/BFF tests and implementation

HomeMew may define stable product DTOs and routes, but it must not redefine LifeSpace query/time semantics.

### 1.4 This plan — execution state only

This file owns:

- phase order;
- current progress;
- gates;
- exact next action;
- evidence and blockers.

It does not override platform or accepted architecture semantics.

## 2. Cross-repo target architecture / 目标架构

### 2.1 Mini Program

```text
WeChat Mini Program
  -> HomeMew production front door
       -> final stable Mini-facing HomeMew BFF contract
            -> LifeSpace Core Service Binding
            -> LifeSpace Identity Service Binding
       -> /api/v1/login/wechat
            -> HOMEMEW_BACKEND Service Binding
            -> WeChat provider trust + LifeSpace token exchange
```

The Mini Program may still hold the short-lived LifeSpace user bearer, but normal runtime code must not address public LifeSpace Core/Identity URLs or wire paths after the one-time migration.

### 2.2 BFF

The BFF owns only application adaptation:

```text
HomeMew Mini DTO / route
  -> fixed route handler
  -> HomeMew <-> LifeSpace mapping
  -> current LifeSpace contract
```

It may temporarily map the same final Mini contract to old/new LifeSpace upstream contracts during rollout.

It must never own:

- household business persistence;
- Space/model authorization truth;
- a second user/role permission table;
- arbitrary upstream URLs/paths;
- a generic unrestricted proxy.

### 2.3 Web

HomeMew Web remains a direct consumer of the **current LifeSpace application contract** through its own same-origin session/BFF boundary. It does not consume the Mini compatibility DTO merely for consistency.

HomeMew Web has no dedicated staging environment going forward. This rule applies only to HomeMew Web, not LifeSpace staging or unrelated test environments.

## 3. Query/Sort/Time semantics HomeMew must preserve / 不得在 BFF 中改写的平台语义

The Mini-facing DTO may be simpler than Canonical Query, but BFF lowering must preserve observable semantics.

### Query

- Search / Filter / Sort / Pagination are orthogonal and may coexist.
- Search is retrieval, not a synthetic filter predicate.
- nested Boolean Filter exists at the platform layer even if common Mini routes expose only product-friendly filters.
- `containsAny` / `containsAll`, if exposed by HomeMew, are conveniences that lower deterministically to Canonical `contains` Boolean expressions.

### Sort

- platform fallback without caller sort is `createdAt DESC`.
- business ordering must be explicit, e.g. Event `when ASC` or Task `dueDate ASC`.
- multi-sort order is significant.
- NULL sorts last in either direction.
- LifeSpace appends stable record `id` as final continuation tie-breaker.
- Mini APIs must not promise ordering that the BFF does not request explicitly upstream.

### Time

- Date is not Instant.
- stored Instant remains absolute; viewing timezone is context.
- ranges are half-open `[start, endExclusive)`.
- local-day intent becomes explicit date bounds + IANA timezone before Canonical execution.
- TemporalRange Date/Instant mixed sorting requires explicit viewing timezone.
- Event's eventual `when` TemporalRange is the single truth; `isAllDay` must not survive as independent platform truth after cutover.

## 4. Non-negotiable rollout invariants / 不可破坏的边界

- LifeSpace remains sole source of truth for Identity, Spaces/Grants, models and authorization.
- The final Mini-facing API is a HomeMew product contract, not a mirror of LifeSpace REST/Model Contract internals.
- The Mini Program migrates to that final BFF contract **once before review**.
- After review, platform migration changes only HomeMew BFF internal adapters and HomeMew Web's direct platform consumption.
- Phase 5 changes BFF compatibility code only; it does not change Mini Program code.
- BFF -> LifeSpace uses Cloudflare Service Bindings where supported.
- LifeSpace user bearer/authority semantics remain unchanged by Service Binding transport.
- PR #77 is not the current implementation branch; it is Phase-4 source material only.
- LifeSpace #234 Event breaking migration stays gated until the final-BFF Mini review candidate is approved and production-active.
- No broad runtime implementation begins while normative HomeMew docs contradict this target.

## 5. Current state / 当前状态

Last verified: 2026-09-16

| Area | State | Evidence / Note |
| --- | --- | --- |
| LifeSpace Canonical Query semantics | ✅ Platform foundation complete | `docs/canonical-query.md`; Query composition/filter/sort/cursor implemented |
| LifeSpace TemporalRange CRUD/filter/sort | ✅ Complete | LifeSpace #247/#248/#249; summarized in #234 |
| LifeSpace Event resource/storage migration | ⏸ Gated | #234 open; current Event still Calendar split truth |
| Final HomeMew BFF architecture decision | ✅ Accepted | `2026-09-16-miniprogram-final-bff-boundary.md` |
| Durable rollout tracking | ✅ | HomeMew #79 + this plan |
| Event-only BFF precursor | ✅ Merged | HomeMew #74 |
| HomeMew normative documentation alignment | ✅ Phase 0 complete | root/nested AGENTS, architecture/product rules, READMEs and historical decisions aligned in PR #82 |
| Full Mini -> LifeSpace runtime call inventory | ✅ Complete | Source-derived inventory at `docs/plans/2026-09-16-miniprogram-runtime-call-inventory.md` |
| Final cross-surface Mini BFF route/DTO map | ✅ Design baseline complete | Every observed runtime dependency has a bounded product route/DTO and current/Phase-4 adapter note |
| BFF -> LifeSpace Service Bindings | 🟡 Targets verified | production services are `lifespace-core` and `lifespace-identity`; implementation not started |
| HomeMew Web staging retirement | ⬜ Phase 1 | normative docs now mark production-only target; workflow/config/runtime cleanup remains |
| One-time Mini migration | ⬜ Not done | Phase 2 |
| WeChat review | ⬜ Not done | Phase 3 |
| Event new-contract cutover | ⏸ Gated | HomeMew #77 is Draft/Phase 4 only |
| Compatibility cleanup | ⬜ Not started | Phase 5 |

## 6. Phase 0 — Documentation and architecture alignment / 文档先收口

### Objective

Remove contradictory normative guidance before implementation continues.

This is a **Hard Gate** because repository `AGENTS.md` explicitly requires these documents to be read before code changes. A new session must not be forced to guess which conflicting instruction is newer.

### 6.1 HomeMew document synchronization matrix

| Document | Required correction |
| --- | --- |
| `AGENTS.md` | Replace Event-only/direct-LifeSpace Mini rule with final all-runtime Mini BFF boundary; reference active 2026-09-16 decision/plan; preserve LifeSpace authority/no-second-Core rules |
| `apps/miniprogram/AGENTS.md` | Remove two-normal-request-path design as target; normal Mini runtime goes through final HomeMew BFF; login remains HomeMew provider route; prohibit public LifeSpace base/path dependencies after migration |
| `docs/architecture.md` | Update target topology; distinguish Web same-origin session BFF from Mini application-contract BFF; document transition state vs final state; document Service Binding transport; remove active Web staging as target |
| `docs/product-rules.md` | Update Mini behavior section from direct Core calls to stable BFF; retain token refresh, authorization, time/date/concurrency semantics |
| `README.md` | Update current architecture diagram and production topology so first repository entry does not describe direct Mini -> LifeSpace business calls |
| `apps/miniprogram/README.md` | Replace retired HomeMew Core/cloud-function/direct-Core architecture wording with current LifeSpace + HomeMew BFF/provider flow |
| `apps/web/README.md` | Separate browser Web BFF restrictions from bounded Mini BFF routes hosted by the same Worker; remove staging as active target; keep production gates |
| `docs/decisions/2026-09-15-miniprogram-bff-contract-boundary.md` | Add explicit superseded banner for Event-only scope/release sequence; retain historical rationale/security invariants |
| `docs/decisions/2026-09-16-miniprogram-final-bff-boundary.md` | State Query/Sort/TemporalRange convergence as primary trigger and review lag as rollout constraint |
| `docs/web-staging-acceptance.md` | Mark historical/retired once staging removal is executed; do not leave it looking like current release procedure |
| this living plan | Maintain current phase/evidence/next action after every significant session |

### 6.2 LifeSpace documentation verification

Do **not** rewrite already-correct LifeSpace semantics merely to mention HomeMew.

Verify instead:

- `docs/canonical-query.md` remains aligned with Notion 09 and current Runtime/tests;
- `docs/time-space-semantics.md` remains aligned with Notion 10 and current Runtime/tests;
- #234 remains the explicit Event resource/storage migration tracker;
- future Query/Time work sessions read those two documents before changing query/time behavior.

If a concrete drift is found, fix the owning LifeSpace spec/runtime/tests together under LifeSpace's own `AGENTS.md`; do not patch around it in HomeMew.

### Phase-0 completion gate

Completed on branch `codex/phase-0-final-bff-doc-alignment`:

- [x] required HomeMew docs describe one consistent target architecture;
- [x] old 2026-09-15 Event-only rollout is visibly historical/superseded where conflicting;
- [x] current docs clearly distinguish transition state from final state;
- [x] LifeSpace Canonical Query/Time specs are linked as upstream authority;
- [x] HomeMew #79 points to this plan;
- [x] repository scan covered all Markdown/YAML files and found no unmarked current guidance that normal Mini business traffic should continue direct to LifeSpace;
- [x] active HomeMew Web staging wording in normative docs was removed or marked historical; workflow/config retirement remains explicitly assigned to Phase 1.

## 7. Phase 1 — Final BFF contract + current-LifeSpace compatibility

### 7.1 Inventory every Mini runtime dependency

Generate the list from **current source**, not documentation.

Cover at least:

- WeChat login / token acquisition;
- current-user profile/avatar and Identity operations;
- family/Space list/create/detail/update/close/leave;
- members and roles;
- invitation preview/create/join/revoke flows actually present;
- Event list/get/create/update/delete;
- Task list/get/create/update/complete/reopen/delete;
- Day Record operations;
- Wish operations;
- Creation Draft / `喵一下`;
- Access-link challenge confirmation;
- media upload/read paths;
- deep-link/notification detail loads;
- shared request helpers capable of selecting LifeSpace directly.

The output must record for every call:

```text
Current Mini source file/function
Current target: HomeMew / LifeSpace Core / LifeSpace Identity
Current method/path
Current request/response DTO
Auth requirement
Product semantics
Final HomeMew BFF route
Final Mini DTO
Current LifeSpace adapter target
Phase-4 new LifeSpace adapter target if known
```

### 7.2 Design the final Mini-facing contract

Rules:

- route and DTO are HomeMew product semantics;
- do not leak Canonical AST merely because Core supports it;
- expose only filters/sorts actually needed by Mini product flows, but define their semantics precisely;
- lower them deterministically to the active LifeSpace Query contract;
- preserve `familyId`, member/attendee/assignee product terminology where useful;
- keep LifeSpace IDs opaque;
- preserve optimistic concurrency/version rules;
- preserve Date/Instant/half-open-range/timezone semantics;
- no client-controlled upstream URL/path;
- no arbitrary generic model proxy.

Add contract tests before broad route implementation.

### 7.3 Implement current-LifeSpace adapters

The BFF must initially implement the final Mini contract against **current production-compatible LifeSpace**.

Temporary internal mappings may include:

- Event split Calendar fields;
- current compatibility GET parameters;
- old upstream DTO shapes.

These mappings are temporary upstream adapters, not Mini API semantics.

### 7.4 Switch Core/Identity transport to Service Bindings

Read actual LifeSpace production Worker service names/config before editing HomeMew wrangler files; do not guess.

Requirements:

- preserve user bearer;
- preserve method/body/multipart semantics;
- preserve/propagate request IDs;
- preserve error envelopes/statuses/timeouts;
- no arbitrary fallback target;
- any temporary public-URL fallback must be explicit and scheduled for removal.

### 7.5 Retire HomeMew Web staging

Remove only HomeMew Web staging deployment/config/workflow and current-procedure documentation.

New Web/BFF release path:

```text
local tests/typecheck/build
-> CI
-> explicit production deployment
-> production smoke verification
```

### Phase-1 progress

- [x] source-derived runtime inventory, including startup, deep links, shared helpers, assets, uploads, and diagnostics;
- [x] final bounded route/DTO design for every observed dependency;
- [x] current and known Phase-4 LifeSpace adapter targets verified against Runtime/contracts;
- [x] production Worker service names verified: `lifespace-core`, `lifespace-identity`;
- [x] contract-test matrix and Web staging retirement plan recorded;
- [ ] fixed-router/binding contract tests and implementation;
- [ ] current-LifeSpace adapters for all final routes;
- [ ] one production-compatible Event old/new adapter seam;
- [ ] HomeMew Web staging workflow/config retirement;
- [ ] BFF/Web checks and production smoke evidence.

### Phase-1 gate

- full call inventory exists;
- every used Mini dependency has a final HomeMew route/DTO;
- final routes work against current LifeSpace contract;
- Core/Identity Service Bindings are wired where supported;
- arbitrary-proxy/authority deny tests pass;
- HomeMew Web staging is retired;
- BFF/Web checks pass.

## 8. Phase 2 — One-time Mini Program migration

### Objective

Change Mini exactly once to consume the final HomeMew BFF contract.

### Work

- migrate shared request/service layers;
- remove direct public LifeSpace Core/Identity route selection;
- remove stored/returned LifeSpace public service URLs if no supported Mini flow still needs them;
- preserve short-lived LifeSpace user bearer and refresh flow;
- migrate all deep-link/startup flows to the same boundary;
- keep UI/page DTO behavior stable except deliberate final-contract changes.

### Architectural regression gate

Add a durable check that fails when production Mini source reintroduces direct LifeSpace addressing. Prefer dependency/boundary assertions; supplement with hostname/path scans.

### Manual smoke coverage

At minimum:

```text
login / refresh
first-use profile
family create/join/switch/detail/manage
members / invitations
events
tasks
day records
wishes
Creation Draft / 喵一下
Web-link challenge confirmation
avatar/media paths
notification/deep-link entries
direct startup into business page
```

### Phase-2 gate

- no normal Mini runtime call addresses public LifeSpace Core/Identity directly;
- all supported flows use final BFF routes;
- Mini tests/typecheck/build pass;
- Web/BFF tests pass;
- WeChat Developer Tools smoke passes;
- real-device smoke passes;
- review candidate contains no temporary upstream compatibility semantics.

## 9. Phase 3 — WeChat review / 契约冻结

Submit the Phase-2 build.

During review:

- freeze Mini-facing route/DTO contract;
- allow only backward-compatible server fixes unless review itself requires a client change;
- do not perform LifeSpace Event breaking resource migration;
- prepare Phase-4 upstream cutover behind the frozen contract.

Gate: submitted build is approved and production-active.

## 10. Phase 4 — LifeSpace + BFF + Web coordinated cutover

### Preconditions

- Phase 3 complete;
- LifeSpace #234 migration/backfill/contract verification ready;
- #77 re-evaluated/rebased against current main and final BFF contract; reuse only still-correct work.

### Target

```text
Approved Mini
  -> unchanged final HomeMew BFF contract
       -> new LifeSpace Query/Event/TemporalRange contract

HomeMew Web
  -> current LifeSpace contract directly through Web session/BFF boundary
```

### Required LifeSpace outcomes

- Event published resource truth becomes canonical `when: temporal_range` according to #234.
- Event data migration/backfill is explicit and verified.
- Canonical Query over direct TemporalRange becomes the normal Event query path.
- compatibility Calendar planners/routes are not retired until traffic/consumer evidence says they are unused.

### Rolling deployment safety

Do not assume physical atomicity across Workers/repos.

Preferred sequence:

1. deploy BFF capable of safely tolerating required old/new upstream window;
2. deploy LifeSpace migration/new contract according to #234;
3. verify BFF switches to new upstream adapter while Mini contract remains identical;
4. deploy/verify HomeMew Web against current platform contract;
5. inspect production evidence before cleanup.

## 11. Phase 5 — Remove BFF compatibility redundancy only

Remove only compatibility that exists for the old LifeSpace upstream contract, e.g.:

- Event split-time mapping;
- old query parameter translators;
- legacy upstream DTO mapping;
- temporary old/new detection or fallback;
- compatibility-only tests/metrics.

Retain tests for the stable Mini-facing contract.

**No Mini Program code change belongs to Phase 5.**

Final state:

```text
Mini contract unchanged since review candidate
BFF has one current LifeSpace adapter path
LifeSpace Canonical Query + direct Event TemporalRange are authoritative
HomeMew Web consumes current LifeSpace contract
old upstream compatibility removed
```

## 12. Explicit do-not-do list / 防走偏清单

Do not:

- continue broad BFF implementation before Phase 0 doc alignment;
- infer Mini dependencies from old README/product docs instead of source;
- treat PR #77 as current architecture authority;
- change Mini to canonical `when`/Query AST because LifeSpace uses them;
- invent a HomeMew platform query language parallel to Canonical Query;
- put product-specific compatibility into LifeSpace merely for WeChat release lag;
- keep both public-URL and Service-Binding upstream paths permanently without an explicit need;
- remove LifeSpace compatibility before active-consumer evidence allows it;
- remove HomeMew Web staging rules from unrelated LifeSpace staging;
- encode authorization in BFF role checks instead of LifeSpace;
- persist household truth in HomeMew BFF/backend;
- change the Mini again during Phase 5 cleanup.

## 13. Current blockers / 当前阻塞

No external blocker prevents Phase 1.

Phase 0 documentation drift is resolved in merged PR #82. The Phase-1 source-derived inventory and final route/DTO design baseline now exist at `docs/plans/2026-09-16-miniprogram-runtime-call-inventory.md`.

No external blocker prevents the first implementation slice. The main correctness risks are accidentally introducing a generic proxy, returning public LifeSpace avatar URLs, changing cursor semantics through client/BFF post-processing, or moving Person/time mapping into the Mini. Contract and deny tests must land before broad route implementation.

The existing HomeMew Web staging workflow/config remains a known Phase-1 retirement item. Its presence is implementation evidence to remove, not current release authority.

## 14. Exact next action / 下一步动作

**Implement the first test-first BFF foundation slice against the completed inventory; do not change Mini runtime calls yet.**

On branch `codex/phase-1-mini-bff-contract-inventory` (or a successor based on its merged result):

1. review `docs/plans/2026-09-16-miniprogram-runtime-call-inventory.md` against the current branch diff and keep it as the route/DTO baseline;
2. add fixed-router contract and deny tests covering unknown routes, arbitrary upstream URL/path/model selection, bearer/request-ID propagation, upstream error preservation, and avatar URL rewriting;
3. introduce a shared Core/Identity Service-Binding adapter with explicit targets only, using HomeMew binding names `LIFESPACE_CORE` and `LIFESPACE_IDENTITY`;
4. add those bindings in the production Wrangler config to `lifespace-core` and `lifespace-identity`;
5. implement the first vertical route slice for current-user profile, access-link confirmation, user/family avatar read/upload, and the required URL rewriting, preserving existing Mini DTOs;
6. keep the existing Event-only route working during this server-side slice; do not migrate Mini callers yet;
7. run Web/BFF tests and update this plan plus HomeMew #79 with exact evidence and the next adapter slice.

Do not merge PR #77, start LifeSpace #234's breaking Event migration, remove LifeSpace compatibility, or alter Mini runtime addressing in this slice.

## 15. Session handoff template / 每轮交接模板

At the end of every significant work session, update this file and mirror a concise version to HomeMew #79:

```text
Date:
Branch / PR:
Phase:
Completed:
Evidence (tests/commits/PRs):
Authority docs checked:
Changed assumptions/decisions:
Remaining:
Blockers:
Exact next action:
Do not do yet:
```

The **Exact next action** must be specific enough that a new conversation can continue from repository state without asking for chat history.

## 16. Session log

### 2026-09-16 — Phase 1 inventory and contract baseline

- Branch: `codex/phase-1-mini-bff-contract-inventory`
- HomeMew inspected at: `6106552311bbfc3d06a5f07a95b11fc0092f035c`
- LifeSpace inspected at: `cd25c8bb0f88f503f5c7a4a48f90ffed53727c0a`
- Completed: full Mini runtime call inventory; final route/DTO map; query lowering matrix; avatar/media and diagnostic boundary coverage; production Service Binding targets; contract-test matrix; Web staging retirement plan.
- Evidence: `docs/plans/2026-09-16-miniprogram-runtime-call-inventory.md`
- Authority checked: HomeMew root and Mini AGENTS, architecture/product rules, accepted decision/plan; LifeSpace root/apps/Core/Identity constraints, Canonical Query/time specs, OpenAPI/Runtime/model definitions/tests, #234.
- Changed assumptions: avatar asset URLs and the About-page Core latency probe are runtime dependencies and must cross the final BFF; they are not exceptions.
- New architecture/product decision: none; this applies the accepted 2026-09-16 boundary, so no Notion decision-log append is required.
