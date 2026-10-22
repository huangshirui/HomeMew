# HomeMew System Architecture

## 1. Positioning

HomeMew is a household application built on LifeSpace. LifeSpace is the platform source of truth for Identity, Spaces/authorization, domain models, Actions, contracts, migrations and business data. HomeMew owns household product UX plus provider-specific application integration.

From LifeSpace's perspective, **HomeMew is one Application**. Mini Program, Web/PWA, BFFs, Workers, the WeChat provider adapter and integration orchestration are HomeMew implementation/deployment boundaries and are not separate LifeSpace Application identities. This boundary is fixed by `docs/decisions/2026-10-08-single-lifespace-application.md`.

The legacy HomeMew business Core was retired from the active repository on 2026-08-26 after the completed LifeSpace production migration/cutover. Git history is the archive for its old implementation, OpenAPI and migrations; new HomeMew business behavior must use LifeSpace rather than recreate a local Core.

## 2. Target context

```text
LifeSpace Application: HomeMew

WeChat Mini Program
  ├─ wx.login code ───────────────> HomeMew production front door
  │                                  └─ /api/v1/login/wechat
  │                                       -> HOMEMEW_BACKEND Service Binding
  │                                       -> WeChat jscode2session
  │                                       -> Durable Object: openid -> LifeSpace usr_*
  │                                       -> LifeSpace Identity token exchange
  └─ all normal runtime + bearer ─> stable HomeMew Mini BFF contract
                                     -> fixed HomeMew adapter
                                     -> LifeSpace Identity/Core Service Bindings

HomeMew Web browser
  -> Cloudflare Access
  -> HomeMew Web Worker / same-origin Web session BFF
      ├─ original Cf-Access-Jwt-Assertion
      ├─ HomeMew Application lsa_* credential
      ├─ LifeSpace Identity Access principal exchange/linking
      ├─ signed host-only HttpOnly application session
      └─ current LifeSpace Identity/Core contract

HomeMew-managed external system ext_*
  ├─ optional Service Access -> LifeSpace Service Principal svc_*
  ├─ optional Agent Access   -> LifeSpace Agent agt_*
  └─ optional Event Push     -> LifeSpace Webhook Endpoint / subscriptions
```

The Mini BFF and Web same-origin BFF are distinct HomeMew contracts even when hosted by the same production Worker. The Mini BFF is a stable HomeMew product/anti-corruption boundary for a review-constrained downloadable client; the Web BFF is a browser trust/session boundary whose server-controlled implementation follows the current LifeSpace contract. Neither persists household business truth or duplicates LifeSpace authorization. These boundaries do not create separate LifeSpace Applications.

After Phase 2, Mini runtime code does not address public LifeSpace Core/Identity URLs or wire routes. BFF-to-LifeSpace calls use Cloudflare Service Bindings where supported while preserving the LifeSpace user bearer, request IDs, errors, timeouts and authoritative checks. There is no WeChat Cloud Development dependency and no second HomeMew business Core.

External-system administration is an advanced HomeMew Web capability. The Mini Program remains a lightweight household client and does not create, configure, rotate, revoke or display service/Agent credentials or Data Grants. This product boundary remains Web-only; the newer container semantics are fixed by `docs/decisions/2026-10-09-external-system-capability-container.md`.

A HomeMew Application may own multiple active `lsa_*` credentials when operationally useful for independent deployment, zero-downtime rotation or independent revocation. Credential count is not client count. The provider backend and Web Worker may therefore use different `lsa_*` values while still representing the same canonical HomeMew Application.

### Runtime deployment environments (2026-10-22)

The current policy is `docs/decisions/2026-10-22-fixed-deployment-environments.md`, superseding the earlier URL-based staging selector.

