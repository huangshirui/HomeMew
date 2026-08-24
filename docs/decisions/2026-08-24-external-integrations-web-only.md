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

## Rotation

Credential rotation is intentionally a controlled temporary exception to the one-active-credential rule:

1. create the replacement credential while the old credential remains active;
2. show the new plaintext once in Web memory only;
3. update the external system and verify a real request with the new credential;
4. complete rotation, keeping the replacement and immediately revoking the old credential(s).

If verification fails, cancel rotation by revoking the newly created candidate and retaining the previous credential.

The same flow is used when switching authentication mode. During that transition only, credentials of both modes may coexist briefly. The steady state returns to one mode and one active credential after completion.

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
- Disabling an integration revokes both API Tokens and OAuth Client Credentials in addition to current-family Data Grants.
