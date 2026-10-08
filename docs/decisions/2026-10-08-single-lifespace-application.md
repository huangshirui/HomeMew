# Decision: HomeMew is one LifeSpace Application

Date: 2026-10-08
Status: Accepted

## Decision

HomeMew is one application-level access subject from the perspective of LifeSpace.

LifeSpace does not model HomeMew's Mini Program, Web/PWA, BFFs, Workers, provider adapter, or integration orchestration as separate Applications. Those are HomeMew implementation and deployment details.

The canonical platform relationship is:

```text
LifeSpace Application: HomeMew
  ├─ trusted application credentials (`lsa_*`), one or more when operationally useful
  ├─ Cloudflare Access audience(s) used by HomeMew Web
  ├─ HomeMew-owned Service Principals / external-system connections
  └─ HomeMew-owned Agent identities
```

A HomeMew deployment may use more than one active `lsa_*` for zero-downtime rotation, independent deployment, reduced secret blast radius, or independent revocation. Credential count does not represent client count and does not create additional LifeSpace Application identities.

## Web and Mini boundaries

HomeMew may continue to have separate Mini/Web contracts, BFF behavior, provider trust flows, Workers and release lifecycles. Those boundaries remain application-owned and are not promoted into LifeSpace Application identity.

The Web front door currently exposes a compatibility alias named `LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL` to the existing integration orchestration modules. The alias always resolves to the Web Worker's canonical `LIFESPACE_APPLICATION_CREDENTIAL`; it is not a separate credential source and must not be provisioned as a separate LifeSpace Application.

The HomeMew provider backend may hold a different active `lsa_*` from the Web Worker when independent deployment or rotation makes that useful, but both credentials belong to the same canonical HomeMew LifeSpace Application.

## External systems

External systems created from HomeMew Web are connections owned by HomeMew, represented by LifeSpace Service Principals plus their credentials, Data Grants and optional Eventing/Agent configuration.

They are not LifeSpace Applications and they are not owned by a synthetic `HomeMew integrations` Application.

```text
HomeMew Application
  └─ external system / connector
       └─ LifeSpace Service Principal (`svc_*`)
            ├─ service credential
            ├─ Data Grants
            ├─ Eventing configuration
            └─ optional Agent binding
```

HomeMew Web remains the product surface for configuring these connections. This does not mean Web itself is a distinct LifeSpace Application.

## Migration

The existing production registrations `homemew-miniprogram`, `HomeMew Web production`, and `HomeMew integrations production` are migration inputs only.

The migration creates one neutral canonical HomeMew Application and new trusted application credential(s). Existing HomeMew external systems do not need to be migrated: they may be disabled/revoked and manually recreated after cutover. Historical audit/application attribution is not rewritten.

The cutover must not deploy this HomeMew change before the compatible LifeSpace Application model is available and the canonical HomeMew Application, Access audience, Application × Model Access and new `lsa_*` credentials have been provisioned.

## Superseded wording

This decision supersedes older HomeMew documentation wherever it describes:

- a `HomeMew Mini Program application` and a separate `HomeMew Web application` as distinct LifeSpace Applications;
- a dedicated `HomeMew integrations application` as the owner of external systems;
- a rule that the Web BFF must use a credential belonging to a different LifeSpace Application from the Mini/backend.

Separate deployment credentials remain permitted; separate Application identities do not.