- **One HomeMew Web Worker project**: `homemew-web-production` Production code always binds LifeSpace Production; its separate named Worker Preview code always binds LifeSpace Staging. Preview is an isolated *code deployment* within the same Worker project, not a second Web Worker or an alternate UI feature mode.
- **Two HomeMew backend Workers retained**: `homemew-backend-production` and `homemew-backend-staging`, with independent Durable Object identities/catalog/coordination state. Web Production binds the former; Web Preview binds the latter.
- **Mini development/trial/release** always use the existing production front door and the stable BFF, reaching LifeSpace Production. Testing LifeSpace schema-breaking changes uses Web Preview + LifeSpace Staging; released Mini compatibility must be explicitly verified before a production platform migration.
- Neither Web nor Mini accepts `?env=staging` as an environment selector; the old `/_stage/*` API routes have been retired. Environment authority comes only from the trusted Worker deployment configuration. Preview hosts must be protected by Access and its audience registered against the staging HomeMew Application.

## 3. HomeMew Cloudflare application backend

`apps/backend/` is a narrow trusted HomeMew application backend, not a second business Core and not the Web Access-principal authority.

Responsibilities include:

- receive a one-time `wx.login()` code;
- call the WeChat `jscode2session` server API with the server-only app secret;
- resolve and persist `openid -> LifeSpace user_id` in a HomeMew-owned SQLite-backed Durable Object;
- create a LifeSpace Identity user when the provider identity is first seen;
- authenticate as the canonical HomeMew LifeSpace Application using a server-only `lsa_*` credential;
- request a short-lived LifeSpace user token and return it to the Mini Program;
- persist narrow HomeMew application metadata such as Family Catalog classification and External System `ext_*` containers.

The WeChat identity Durable Object is keyed by `WeChat appid + openid`, so each external identity has its own coordination/storage unit. Concurrent first-login requests to the same live object share one in-flight user-creation promise before the mapping is persisted. A dedicated HomeMew D1 is intentionally not provisioned for this small identity mapping.

This removes the D1 database-slot cost while retaining strongly consistent per-identity storage. There is still a narrow crash window between a successful LifeSpace user creation and the Durable Object storage write; eliminating that window completely would require an idempotency contract on the LifeSpace user-creation API and therefore is not implemented as a HomeMew-only workaround.

The backend must not persist Spaces/families as business truth, events, tasks, day records, wishes, LifeSpace Data Grant copies or duplicate LifeSpace authorization. HomeMew application metadata may reference LifeSpace IDs but must not become an alternate authorization source.

Required secrets/configuration:

- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `LIFESPACE_APPLICATION_CREDENTIAL`
- `LIFESPACE_IDENTITY_URL`
- `LIFESPACE_CORE_URL`
- Durable Object binding `WECHAT_IDENTITIES`
- Durable Object binding `EXTERNAL_SYSTEM_CATALOG`

The Mini Program never receives `openid`, the WeChat app secret, or the LifeSpace application credential.

## 4. Mini Program identity flow

```text
Mini Program
-> wx.login()
-> POST HomeMew /api/v1/login/wechat { code }
-> WeChat jscode2session
-> trusted openid
-> resolve HomeMew WechatIdentity Durable Object
-> if mapping absent: POST LifeSpace Identity /internal/v1/users
-> persist openid -> LifeSpace user_id mapping in Durable Object
-> POST LifeSpace Identity /internal/v1/tokens
-> { accessToken, expiresAt, coreApiUrl, identityApiUrl }
```

An existing mapping is authoritative. If LifeSpace later refuses token issuance for a mapped user, HomeMew does not silently create a replacement user and overwrite the mapping; the inconsistency must be investigated instead.

The access token represents the LifeSpace user, has the canonical HomeMew Application as its authorized party, and carries only the scopes granted to that Application. Token refresh repeats this flow with a fresh WeChat code.

### 4.1 Direct-entry startup and silent identity recovery

The Mini Program has no application-level Logo/splash routing page. `pages/home/home` is the default page, while WeChat deep links, shares, notifications, QR codes and enterprise-WeChat entries may open any registered target page directly.

`App.onShow` starts runtime preparation in parallel with the requested page. Short-lived token expiry is never modeled as a user-visible login state: all callers share one in-flight `wx.login() -> HomeMew backend -> LifeSpace token exchange` operation. User/profile and accessible-family initialization is also single-flighted so the App coordinator and the target page do not duplicate startup requests.

