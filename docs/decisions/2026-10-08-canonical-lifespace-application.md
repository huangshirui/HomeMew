# Decision: HomeMew uses one canonical LifeSpace Application

Date: 2026-10-08
Status: Accepted

## Decision

HomeMew is one product application and uses exactly one canonical LifeSpace `Application` access subject.

The canonical Application is named `HomeMew` and uses a platform-generated opaque `app_*` identifier. The identifier is configuration/provisioning state and must not be hard-coded into HomeMew client or BFF source.

The following HomeMew boundaries are **not** separate LifeSpace Applications:

- WeChat Mini Program;
- HomeMew Web/PWA;
- Mini BFF routes;
- Web same-origin BFF;
- `homemew-backend-*` provider backend;
- HomeMew external-system management orchestration;
- individual Worker/deployment units.

They are application-owned client, provider, BFF, deployment or capability boundaries inside the same HomeMew product.

## Credential model

Different trusted HomeMew backend deployments may keep separate active `lsa_*` credentials, but every such credential belongs to the same canonical HomeMew Application.

At minimum, production may use independently rotatable credentials for:

```text
HomeMew Web/session BFF
HomeMew WeChat provider backend
HomeMew external-system management orchestration
```

Separate `lsa_*` values provide secret isolation, independent deployment and revocation. They do **not** create separate Application identity, `azp`, scope ceilings or operator lifecycle.

The Web and provider backend may continue using the local environment name `LIFESPACE_APPLICATION_CREDENTIAL`. An integration-management-specific secret may remain separately named for operational clarity, but its credential must also belong to the canonical HomeMew Application and must not be described as an “integrations Application credential”.

No `lsa_*` is ever exposed to the Mini Program or browser JavaScript.

## Identity and channel behavior

Mini Program and Web authentication mechanisms remain deliberately different:

```text
Mini Program
  -> WeChat provider identity
  -> HomeMew backend openid -> usr_* mapping
  -> canonical HomeMew lsa_*
  -> LifeSpace user token with azp = HomeMew Application

Web
  -> Cloudflare Access
  -> HomeMew Web BFF
  -> canonical HomeMew lsa_*
  -> Access audience bound to the HomeMew Application
  -> LifeSpace user token with azp = HomeMew Application
```

The authentication mechanism is an entry-point concern. It does not create another LifeSpace Application.

The same natural user continues to resolve to one global LifeSpace `usr_*`. HomeMew does not maintain a second Access-principal mapping.

## External systems

A HomeMew external system remains one LifeSpace Service Principal with its own Service API Token or OAuth Client Credentials plus current Data Grants.

An external system is **not** a LifeSpace Application. HomeMew-created Service Principals belong to the canonical HomeMew Application and are managed by the Web-only integration UX defined in `2026-08-24-external-integrations-web-only.md`.

The previously separate `HomeMew integrations` Application is retired by this migration. Existing external-system principals/credentials under that legacy Application are not migrated across Application ownership. They are revoked/disabled during cutover and recreated under the canonical HomeMew Application after the new boundary is live.

This intentionally avoids inventing cross-Application principal migration semantics solely for historical HomeMew topology.

## Scope and model-access policy

Because Application is now the product-level boundary, the canonical HomeMew Application owns the union of platform capabilities legitimately required by HomeMew entry points and trusted backends.

This includes the ordinary HomeMew user/session scopes, the narrow `grants:manage` capability required for fresh integration-management user exchanges, and the stable resource scopes/model access required to create HomeMew-managed Service Principals.

This union is an Application **ceiling**, not ambient user authority. Every request still requires the relevant verified User/Service/Agent principal, current credential scope, Application × Model Access, Space membership/Data Grant, Delegation where applicable, and model/capability policy checks enforced by LifeSpace.

HomeMew must not create artificial Applications merely to emulate per-route least privilege. Least privilege below the Application ceiling belongs to user-token requested scopes, Service Principal max/token scopes, Data Grants, Agent credentials/Delegations and purpose-specific backend credentials.

## Cloudflare Access audience

The production Cloudflare Access audience for `homemew.aisr.online` is registered to the canonical HomeMew Application.

An Access audience represents a protected Web entry point. It does not classify the HomeMew Application as a Web Application and does not prevent the same Application from also owning Mini Program/provider entry points.

## Cutover

The migration is explicitly gated and must not be performed by an ordinary HomeMew code deployment.

Required order:

1. deploy LifeSpace Identity `0.11.0` / schema `10` with client-agnostic Application semantics and verify platform gates;
2. create the new canonical `HomeMew` Application with a generated `app_*` ID, required scope ceiling and Application × Model Access;
3. register the production HomeMew Cloudflare Access audience to the new Application;
4. create independent `lsa_*` credentials under the same Application for the Web Worker, provider backend and integration-management purpose as needed;
5. revoke/disable legacy HomeMew external-system principals/credentials that belong to the old integrations Application, then recreate required integrations under the canonical Application;
6. update HomeMew Worker secrets and deploy/verify Web and Mini provider flows against the same Application identity;
7. only after successful verification, disable the legacy Mini/Web/integrations Applications and revoke their remaining credentials.

Rollback before step 7 keeps the legacy Applications available. After legacy Applications are disabled, rollback requires deliberate operator action rather than silently restoring old client-type topology.

## Release gates

HomeMew deployment automation must require at least:

```text
LifeSpace Identity Application Contract = 0.11.0
LifeSpace Identity schema >= 10
```

before a canonical-Application HomeMew release can deploy.

Production credential values and the generated canonical Application ID remain secret/configuration state; source code and documentation contain no real credentials.

## Non-goals

- Do not add a LifeSpace Client, Frontend, BFF, PWA or deployment entity merely to preserve the old split.
- Do not merge Mini and Web product contracts or Workers solely because they share one Application.
- Do not weaken provider-specific or Cloudflare Access authentication boundaries.
- Do not migrate historical external-system credentials across Application ownership.
- Do not make the Application scope ceiling the only authorization layer.

## Superseded wording

This decision supersedes older HomeMew documentation wherever it describes `HomeMew Mini Program`, `HomeMew Web`, or `HomeMew integrations` as separate LifeSpace Applications or states that their `lsa_*` credentials must belong to different Applications.

Those runtime/deployment boundaries remain valid; only their LifeSpace Application identity is unified.
