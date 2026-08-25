# LifeSpace event subscriptions in HomeMew Web

Date: 2026-08-25
Status: Accepted

## Decision

LifeSpace owns the platform eventing capability. HomeMew owns only the product-facing configuration experience.

Event subscription is a capability of a concrete **external system**, not a standalone HomeMew setting. HomeMew external-system administration therefore uses a low-frequency, extensible list/detail structure:

```text
/settings/integrations
  -> external-system summary list

/settings/integrations/:integrationId
  -> external-system detail
       -> authentication and data access
       -> event subscriptions
       -> future integration capabilities
```

The list page shows only operational summaries. Editable details are not expanded by default; a family administrator enters a specific system and explicitly starts editing when needed.

Future external-system-specific capabilities such as synchronization rules, notification channels or Agent/MCP integration settings belong on this same detail surface rather than becoming additional top-level Settings entries.

## Platform ownership

LifeSpace is authoritative for:

- model-agnostic ordinary-record change events (`record.created`, `record.updated`, `record.deleted`);
- durable event outbox state;
- Space/model subscriptions managed by an application and bound to one subscriber Service Principal;
- Webhook signing, queueing, retries, dead-letter handling and delivery history;
- current authorization checks.

HomeMew must not create a parallel event, subscription, Webhook-secret, retry or delivery-log store.

## External-system binding

One HomeMew external system maps to one LifeSpace Service Principal. An event subscription created in that external system's detail page carries the actual subscriber Service Principal ID.

Creating, enabling, materially editing or test-sending a subscription requires the subscriber Service Principal to have a current Data Grant from the family Space that permits access to the selected model. LifeSpace re-checks that Data Grant again before matching and delivering real events.

Consequences:

- a subscription cannot be visually attached to one external system while being platform-global underneath;
- revoking or expiring the external system's model Data Grant stops new event delivery;
- disabling a HomeMew external system naturally stops its subscriptions when the integration flow revokes its Data Grants;
- the event subscription itself grants no data access;
- Identity remains authoritative for the Service Principal and credentials; Core stores only the stable subscriber-principal reference needed by Eventing.

## Current HomeMew slice

The current HomeMew Web milestone exposes two LifeSpace ordinary models:

- `event`, labeled `日程`;
- `task`, labeled `待办`.

Both models use the same LifeSpace Eventing contract and the same external-system detail UI. The event-subscription section supports:

- create/edit/delete subscription;
- select `日程` or `待办` when creating a subscription;
- choose created/updated/deleted changes;
- enable/disable;
- HTTPS Webhook URL;
- one-time display of a generated signing secret and explicit rotation;
- test delivery;
- recent delivery history.

The subscription model is immutable after creation because the current LifeSpace update contract does not change `modelKey`. To switch models, create a new subscription and remove the old one.

HomeMew uses its existing same-origin Web BFF proxy to call the LifeSpace Core Kernel API. LifeSpace user bearer credentials remain server-side and are never returned to browser JavaScript.

With both `event` and `task` wired into HomeMew Web, the current event-subscription milestone is considered complete for now. `day_record` and future models are **not** automatically exposed merely because LifeSpace Eventing is model-agnostic; adding another product-facing subscription model requires a later explicit product decision.

## Secret handling

Service credentials and Webhook signing secrets are one-time plaintext values. They may exist only in current React/module memory while the user is actively saving them. They must not be placed in URLs, React Router history state, localStorage, sessionStorage, HomeMew databases, logs or analytics.

## Payload and external access

Webhook delivery is reference-only. The outbound event identifies the event, Space, model and record/version, but does not contain the complete business record or actor identity.

A receiving n8n/Agent/backend that needs the current record authenticates to LifeSpace with the same external system's Service Principal credential and passes the normal credential scope, Application × Model Access and current Space/Data Grant checks.

## Rollout

The HomeMew detail UI depends on the LifeSpace Core Kernel event-subscription API with subscriber-Service-Principal binding. Both sides must be deployed and verified together in staging before production promotion.
