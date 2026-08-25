# LifeSpace event subscriptions in HomeMew Web

Date: 2026-08-25
Status: Accepted

## Decision

LifeSpace owns the platform Eventing capability. HomeMew owns only the product-facing configuration experience.

Event push is a capability of a concrete **external system**, not a standalone HomeMew setting. HomeMew external-system administration therefore keeps the existing list/detail structure:

```text
/settings/integrations
  -> external-system summary list

/settings/integrations/:integrationId
  -> external-system detail
       -> authentication and data access
       -> event push
       -> future integration capabilities
```

The product-facing mental model is:

```text
External system
  -> one Webhook Endpoint
       -> one Webhook URL
       -> one signing secret
       -> selected subscriptions
            -> 日程: created / updated / deleted
            -> 待办: created / updated / deleted
```

A user must not be required to configure another callback URL or another signing secret merely because another LifeSpace model is selected.

## Platform ownership

LifeSpace is authoritative for:

- model-agnostic ordinary-record change events (`record.created`, `record.updated`, `record.deleted`);
- durable event outbox state;
- reusable Webhook Endpoints bound to a Space and subscriber Service Principal;
- model/event subscription filters attached to an Endpoint;
- Webhook signing, queueing, retries, dead-letter handling and delivery history;
- current authorization checks.

HomeMew must not create a parallel event, endpoint, subscription, Webhook-secret, retry or delivery-log store.

## Endpoint and subscription boundary

The accepted LifeSpace boundary separates transport from filtering:

```text
Webhook Endpoint
  -> Space
  -> subscriber Service Principal
  -> Webhook URL
  -> signing secret
  -> enabled state

Event Subscription
  -> endpointId
  -> modelKey
  -> eventTypes[]
  -> enabled state
```

The Endpoint answers **where to send and how to verify**. The Subscription answers **which changes to send**.

HomeMew intentionally exposes one Eventing Endpoint per external system in the current product UI, even though LifeSpace may support more than one Endpoint for applications that genuinely need multiple destinations.

Endpoint-level operations are shown only once:

- configure/edit Webhook URL;
- enable/disable all push delivery;
- test Webhook transport/signature;
- rotate the shared signing secret;
- inspect recent delivery history;
- remove the Endpoint and its filters.

Model-level configuration contains only the subscription choice and event-type filtering.

## External-system binding and authorization

One HomeMew external system maps to one LifeSpace Service Principal. The Webhook Endpoint carries that Service Principal ID and the current family Space.

Creating the Endpoint itself grants no business-data access. Selecting a model subscription requires:

- the managing HomeMew application/user context to retain current read access to that model;
- the external system's Service Principal to have a current model `read`, `write` or `manage` Data Grant, or an equivalent whole-Space Grant.

LifeSpace re-checks current Application × Model Access and subscriber Data Grant state before matching/delivering events. Therefore:

- revoking or expiring a model Grant stops new delivery for that model;
- disabling the external system and revoking its Grants stops its event delivery;
- an Event Subscription itself grants no data access;
- Identity remains authoritative for the Service Principal and credentials.

Endpoint test-send is deliberately only a transport/signature test; it does not imply that every model filter currently has valid data authority.

## Current HomeMew slice

The current HomeMew Web milestone exposes two LifeSpace ordinary models:

- `event`, labeled `日程`;
- `task`, labeled `待办`.

Both use the same Endpoint. The user simply checks which models should be pushed and, for each selected model, which ordinary changes are relevant:

- 创建 -> `record.created`
- 修改 -> `record.updated`
- 删除 -> `record.deleted`

`day_record` and future models are **not** automatically exposed merely because LifeSpace Eventing is model-agnostic. Adding another product-facing subscription model remains an explicit product decision.

## Secret handling

The Webhook signing secret belongs to the Endpoint. It is returned by LifeSpace only when the Endpoint is created or the secret is explicitly rotated.

HomeMew may keep that plaintext only in current React/module memory while showing it to the administrator. It must not be placed in URLs, React Router history state, localStorage, sessionStorage, a HomeMew database, logs, analytics or telemetry.

Adding/removing a model subscription does not generate or rotate the Endpoint secret.

## Payload and external access

Webhook delivery is reference-only. The outbound event identifies the event, Space, model and record/version, but does not contain the complete business record or actor identity.

A receiving n8n/Agent/backend that needs the current record authenticates to LifeSpace with the same external system's Service Principal credential and passes the normal credential scope, Application × Model Access and current Space/Data Grant checks.

Endpoint-level delivery history includes the source `modelKey`, so a shared Webhook remains diagnosable across multiple model filters.

## Compatibility and rollout

This decision supersedes the earlier same-day product shape where each model subscription owned its own Webhook URL and signing secret.

At the time of this correction there is no real production Eventing subscription configuration data to preserve. LifeSpace may therefore replace/reset the pre-Endpoint Eventing subscription/delivery configuration tables rather than building a compatibility migration for the abandoned shape. Staging/test subscriptions may be recreated.

HomeMew Web depends on LifeSpace Core Kernel `0.15.0+` for the Endpoint/filter split. LifeSpace must reach staging before the HomeMew staging UI is promoted against the new contract.
