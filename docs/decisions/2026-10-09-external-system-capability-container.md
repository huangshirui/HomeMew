# Decision: External System is a HomeMew capability container

Date: 2026-10-09
Status: Accepted

## Decision

HomeMew `External System` is an application-level container owned by HomeMew. It is **not** synonymous with a LifeSpace Service Principal, Agent, Webhook Endpoint, credential or Grant.

Creating an External System records only HomeMew application metadata:

- opaque HomeMew ID (`ext_*`);
- owning HomeMew family / LifeSpace Space ID;
- display name and optional description;
- optional references to the LifeSpace identities created for enabled capabilities.

It does not create any LifeSpace identity, credential, Data Grant or Eventing resource by itself.

The container currently exposes three independent capability areas:

```text
External System ext_*
├── Service Access (optional)
│   └── LifeSpace Service Principal svc_*
│       ├── Service credential
│       └── model-scoped Data Grants
├── Agent Access (optional)
│   └── LifeSpace Agent agt_*
│       ├── Agent API credential
│       └── optional direct model-scoped Data Grants
└── Event Push (optional)
    └── LifeSpace Webhook Endpoint + Event Subscriptions
```

`Service Access` and `Agent Access` are independent. Enabling Agent Access must not require or create a Service Principal, and enabling Service Access must not create an Agent.

`Event Push` is a distinct HomeMew capability, but the current LifeSpace Eventing contract requires every Webhook Endpoint to name a subscriber Service Principal whose current model-read authority is re-checked before delivery. Therefore HomeMew currently requires Service Access before Event Push can be configured. This is an explicit platform dependency, not a statement that External System or Event Push conceptually equals Service Access. HomeMew must not create a hidden Service Principal merely to make the UI appear independent.

## Ownership and storage

External System container metadata is HomeMew application configuration and is stored in the HomeMew backend Durable Object layer. It is not household business truth and does not belong in LifeSpace.

HomeMew stores only references such as `servicePrincipalId` and `agentId`. It must not persist credential plaintext, LifeSpace user bearers, Data Grant copies, Webhook signing secrets or a duplicate authorization table.

LifeSpace remains authoritative for:

- Service Principals and service credentials;
- Agent identities and Agent API credentials;
- Application × Model Access;
- Space/model Data Grants;
- Webhook Endpoints, Event Subscriptions and deliveries;
- all final authorization decisions.

Reference binding changes use compare-and-swap semantics so concurrent capability setup/removal cannot silently overwrite another binding.

## Lifecycle

Creating the container is cheap and reversible because it creates no LifeSpace authority.

Creating a capability may span HomeMew and LifeSpace and therefore remains a Saga:

- create LifeSpace identity/resources;
- create required current-family Grants/credential;
- bind the resulting LifeSpace identity to `ext_*` only after successful setup;
- compensate partial authority if the final HomeMew binding fails.

Removing Service Access disables the Service Principal first, revokes its current-family Grants and active service credentials, and removes Event Push resources bound to that Service Principal before clearing the container reference. Agent Access is unaffected.

Removing Agent Access revokes current-family Agent Data Grants and active Agent API credentials before clearing the container reference. Service Access and Event Push are unaffected.

Historical LifeSpace identity rows are retained for audit; removal means authority/credentials are revoked and HomeMew binding is cleared, not physical deletion of platform identity history.

## Compatibility

The pre-existing HomeMew implementation where a Service Principal itself acted as the External System ID is retained only as a bounded legacy BFF compatibility path while old records/tests are retired. New UI and new production setup use `ext_*` containers.

This decision supersedes the parts of `2026-08-24-external-integrations-web-only.md` and `2026-08-25-lifespace-event-subscriptions.md` that define one HomeMew External System as one Service Principal. Their remaining Web-only administration, credential-secret handling, rotation, Eventing security and LifeSpace authority rules remain valid where not contradicted here.

## 喵一下

The retired “喵一下” Web shell card is removed. The existing decision that AI creation drafts are offline remains unchanged; reintroducing an AI creation surface requires a separate accepted decision rather than leaving a placeholder entry in the active shell.