A first-seen WeChat identity is created immediately as a usable LifeSpace user with a HomeMew-assigned placeholder display name (`微信用户xxxxxx`). A missing uploaded avatar is presented with the Mini Program's local default avatar. First entry is never blocked on profile editing: the requested business page remains visible and usable, including deep links. The user may later open “我的 → 编辑资料” to replace the nickname or avatar; a saved nickname must remain non-empty, while avatar customization is optional. Disabled accounts still use the dedicated disabled-state page; ordinary network/service failures stay on the requested page and use that page's retry/error UI.

Non-idempotent writes are never blindly replayed after a 401. The client may silently refresh credentials so the next explicit user retry uses a fresh token.

## 5. HomeMew Web authentication and BFF

`apps/web/` is the HomeMew browser application plus its same-origin BFF. It is separate from `apps/backend/` as a HomeMew implementation/trust boundary because Cloudflare Access is a Web authentication boundary, while WeChat `openid` remains application-provider mapping owned by the Mini Program adapter. This separation does not create another LifeSpace Application.

Target Web stack:

- React + TypeScript;
- Vite + the official Cloudflare Vite plugin;
- Cloudflare Worker serving the Web assets and same-origin API/BFF;
- Cloudflare Access protecting the Web application;
- LifeSpace Identity with Access principal verification, audience registration, exchange and account linking.

Authentication flow:

```text
Browser
-> Cloudflare Access login / SSO
-> HomeMew Web Worker receives Cf-Access-Jwt-Assertion
-> Worker authenticates to Identity with a HomeMew Application lsa_*
-> POST /internal/v1/access/tokens
-> Identity independently verifies Access JWT signature / issuer / expiry / audience
-> Identity resolves verified (iss, sub) -> global usr_*
-> Identity issues short-lived HomeMew-scoped LifeSpace user token
-> Web Worker stores it only in a signed host-only HttpOnly application session
-> browser calls same-origin /api/lifespace/* BFF paths
-> BFF calls LifeSpace Identity/Core with the LifeSpace user bearer
```

The Web BFF never accepts a browser-supplied `sub`, Access email or target LifeSpace `userId` as identity authority. It forwards the original Cloudflare Access assertion only to the approved Identity Access exchange/linking contract. It does not maintain its own Access principal mapping table.

The HomeMew application session uses a dedicated `WEB_SESSION_SECRET`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and no parent-domain `Domain` attribute. The signed session is bound to a SHA-256 fingerprint of the Access assertion that produced it. If the current Access assertion changes, the old LifeSpace bearer is not reused; the BFF performs a new Identity exchange. This prevents a stale HomeMew session from crossing an Access-user switch in the same browser.

State-changing same-origin BFF/proxy routes require an exact `Origin` match. This remains necessary because cookie SameSite behavior is not an application authorization boundary between sibling subdomains.

Normal Web sessions intentionally do not carry `grants:manage`. `/api/integrations*` performs fresh privilege-on-demand Access exchanges for the narrow management scopes required by each operation. Core independently requires current `manage` authority on the selected family Space before HomeMew may manage Service/Agent Grants or Eventing. The trusted backend call uses the same canonical HomeMew Application context as ordinary Web exchange. This is not a second HomeMew role check or a second Application identity.

For compatibility with the existing integration orchestration modules, the Web front door currently exposes `LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL` as an internal alias of `LIFESPACE_APPLICATION_CREDENTIAL`. The alias is not a separately provisioned secret source and must not be interpreted as a synthetic integrations Application.

For HomeMew, an unknown Access principal has exactly one onboarding path: link the already-existing HomeMew/LifeSpace account through the Mini Program. HomeMew Web does not expose LifeSpace Access registration and does not create a new LifeSpace user. LifeSpace Identity may retain explicit Access registration as a platform capability for other applications.

```text
unlinked Access principal
  -> Web creates Identity one-time link challenge
  -> already-authenticated Mini Program confirms challenge
  -> Identity derives usr_* from Mini Program bearer
  -> Identity binds the verified Access principal to that existing usr_*
  -> Web retries /api/session
```

The target user ID for account linking is never supplied by Web. Identity owns the Access-principal -> `usr_*` relationship. This HomeMew product policy is fixed by `docs/decisions/2026-08-25-web-existing-user-link-only.md`.

