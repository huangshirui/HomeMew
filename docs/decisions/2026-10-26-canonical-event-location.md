# Decision: Fixed canonical Event Location after cutover

Date: 2026-10-26  
Status: Accepted and activated in HomeMew Production  
Authorization: user requested permanent cleanup and activation in this chat ("那就直接一次性改对").

## Decision

LifeSpace Production publishes Event Location as the nullable canonical `{name,address?,coordinates?}` object. Read-only verification confirmed type `location` and schema hash `7b189b870a3da40ecc6d4ae7926c600f8beec5bc3af342539279d934da3243c6`. HomeMew must not keep an upstream string-write mode after this cutover.

- Remove `LIFESPACE_EVENT_LOCATION_FORMAT`, its selector and legacy string-write branch from the application code and Production/Preview repository configuration. The deployed Production binding is also removed.
- `apps/web/event-location.mjs` always converts text labels into `{name}`, empty text into null, and validates explicit addresses/coordinates without inferring any spatial truth. Text and selected-object names share the 500-character bound.
- Preserve the stable Mini `location: string | null` DTO and optional `locationDetail`. Published old Mini clients continue submitting text; new clients may submit explicit selections. These are application projections, not legacy platform write contracts.
- Apply the same fixed conversion to Web Event POST/PATCH, Mini Event POST/PATCH and atomic container Event quick-create. Preserve authoritative rich coordinates for unchanged old-Mini labels; renaming must drop stale coordinates.
- Place search/recent-place responses retain their additive `structured: true` field for existing clients; it no longer depends on deployment configuration. Provider failure still allows name-only entry.
- LifeSpace remains authoritative. No platform changes, household-data migration, extra business persistence or authorization changes are included.

This supersedes the format-switch deployment controls in `2026-10-24-event-location-coordinated-release.md`. That document retains the historical migration and provider decisions.

## Production activation and validation

- Original deployed version: `560f30c3-60e0-4e64-831b-d1831b923e58`. Downloaded source SHA-256: `68bd59125a9c4a04ed0f3c4f9da2ef2ba1eb111594acc9adef7240905a3841fa`.
- Prepared a bounded update of the actual deployed bundle, replacing only the Location adapter and its six switch-dependent uses. The application working tree contained unrelated unfinished changes; those were not published. Cloudflare's content-only endpoint retained existing static assets and Worker settings.
- Updated source SHA-256: `70061ea2dfdab07ed96cbefdad0b64eedbd1f61099ae12af99ee2b741f50781a`. The downloaded active source matches the exact locally tested artifact.
- Final active version: `5636a133-bd8a-4a60-941f-2591d886c243`, 100% Production traffic; deployment `f31ca084-2743-49e4-b31d-f337f4dac3bf`. Re-read confirmed neither code nor bindings contain the obsolete switch. All eight other non-secret bindings and four existing secret references remain, as do observability and compatibility date.
- The initial all-inherit settings update was rejected by automatic approval review before execution. A narrower request preserved exact verified concrete bindings; only secrets used inheritance. Cloudflare rejected version-specific secret inheritance, so the successful request verified that latest uploaded and active versions both matched the tested production version, then used the supported `latest` reference. No secret values were read or changed.
- Validation: all 274 repository Web tests pass; 31 additional tests run against the isolated deployed bundle pass, covering Mini label writes, rich selection, coordinate preservation, rename, quick-create, Web label/object/null writes, search and recent places. JavaScript syntax checks pass.
- Public unauthenticated Mini recent-place request remains 401. Public `/health` is protected by Cloudflare Access, so its login HTML is not counted as a successful application health check. Browser smoke testing was unavailable because the shared Playwright browser was already in use.
- Authenticated Mini/Web save-and-reopen and real-device UI acceptance are still pending; automated and source readback checks do not establish whole-version Mini release readiness. No household test records were created during this release.
