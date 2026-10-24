# Decision: Event Location coordinated LifeSpace release / 地点字段协调切换

Date: 2026-10-24  
Status: Accepted for implementation; release pending verification  
Tracking: LifeSpace #235 / #405 / #406; HomeMew #143 / #144; n8n nodes #113

## Decision / 决策

LifeSpace is the source of truth for the canonical `location` Model Definition field. HomeMew is a version-aware application consumer; the product must not create a second location persistence model or geocode silently.

The LifeSpace `Event.location` update from nullable string to nullable canonical `{name,address?,coordinates?}` is a **breaking model migration**. Existing location labels are backfilled to `{name: originalLabel}` only; no coordinates or addresses are invented.

## Separate HomeMew consumer contracts

- **Mini Program**: the stable reviewed Event DTO keeps `location: string | null`. No client-facing DTO break or immediate WeChat review is necessary solely for the platform field change. The existing Mini edit and detail screens remain text-only.
- **Mini BFF**: accepts old or new upstream Event records; projects both to the stable string. During writes it maps Mini text to old string or new `{name}` based only on trusted Worker `LIFESPACE_EVENT_LOCATION_FORMAT`; default `string` is safe before the platform cutover. Unknown/upstream-invalid structured values fail closed.
- **HomeMew Web**: reads old/new Location values; displays `location.name` for structured objects. The calendar editor retains an existing address/coordinate point only when its displayed name is unchanged, so unrelated Event updates do not discard explicit spatial truth. It must never silently carry old coordinates onto a renamed location.
- **Web same-origin BFF**: only Event create/update use the version-aware write transform. No generic Core proxy, auth, or LifeSpace model semantics are redefined.
- **LifeSpace n8n nodes**: Discovery-driven object field, Agent Tool generated schema and WGS84 `withinDistance` queries. Human and Agent interfaces must not submit an old bare string to the new structured Core model unless a defined compatibility adapter is in use.

## Deployment bindings / 发布开关

The single `homemew-web` Worker has two deployments bound to different LifeSpace environments. Production `LIFESPACE_EVENT_LOCATION_FORMAT=string` is the initial legacy setting. Preview `LIFESPACE_EVENT_LOCATION_FORMAT=location` is valid **only after** LifeSpace Staging has completed its Event schema migration.

This is **not** a runtime client-controlled switch. The Worker / Wrangler configuration and deployed LifeSpace model schema must be explicitly matched by the release operator. The BFF never probes a write and retries with the other shape.

## Combined release / 协调发版顺序

1. Land unrelated LifeSpace schema 73 (PR #404) and Location primitive (PR #405) in the agreed migration order. Verify the exact deployment SHA on LifeSpace Staging first.
2. Land gated Event Location schema 74 (LifeSpace Issue #406); back up and verify existing Event counts/venue labels, model Registry contract hash and typed storage. Verify name-only migrated Event read/write, text search, nulls, proximity queries and old Event temporal behavior.
3. Deploy HomeMew Web Preview containing current Activity/Goal/Habit/Anniversary work (PR #143) plus Location compatibility (PR #144). Preview is tied to staging and can exercise the new Event wire contract; complete user UX review before the public release.
4. Verify stable Mini BFF Event DTO and currently published Mini Program app on the production-bound compatibility path; confirm a representative Mini create/read/patch action both before and after cutover. Only ship a reviewed Mini binary if its ongoing product work requires it.
5. Coordinate Production LifeSpace schema migration 74 and HomeMew Worker Production `LIFESPACE_EVENT_LOCATION_FORMAT=location` deployment within the explicitly approved maintenance/release window. Do not treat merging branches as a production release. Publish n8n nodes only after Core contract and its own CI/package-version gate are satisfied.

**Rollback rule**: a schema-breaking production migration is not reversed merely by re-deploying an old Worker. Recover from verified D1 snapshot with matching previous Core/HomeMew revisions, or use an explicitly reviewed compensating migration. Do not truncate rich coordinates into a legacy string in an undocumented rollback.

## Acceptance

- No loss of previously stored Event venue names; no invented locations or geocoding.
- Existing Mini release remains operational via stable BFF; no new model fields leak into its DTO.
- HomeMew Web Edit/Save does not erase unchanged coordinates.
- Event calendar search still includes `location.name`; existing `when` temporal queries and attendee authority stay unchanged.
- n8n dynamically discovers the authoritative `location` type and spatial operator.
- Complete relevant CI, real Staging E2E, Production release health checks, smoke/rollback checklist; record exact SHA and environment results before declaring released.
