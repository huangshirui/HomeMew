# LifeSpace event subscriptions in HomeMew Web

Date: 2026-08-25

## Decision

LifeSpace owns the platform eventing capability. HomeMew owns only the product-facing configuration experience.

LifeSpace is authoritative for:

- model-agnostic ordinary-record change events (`record.created`, `record.updated`, `record.deleted`);
- durable event outbox state;
- Space/application-scoped subscriptions;
- Webhook signing, queueing, retries, dead-letter handling and delivery history;
- current authorization checks.

HomeMew must not create a parallel event, subscription, Webhook-secret, retry or delivery-log store.

## First HomeMew slice

HomeMew Web exposes `设置 → 事件订阅` to family owners/admins. The first release intentionally exposes only the LifeSpace `event` model and labels it `日程`.

The product UI supports:

- create/edit/delete subscription;
- choose created/updated/deleted changes;
- enable/disable;
- HTTPS Webhook URL;
- one-time display of a generated signing secret and explicit rotation;
- test delivery;
- recent delivery history.

HomeMew uses its existing same-origin Web BFF proxy to call the LifeSpace Core Kernel API. LifeSpace bearer credentials remain server-side and are never returned to browser JavaScript.

## Payload and external access

Webhook delivery is reference-only. The outbound event identifies the event, Space, model and record/version, but does not contain the complete calendar record or actor identity.

A receiving n8n/Agent/backend that needs the current record must authenticate to LifeSpace with its own Service Principal credential and pass the normal Application × Model Access and Space/Data Grant checks. Configuring a HomeMew Webhook subscription does not grant the receiver read access to family data.

## Rollout

The HomeMew UI depends on the corresponding LifeSpace Core Kernel event-subscription API and must be deployed/verified against LifeSpace staging before production promotion.
