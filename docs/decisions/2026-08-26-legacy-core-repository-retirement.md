# Decision: retire legacy HomeMew Core and cutover-only tooling

Date: 2026-08-26  
Status: accepted

## Context

HomeMew production business data has completed the one-shot migration to LifeSpace, and `homemew.aisr.online` has been owned by `homemew-web-production` since the accepted 2026-08-24 Web cutover. The repository still contained the old `apps/core` implementation, Core CI/deploy workflows, migration/cutover-era Web scripts and tests, and a staging backend workflow that borrowed Wrangler from the legacy Core package.

Keeping those artifacts in the active tree creates two risks: future development can mistake the retired HomeMew Core for a valid business boundary, and an operator can rerun a one-time prepare/cutover workflow after the target topology has already changed.

## Decision

- Remove `apps/core/` from the active HomeMew repository. Git history is the archive for the retired implementation, OpenAPI and migrations.
- Remove the old HomeMew Core check/deploy Actions and migration/cutover-only Web prepare/cutover Actions, scripts and tests.
- Remove milestone/status tests whose only purpose was to assert a completed migration phase rather than current product behavior.
- Make backend staging deployment independent of the retired Core package by using a pinned standalone Wrangler.
- Provide ordinary, confirmation-gated production deploy workflows for the current backend and Web Workers. These workflows deploy the already-accepted topology only; they do not transfer Custom Domains, reprovision Cloudflare Access, or recreate LifeSpace platform authority.
- LifeSpace remains the only source of truth for household business data, shared models, Identity, authorization and platform contracts.

## Runtime-resource boundary

This repository cleanup does **not** delete legacy Cloudflare Workers, D1 databases or other production resources. Any still-existing old HomeMew runtime resources remain frozen/read-only for the explicit stabilization/rollback-evidence window. Their deletion requires a separate operations decision with current production verification and rollback reasoning.

## Consequences

- New HomeMew work has only application surfaces (`backend`, `miniprogram`, `web`, future `display`) and cannot accidentally build against a local business Core.
- Normal production releases no longer expose the already-completed cutover procedure as the release path.
- Historical migration evidence remains available through Git history and accepted decision/status documents without keeping obsolete executable code active.