The final Web domain is `homemew.aisr.online`. Since the accepted production cutover on 2026-08-24, that hostname is owned by `homemew-web-production`: browser Web traffic and the same-origin BFF remain behind Cloudflare Access, while the exact `POST /api/v1/login/wechat` provider route uses an Access bypass and the `HOMEMEW_BACKEND` Service Binding to `homemew-backend-production`. Normal Web deployments do not implicitly move Custom Domain ownership; domain transfer/rollback remains a separately confirmed release operation. The dedicated HomeMew Web staging environment is retired by the 2026-09-16 final-BFF decision; production release now uses repository gates plus explicit production smoke verification. See `docs/decisions/2026-08-24-web-production-cutover.md`.

## 6. Household model mapping

HomeMew keeps product-friendly terms in the UI but maps them explicitly at the client service boundary:

| HomeMew | LifeSpace |
|---|---|
| family | HomeMew Family Catalog entry -> LifeSpace `Space` |
| family admin | Space `owner` / `admin` |
| writable member | Space `editor` |
| member reference in business models | Space Person |
| event | `event` model + Calendar capability |
| task | `task` model + Actions |
| day | `day_record` model + Temporal capability |
| wish | `wish` model + Actions |
| External System | HomeMew `ext_*` application container referencing optional LifeSpace access capabilities |

HomeMew services may expose `familyId`, `attendeeIds`, `assigneeIds` and similar product DTOs to pages, but translate them to Space IDs/Person IDs before calling LifeSpace.

The HomeMew Family Catalog is the sole product-classification authority for family Spaces. LifeSpace 0.39 no longer exposes `Space.kind`; HomeMew create/list/invite flows must not send, read or infer a family classification from the LifeSpace Space representation.

HomeMew's eight-active-member limit is enforced only on HomeMew membership-join flows. A `FamilyJoinCoordinator` Durable Object is keyed by LifeSpace `spc_*` and serializes invite revalidation, current LifeSpace membership count, and the final LifeSpace join call. It does not persist membership truth. LifeSpace remains authoritative for membership and permission; other generic LifeSpace Spaces are not subject to this product limit.

## 7. Normal Mini Program requests

```text
Mini Program
-> Authorization: Bearer <short-lived LifeSpace user token>
-> stable HomeMew Mini BFF route
-> fixed LifeSpace Identity/Core operation through an internal adapter
```

The shared Mini request client selects explicit HomeMew product routes only. The BFF adapter selects the current LifeSpace operation, parses/preserves standard LifeSpace envelopes and request IDs, enforces timeouts, and does not blindly retry non-idempotent writes.

`currentFamilyId` remains UI state only. LifeSpace Space membership and grant checks are authoritative.

## 8. Normal Web requests

```text
Browser
-> same-origin /api/lifespace/core/v1/* or /api/lifespace/identity/v1/*
-> HomeMew Web BFF resolves the current Access-bound application session
-> Authorization: Bearer <short-lived LifeSpace user token>
-> LifeSpace Core/Identity
```

The browser never receives the LifeSpace user bearer or any HomeMew `lsa_*` application credential. The BFF is a narrow authenticated transport boundary; it does not translate LifeSpace authorization into a separate HomeMew server authorization model.

## 9. Media

- Current-user avatar: `PUT LifeSpace Identity /api/v1/me/avatar`.
- Family avatar: `PUT LifeSpace Core /api/v1/spaces/{spaceId}/avatar`, including the current Space `version` in multipart data.
- Household images do not use WeChat Cloud Storage.

Web uploads go through the same-origin BFF and preserve the LifeSpace multipart contract rather than storing media in HomeMew.

## 10. Data ownership

HomeMew-owned Durable Object storage may hold narrow provider/application metadata such as the WeChat identity mapping, the Family Catalog (`spc_*` classification only), and External System containers (`ext_*`). It must not become an authoritative household data store.

An External System container stores only HomeMew-owned metadata (`ext_*`, owning `spc_*`, display name/description, audit timestamps) and optional references to LifeSpace identities (`servicePrincipalId`, `agentId`). It does not store credential plaintext, Data Grant copies, Webhook signing secrets or effective-authority snapshots.

