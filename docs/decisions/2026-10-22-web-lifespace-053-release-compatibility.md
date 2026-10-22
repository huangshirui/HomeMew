# Decision: HomeMew Web accepts verified LifeSpace 0.53.0 / Identity 0.12.0

Date: 2026-10-22
Status: Accepted for compatibility PR; Web deployment not implied
Scope: HomeMew Web production release gate; does not modify LifeSpace Platform, Cloudflare Access policy or persistent data.

## Release evidence

LifeSpace [Staging #147](https://github.com/huangshirui/LifeSpace/actions/runs/39750058970) and [Production #42](https://github.com/huangshirui/LifeSpace/actions/runs/39752702491) both completed successfully at the exact SHA `4e2eb18aa35738aae9f908e86ee55063a58c4466`.

- Core: Kernel `0.53.0`, schema `72`; Core/Identity service authentication and 10-model active Model Contract verified.
- Identity: contract `0.12.0`, schema `11`.
- Active ordinary models: Task v9, Wish v9, Day Record v6, Event v6, Person Group v1, Anniversary v1, Activity v1, Goal v2, Person Profile v1, Habit v2.
- Model Contract: `mct_ee9aa79db15247e204572f14703ffb8e5bdab90854133224f13f02df8518f172`.
- Notion External Provider private routing, R2 integration and deployment isolation validated. A successful platform release does **not** grant HomeMew Application permission to execute every new model and does **not** deploy HomeMew Web.

## Problem and decision

The existing HomeMew Web deployment verifier explicitly allows Core `0.48.0/0.49.0` and Identity `0.11.0` only. After the platform release, an attempted HomeMew Web production deployment would fail its status contract gate *before building/deploying Web*, despite a successfully verified LifeSpace release.

Update the reviewed allowlist, **not a numerical wildcard**:

| Service | Reviewed contract versions | Minimum schema per contract |
|---|---|---|
| Core | `0.48.0`, `0.49.0`, `0.53.0` | 53, 53, **72** |
| Identity | `0.11.0`, `0.12.0` | 10, **11** |

Preserve fail-closed service/environment/status checks. Reject unsupported intermediate/forward contracts and incompatible partial schema upgrades. This is a **HomeMew-owned release verification adjustment**; it neither proxies credentials to the browser nor creates a second authority/runtime.

## Rollout and real user validation

- Require the full HomeMew Web tests, typecheck and build. No automatic deployment from merge.
- Before the owner-triggered production Web deployment, verify HomeMew's staging bindings, separate staging application/session secrets, Cloudflare Access bypass allowlists and backend routes if using `?env=staging`.
- Goal, Habit, Anniversary, Activity require both published LifeSpace models **and** HomeMew Application × Model Access / household authority in the target environment. Habit ownership and Check-in must be enforced by Core; UI only mirrors it.
- Football Match/Goal remain outside LifeSpace Baseline; user must manually publish via Console before live football functionality can be tested.
- Do not mark HomeMew Web deployed until [its own production workflow](https://github.com/huangshirui/HomeMew/actions/workflows/web-production-deploy.yml) succeeds and real browser authentication / household acceptance completes.

The 2026-10-19 Core 0.49 compatibility decision remains historical for its release window; this supersedes its allowed-release matrix for current Web.
