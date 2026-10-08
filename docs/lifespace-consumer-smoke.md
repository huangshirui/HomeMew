# HomeMew LifeSpace consumer smoke

HomeMew pins an exact LifeSpace contract baseline before release, then uses this read-only smoke to prove that the deployed HomeMew Mini BFF can still consume the promoted LifeSpace contract.

The smoke intentionally performs no mutation. It verifies:

- LifeSpace Identity/Core `/api/v1/status` against `apps/web/lifespace-release-baseline.mjs`;
- HomeMew Mini BFF family list;
- one selected family detail and member list;
- read/list surfaces for events, tasks, day records and wishes;
- standard `{ data }` envelopes and `x-request-id` propagation.

## Run

Use a short-lived LifeSpace user bearer that can access a non-sensitive smoke family. Do not store the bearer in the repository.

```bash
HOMEMEW_SMOKE_BASE_URL=https://<reachable-homemew-worker> \
HOMEMEW_SMOKE_BEARER='<short-lived user bearer>' \
HOMEMEW_SMOKE_FAMILY_ID='spc_...' \
LIFESPACE_IDENTITY_URL=https://auth.aisr.online \
LIFESPACE_CORE_URL=https://core.aisr.online \
LIFESPACE_ENVIRONMENT=production \
node apps/web/lifespace-consumer-smoke.mjs
```

`HOMEMEW_SMOKE_FAMILY_ID` is optional; when omitted the first accessible HomeMew family is used. If the user has no family, the smoke still proves the LifeSpace baseline and family-list contract and exits successfully without probing family-scoped resources.

For a future LifeSpace promotion, run the same smoke against the candidate environment before advancing HomeMew's exact release baseline. Keep mutation testing in dedicated disposable fixtures rather than adding writes to this default smoke.
