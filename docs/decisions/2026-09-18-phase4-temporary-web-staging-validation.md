# Phase 4 temporary HomeMew Web staging validation

Date: 2026-09-18

## Status

Accepted for the Mini 1.6.3 review window only.

## Context

The 2026-09-16 final-BFF decision retired the permanent HomeMew Web staging environment. During Phase 4, LifeSpace Event moves to Event v6 with `when: temporal_range`, and HomeMew Web/BFF must be verified against the exact LifeSpace staging candidate before production cutover.

Repository-only tests are necessary but do not prove the cross-repository Cloudflare Service Binding/runtime path.

## Decision

A temporary release-candidate validation surface is allowed while Mini 1.6.3 remains under review:

- Worker: `homemew-web-staging`
- Host: `homemew-web-staging.aisr.online`
- HomeMew backend binding: `homemew-backend-staging`
- LifeSpace Core binding: `lifespace-core-staging`
- LifeSpace Identity binding: `lifespace-identity-staging`
- public LifeSpace status/baseline verification: `core-staging.aisr.online` / `auth-staging.aisr.online`
- Event adapter: `LIFESPACE_EVENT_CONTRACT=temporal_range`

The deployment is manual only and branch-scoped to the Phase 4 preparation branch. It must not use production Service Bindings, URLs, credentials, Custom Domains, D1, or production traffic.

This is a **temporary release-candidate validation surface**, not restoration of a permanent HomeMew Web staging environment. The normal HomeMew architecture remains production-only after validation.

## Exit

After Phase 4 production cutover is complete and stable:

1. delete the temporary Phase 4 Web staging workflow/configuration;
2. retire or remove the temporary Web staging Worker/domain when no longer needed;
3. retain only the test/evidence in the rollout record.

## Production gate

Successful temporary Web staging validation is evidence for Phase 4 readiness, but does not override the existing production gates:

- Mini 1.6.3 approved and production-active;
- exact LifeSpace candidate deployed/verified in staging;
- fresh exact-SHA APAC gate;
- LifeSpace/HomeMew production cutover and rollback gates.