The Web BFF may hold only short-lived browser application-session state and server-only application credentials; durable HomeMew application metadata is owned by the application backend. Neither may persist an Access-principal mapping, service/Agent token plaintext, a HomeMew integration permission table, or household business records.

Authoritative household data, Service Principal/Agent state, credentials, Grants, Eventing resources and authorization live in LifeSpace. Mini Program/browser storage is cache/UI state only.

For a Service Access child capability, the owning family Space is additionally recorded as a HomeMew-namespaced binding in the LifeSpace Service Principal description (`homemew:v1:space=<spc_*>`) because the current LifeSpace Service Principal schema has no application metadata field. This protects global credential management of that `svc_*`; it does not make the Service Principal the External System container.

A Data Grant by itself is deliberately **not** treated as credential-management ownership. Data Grants express what a Service or Agent may access; they do not prove which HomeMew family may rotate a globally usable service credential.

## 11. External systems

HomeMew owns the External System container; LifeSpace owns the authority-bearing capabilities referenced by that container.

```text
HomeMew External System ext_*  (application metadata)
├── Service Access (optional)
│   └── LifeSpace Service Principal svc_*
│       ├── one credential mode at steady state
│       └── model-scoped Service Data Grants
├── Agent Access (optional)
│   └── LifeSpace Agent agt_*
│       ├── Agent API credential
│       └── optional direct model-scoped Agent Data Grants
└── Event Push (optional)
    └── LifeSpace Webhook Endpoint + Event Subscription filters
```

The list/detail information architecture remains:

```text
/settings/integrations
  -> External System ext_* summary list

/settings/integrations/:externalSystemId
  -> basic HomeMew metadata
  -> Service Access
  -> Agent Access
  -> Event Push
  -> future system-specific capabilities
```

Creating `ext_*` is deliberately capability-free. It does not create a Service Principal, Agent, credential, Grant or Webhook. This lets a real-world external system use only the access modes it needs.

### 11.1 Service Access

Service Access is the machine/service identity capability:

```text
ext_*
  -> svc_*
      -> Service API Token or OAuth Client Credentials
      -> Application × Model Access
      -> current family model Data Grants
      -> LifeSpace Core
```

Rules:

- Service Access is optional and independent from Agent Access.
- New Service Access gets one independent Service Principal and one explicit owning family Space binding.
- Stable credential scopes remain `resources:read` / `resources:write`; model identity and permission remain in LifeSpace model access + Data Grants.
- New Service Access receives only explicit model-collection Grants, currently for `event`, `task`, and `day_record`; `wish` is not exposed in this slice.
- Steady state is one authentication mode (`api_token` or `oauth_client_credentials`) and one active credential. Controlled rotation temporarily permits old+new credentials until complete/cancel.
- Credential plaintext is one-time and never persisted by HomeMew.
- Removing Service Access disables the Service Principal first, revokes active service credentials/current-family Grants, cleans Event Push resources bound to that Service Principal, then clears `ext_*.servicePrincipalId` only after cleanup succeeds.
- Removing Service Access does not remove Agent Access.

The existing HomeMew namespaced Service Principal description binding remains a defense for credential-management ownership. A Data Grant from another Space does not transfer Service Principal management rights to that Space.

### 11.2 Agent Access

Agent Access is the AI Agent identity capability:

```text
ext_*
  -> agt_*
      -> lsp_agt_* Agent API credential
      -> optional direct model Data Grants
      -> direct Principal=Agent / Actor=Agent execution
      -> optional User Delegation for represented execution
```

Rules:

- Agent Access is optional and independent from Service Access.
- `ext_* -> agt_*` is stored directly in HomeMew application metadata; Agent identity is not encoded into a Service Principal description.
- Agent API credential scope is the technical read/write ceiling, not the actual per-model direct authority.
- Direct Agent Data Grants may all be absent when the Agent is intended to act only through explicit User Delegation.
- Agent credential plaintext is one-time and never persisted by HomeMew.
- Removing Agent Access revokes active Agent API credentials and current-family direct Agent Grants before clearing `ext_*.agentId`; Service Access/Event Push are unaffected.

### 11.3 Event Push

