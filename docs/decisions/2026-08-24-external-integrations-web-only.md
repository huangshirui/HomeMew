# Decision: HomeMew external integrations are Web-only

Date: 2026-08-24
Status: Accepted

## Decision

HomeMew treats external-system integration administration as an advanced capability. It is implemented only in HomeMew Web, currently under `/settings/integrations`.

The WeChat Mini Program remains a lightweight, high-frequency household client. It does not expose Service Principal creation/editing, Data Grant configuration, API Token or OAuth Client Credentials creation, credential rotation/revocation, integration disable operations, or n8n/Agent setup guidance.

This boundary is a product rule, not a temporary staging limitation.

## Credential model

One HomeMew external system maps to one LifeSpace Service Principal and one explicit owning family Space.

At steady state, one external system has:

- exactly one authentication mode: `api_token` or `oauth_client_credentials`;
- exactly one active credential for that mode;
- model permissions expressed separately through LifeSpace Data Grants.

The LifeSpace platform may store multiple credential rows for a Service Principal, but HomeMew does not expose that as normal multi-key management.

## LifeSpace Connection UX

HomeMew Web is the configuration surface for the Space-bound external-system connection. Machine clients must not ask the operator to enter a separate LifeSpace `Space ID` after that connection has already been configured in Web.

For direct LifeSpace integrations, HomeMew Web exposes a copyable **Connection Base URL** that already contains the selected family Space context, for example:

```text
https://core.aisr.online/api/v1/spaces/spc_...
```

The URL is routing context only; authorization still comes from the Service Principal credential plus current LifeSpace Application × Model Access and Data Grants.

The official LifeSpace n8n Community Node uses this convention. Its Credential contains:

```text
Connection Base URL
Service API Token
```

The LifeSpace Node does not expose a separate `Space ID` field. Model and Action choices are loaded dynamically from `{Connection Base URL}/_discovery` under the credential's current effective authority.

For the Community Node MVP, the supported Credential mode is the opaque Service API Token (`lsp_pat_*`). When HomeMew creates or rotates that token, Web may show the token plaintext once together with the Connection Base URL so the operator can configure n8n immediately. An already-created token plaintext is never recoverable; if it was not saved, use the controlled rotation flow rather than trying to reveal it again.

OAuth Client Credentials remains a valid LifeSpace service-authentication mode for integrations that support it, but HomeMew must not imply that the Community Node's Service API Token Credential accepts OAuth client credentials unless that support is explicitly added to the node package later.

## Rotation

Credential rotation is intentionally a controlled temporary exception to the one-active-credential rule:

1. create the replacement credential while the old credential remains active;
2. show the new plaintext once in Web memory only;
3. update the external system and verify a real request with the new credential;
4. complete rotation, keeping the replacement and immediately revoking the old credential(s).

If verification fails, cancel rotation by revoking the newly created candidate and retaining the previous credential.

The same flow is used when switching authentication mode. During that transition only, credentials of both modes may coexist briefly. The steady state returns to one mode and one active credential after completion.

## Creation failure and recovery

Creating a HomeMew external system is a cross-service Saga rather than an atomic database transaction: Identity creates the Service Principal and credential, while Core creates the family Data Grants. HomeMew Web therefore owns explicit compensation for partial creation.

A credential-creation transport failure is an **uncertain write** because the LifeSpace request may have committed even when HomeMew did not receive the response. HomeMew must not blindly retry that POST: it first lists the principal's active credentials, revokes any credential created after the known baseline whose plaintext can no longer be recovered, and only then makes one safe retry.

If creation still fails after a Service Principal was created, HomeMew must:

1. disable that Service Principal;
2. reconcile and revoke every active Data Grant created for it, including a Grant whose POST result may have been lost;
3. reconcile and revoke every active credential whose plaintext was not delivered to the user;
4. mark the HomeMew ownership binding as discarded only after compensation succeeds, so the failed setup is not shown as a normal external system.

Older partial records created before this rule may have the characteristic state `disabled Service Principal + active HomeMew family Grant + no active credential`. The external-system list may perform bounded repair of exactly that broken invariant: revoke the stale Grant, mark the principal discarded, and omit it from the normal list. This is reconciliation of a known failed Saga, not general mutation-on-read behavior.

A failed creation must never leave the user with a visible external-system record that has neither a usable credential nor a recovery path.

## Secret handling

Credential plaintext is returned by LifeSpace only at creation time. HomeMew Web may display it once in current in-memory UI state but must not persist it in browser storage, HomeMew storage, logs, analytics, telemetry, or URLs.

The browser never receives HomeMew `lsa_*` application credentials or LifeSpace user Bearer tokens.

## Authority boundary

LifeSpace remains authoritative for Service Principals, credentials, Application × Model Access and Data Grants. HomeMew Web is an orchestration/UX layer and does not create a second credential store or authorization model.

A Data Grant does not transfer Service Principal credential-management ownership. HomeMew's existing explicit owning-Space binding remains required before Web may display credential metadata or perform rotation, edit, disable, or revoke operations.

## Consequences

- Remove the Mini Program external-system pages and family-management entry.
- Do not add future Mini Program integration-management APIs or secret buffers.
- Web creation explicitly asks for one authentication mode.
- Web no longer offers arbitrary per-credential create/revoke controls as the normal UX.
- Web detects the temporary two-credential rotation state and requires an explicit complete or cancel action.
- Web exposes a copyable Space-bound Connection Base URL instead of requiring downstream integrations to re-enter `Space ID`.
- The official LifeSpace n8n Community Node Credential is configured from the Web-provided Connection Base URL plus the one-time Service API Token.
- Disabling an integration revokes both API Tokens and OAuth Client Credentials in addition to current-family Data Grants.
- External-system creation uses explicit cross-service compensation; uncertain credential writes are reconciled before a single safe retry.
- A fully compensated failed creation is tombstoned from HomeMew's normal external-system list rather than left as an unusable disabled record.
