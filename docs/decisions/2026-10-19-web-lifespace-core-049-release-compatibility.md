# Decision: HomeMew Web deploy gate permits verified LifeSpace Core 0.49.0

Date: 2026-10-19
Status: Accepted (Web production retry pending)

## Incident

- HomeMew Web production workflow run [#15](https://github.com/huangshirui/HomeMew/actions/runs/39206617654) for merged PR #128 (`cf2ce6cba95d3c8f38e2d4f44dcb9b5f45e5621f`) failed at `Verify LifeSpace production release baseline`: `core contract mismatch: HomeMew requires 0.48.0, got 0.49.0`.
- Dependency install, operator production confirmation, Worker config validation all succeeded. Web build and actual Worker deployment were **never reached**, so no production Web change occurred in that run.
- The baseline used exact string equality for a single Core contractVersion. It did not track the already successful LifeSpace Core 0.49 production release.

## Source of truth and compatibility finding

- LifeSpace `docs/production/changelog.md` records successfully deployed **Production #37** (workflow run `37936055161`), exact SHA `6659ad86c5ea8a893f22f28a42f89f2e0371523c`: Core **0.49.0 / schema 53**, Identity **0.11.0 / schema 11**.
- The 0.48→0.49 change is configuration-time model semantic discovery (`/api/v1/me/_discovery/models*`), not a replacement of existing HomeMew CRUD/query/authorization endpoints.
- The active Model Contract remains `mct_bc784389d406c580cbaf1a9cafaa48a155732771e1b24f058fcb884bffcb2345`, with the same published Task v8, Wish v9, Day Record v5, Event v6, Person Group v1; Core schema remains 53.
- No LifeSpace API or deployment change is required for this HomeMew release.

## Decision

- `apps/web/lifespace-release-baseline.mjs` permits the **explicitly reviewed** Core versions `0.48.0` (older staging) and `0.49.0` (current production), with minimum Core schema **53**. Display `0.49.0` as the current baseline.
- Keep Identity contract **0.11.0** with its existing minimum schema floor, and keep strict environment, service, status and schema checks.
- **Do not** accept an arbitrary future `0.x` or higher version just because it is numerically later: each unseen Kernel contract release must be reviewed before expanding the allowlist.
- Regression tests cover both accepted Core contracts, an unknown future Core contract, too-old Core, schema drift and environment mismatch.

## Rollout

- This HomeMew-only fix is a separate PR from the already merged #128. Merge after passing Web check; the user performs the next production workflow dispatch manually.
- Retain the normal production workflow confirmation gate, LifeSpace status check, full Web tests/typecheck/build, and post-deploy smoke tests. No auto-deploy from this PR.