Event Push remains a separate product capability but has one current platform dependency: LifeSpace Webhook Endpoint requires a `subscriberServicePrincipalId` and re-checks that Service Principal's current model-read authority before delivery.

Therefore HomeMew currently requires Service Access before Event Push can be configured. This dependency is explicit in the UI; HomeMew does not create a hidden Service Principal just to support a Webhook.

```text
ext_*
  -> Service Access svc_*
  -> one Webhook Endpoint for current family Space + svc_*
       -> shared Webhook URL + signing secret
       -> Event Subscription filters for model + created/updated/deleted
       -> current subscriber Data Grant required for every selected model
       -> LifeSpace Eventing delivery
```

Webhook payloads remain reference-only. The external system uses its Service credential and current Data Grant to fetch full business records when needed. Event Subscription filters are not authorization Grants.

### 11.4 Security and lifecycle

- Only current family administrators may manage External Systems in HomeMew Web; LifeSpace Core still performs authoritative current Space `manage` checks for authority-bearing operations.
- The Mini Program exposes no external-system administration or secret handling.
- Container binding updates use compare-and-swap semantics to avoid lost updates when capability setup/removal races.
- Capability creation is a Saga: create LifeSpace authority first, bind the resulting ID to `ext_*` only after success, and compensate partial authority if binding fails.
- HomeMew keeps no duplicate event/service/Agent authority store.
- Historical platform identity rows are not physically deleted merely because a capability is removed; authority/credentials are revoked and the active HomeMew binding is cleared.
- The older `svc_*`-as-External-System implementation remains only as a bounded compatibility path for historical cleanup/tests; new UI and new production setup use `ext_*`.

The canonical HomeMew Application must include the scope ceiling and Application × Model Access needed by ordinary HomeMew behavior and enabled external-system capabilities. Normal ambient browser sessions still avoid elevated Grant-management scopes; integration operations use fresh privilege-on-demand exchanges and Core re-checks current Space authority.

Integration readiness is tied to the normal Web `LIFESPACE_APPLICATION_CREDENTIAL` plus the `HOMEMEW_BACKEND` Service Binding that owns the External System catalog. The old `LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL` name survives only as a front-door compatibility alias and is not a separately provisioned deployment secret.

Detailed decision: `docs/decisions/2026-10-09-external-system-capability-container.md`.

## 12. Migration/cutover rules

- Do not dual-write HomeMew Core and LifeSpace.
- Do not recreate the retired broad legacy `/api/v1/families/...` facade. The final Mini BFF may expose explicit HomeMew product routes, but never an arbitrary generic proxy or second business model.
- HomeMew production business data is authoritative in LifeSpace after the completed production cutover.
- HomeMew Web has no permanent dedicated staging release environment. The temporary Phase 4 review-window staging surface defined by `docs/decisions/2026-09-18-phase4-temporary-web-staging-validation.md` was retired after the successful Event v6 production cutover and Mini/Web smoke verification; normal releases use repository gates plus explicit production smoke verification.
- `apps/backend/` keeps application-owned provider mappings and narrow HomeMew metadata; `apps/web/` does not duplicate them.
- Production Web activation must not break the existing Mini Program `/api/v1/login/wechat` application-provider endpoint.
- The legacy HomeMew Core source is retired from the active repository. Any still-existing old HomeMew Worker/D1 resources remain frozen/read-only only for the explicit stabilization/rollback-evidence window and require a separate operations decision before physical deletion.
- The historical LifeSpace registrations for HomeMew Mini, HomeMew Web and HomeMew integrations are migration inputs only; canonical production uses one neutral HomeMew Application and its trusted backend credentials.
- Old Service-Principal-based HomeMew integrations are not automatically re-parented into `ext_*`. They may be disabled/revoked and the new External System container/capabilities recreated explicitly.
- Historical audit/application attribution is immutable and must not be rewritten.
- Deploy the backend containing `ExternalSystemCatalog` before or together with the Web release that starts using `ext_*`; Web readiness must fail closed when the backend catalog binding is unavailable.

## 13. LifeSpace change boundary

If HomeMew discovers a missing platform capability, finish independent HomeMew work and document the gap. Any LifeSpace repository modification requires explicit user approval first and must then follow LifeSpace's own `AGENTS.md`.
