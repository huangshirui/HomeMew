# Decision: HomeMew Web accepts reviewed LifeSpace Core 0.55.0 / schema 82

Date: 2026-11-17
Status: Reviewed compatibility fix; Preview and Production acceptance remain separate.
Scope: HomeMew Web release baseline only. No LifeSpace, runtime authorization, model, or deployment binding changes.

## Evidence

- HomeMew Preview [#44088229597](https://github.com/huangshirui/HomeMew/actions/runs/44088229597) failed before build/deployment: Core contract mismatch (accepted 0.54.0, actual 0.55.0). Provenance and environment checks passed.
- LifeSpace [Staging #44059528229](https://github.com/huangshirui/LifeSpace/actions/runs/44059528229) passed. Subsequent [Staging #44080722509](https://github.com/huangshirui/LifeSpace/actions/runs/44080722509) deployed and verified Core 0.55.0/schema 82 and Identity 0.19.0/schema 20; its subsequent Eventing signed-sink check failed (HTTP 500). That workflow is not an overall successful release. Authenticated Kernel/Model Contract, member ceilings, Native R2 File, External flow and Golden Flow checks passed before the independent Eventing failure.
- Compared Kernel OpenAPI at previous production 95c3fb5d4d40a88cf68f9e32a65aedb9c4dfa159 and staging 6103fab56653546972ed58ea9d518d1309d7c397: no existing operations removed or modified, no schemas removed, status schema changed, two member model-access endpoints added. Model access ceilings can intentionally deny operations; HomeMew must continue respecting current Core authority.
- LifeSpace [Production #44065939188](https://github.com/huangshirui/LifeSpace/actions/runs/44065939188) was blocked by APAC gate before production deployment. Keep the previously verified Core 0.54.0/schema 79 compatibility for existing production.

## Decision

Explicit allowlist only: 0.54.0 requires schema >=79; 0.55.0 requires schema >=82 (conservative reviewed deployment floor). Identity 0.19.0 retains its existing schema >=18 floor and accepts schema 20. Unknown contracts and partial schema upgrades remain rejected. Keep exact service, environment and status verification, review provenance, full Web test/typecheck/build, manual Preview gate and Production acceptance gate. This is not a blanket forward-compatible semver range, an Eventing acceptance, or permission to release LifeSpace production.

After CI and merge, owner dispatches named Web Preview on main. Verify actual family health flows with synthetic staging data; Production health authorization and release remain separate.
