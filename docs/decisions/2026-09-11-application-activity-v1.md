# Decision: HomeMew Application Activity V1

Date: 2026-09-11
Status: Accepted

## Context

HomeMew needs a lightweight way to know whether a household member has recently entered one of the HomeMew product surfaces. The immediate product uses are daily engagement checks and automation that can decide whether a member has returned to HomeMew after another system emitted a notification.

This is application-usage state, not household business data. It therefore belongs to HomeMew rather than a LifeSpace domain model. LifeSpace remains authoritative for global user identity, family Space membership, authorization and household business records.

## Decision

HomeMew Backend is the single source of truth for application activity state.

Activity is stored in a SQLite-backed Durable Object named `MemberActivity`, keyed by canonical LifeSpace `usr_*` user ID. V1 stores only the latest timestamp for each supported HomeMew surface:

```text
miniProgramLastSeenAt
webLastSeenAt
wecomLastSeenAt
```

There is no activity history, session history, online presence model or per-message read state in V1. A write is monotonic: an older late-arriving signal must never move a stored timestamp backwards. `lastSeenAt` is a derived maximum across the three surface timestamps.

The Activity layer is user-scoped rather than Space-scoped. It does not resolve family membership. A caller that needs activity for the members of one family first obtains the canonical member user IDs from LifeSpace and then queries HomeMew Activity for those IDs.

## Mini Program reporting

All Mini Program entry paths report through the global `App.onShow()` lifecycle rather than per-page instrumentation.

Within one live Mini Program process, HomeMew reports at most once per local calendar day after a successful authenticated runtime bootstrap. Foreground transitions and route changes during that day do not create another report. A failed report is not remembered as success and may be retried by a later `onShow()`.

If WeChat kills the process, a later launch may report again on the same day. If the process survives across midnight, the next `onShow()` reports for the new local day. The day-level client de-duplication is an efficiency rule; the authoritative stored value remains an absolute UTC instant.

The Mini Program calls `POST /api/v1/activity/me` with its existing LifeSpace user bearer and does not submit a target user ID. HomeMew Backend verifies that bearer through LifeSpace Identity `GET /api/v1/me` and derives the canonical `usr_*` identity.

## Web reporting

HomeMew Web reports only after `SessionGate` has established an authenticated Access-bound HomeMew session.

Within one browser tab, Web reports at most once per local calendar day. `sessionStorage` plus process memory are used only for duplicate suppression. SPA route changes, focus changes and same-day visibility changes do not cause another successful report. If the tab remains open across midnight, the next transition to visible reports the new day. Failed reports remain retryable.

The browser calls same-origin `POST /api/activity/me`. The Web BFF resolves the current signed HomeMew session and forwards its already-verified LifeSpace user bearer to HomeMew Backend through the `HOMEMEW_BACKEND` Service Binding. The browser never receives a LifeSpace bearer or Activity integration secret.

## External integration API

Trusted external systems such as n8n use a dedicated HomeMew application secret rather than a human LifeSpace session:

```text
Authorization: Bearer <ACTIVITY_API_SECRET>
```

`ACTIVITY_API_SECRET` is a Cloudflare Worker Secret. Staging and production use different values; the secret is never committed to Git, written to `wrangler.jsonc`, browser storage or logs.

V1 exposes:

```http
POST /api/v1/activity/report
GET  /api/v1/activity?userIds=usr_a,usr_b,...
```

Report input is:

```json
{
  "userId": "usr_xxx",
  "channel": "wecom",
  "occurredAt": "2026-09-11T08:16:00Z"
}
```

`occurredAt` is optional and defaults to the Backend receive time. It must be a valid instant and may not be materially in the future. External callers must provide canonical LifeSpace `usr_*` IDs; the Activity API does not own provider-identity mapping.

The query endpoint accepts 1-50 canonical user IDs and returns the three latest timestamps plus derived `lastSeenAt` for each user. Family membership expansion remains outside this API.

## Public routing and Cloudflare Access

Production `homemew.aisr.online` is owned by the HomeMew Web front door while `homemew-backend-production` remains route-free. Therefore the front door forwards only the exact HomeMew Backend provider/activity routes it intentionally exposes:

```text
POST /api/v1/login/wechat
POST /api/v1/activity/me
POST /api/v1/activity/report
GET  /api/v1/activity
```

It must not expose the Backend through a broad `/api/v1/*` prefix.

Because Mini Program and external-system Activity calls do not carry a Cloudflare Access browser assertion, the production Cloudflare Access policy must bypass only the exact public Activity paths that need to reach the front door, matching the existing narrowly scoped provider-route approach. Authentication is still enforced by the endpoint itself: LifeSpace user bearer for `/activity/me`, and `ACTIVITY_API_SECRET` for external report/query.

## WeCom boundary

HomeMew does not define or implement WeCom collection rules in V1. The current n8n integration may continue to receive and interpret WeCom events. Once n8n decides that an event represents HomeMew activity, it reports the canonical user/channel/time through the external Activity API.

The `wecomLastSeenAt` field means the latest accepted HomeMew WeCom activity signal. It must not be presented as a generic WeCom-client open time or as strict per-message read receipt unless the upstream collection rule actually proves that stronger meaning.

## Consequences

- HomeMew gains one lightweight application-state source without adding a LifeSpace model or HomeMew D1 business database.
- Daily engagement checks can combine LifeSpace membership with HomeMew Activity timestamps without duplicating family membership in HomeMew.
- Mini Program and Web reporting are low-frequency and do not become analytics event logging.
- External automation has a narrow, separately authenticated reporting/query surface.
- If future product needs require precise post-notification re-entry for Mini Program/Web, historical analytics or richer presence semantics, the reporting/storage model must be extended explicitly rather than inferring them from V1 day-level signals.
