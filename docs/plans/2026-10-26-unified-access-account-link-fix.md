# Unified Access account linking repair

User correction, 2026-10-26: Mini email pre-link and Access-verified one-time code confirmation are two ways to bind the same existing LifeSpace user. They are not independent authorization modes.

## Data and runtime

- Keep `access_principals` as the sole durable Access account-link authority. Permit a pending row with null subject, declared email in the same email column, and the Application allowed to complete the initial binding. A pending row grants no token.
- After signature/issuer/lifetime/registered-audience checks, the first matching Access login atomically fills the pending row's subject. Resolve the resulting confirmed `(issuer,subject)` record through the ordinary login path. No perpetual email fallback.
- Code confirmation completes/inserts the same kind of confirmed principal row. Existing code-linked emails appear in the same GET settings response. Do not disable code confirmation because an email was entered.
- Use a user-owned monotonic link revision for optimistic concurrency and atomic mutation markers; this is concurrency metadata, not a second identity map. Preserve old subject denial when an explicitly selected binding is replaced. Preserve unrelated established Access identities and normal global principal behavior.
- Add migration 0013 because 0012 has executed in Staging. Preserve established mappings, migrate old pending mailbox declarations, rename the bounded audit table and remove `web_login_emails`; never rewrite 0012. Reject conflicting declarations rather than merge users.
- Bump Identity contract to 0.14, preserve the bounded Mini DTO envelope with additive pending/confirmed status. Cover code-first/email-first convergence, races, conflicts, audience/signature/user denial, replacement and legacy migration.

## Application

- Mini/Web copy calls both operations account binding. Expose code linking as an alternative without redirecting it away on the basis of an email declaration. Refresh settings from the canonical record. HomeMew stores no identity authority.
- Keep unrelated working-tree changes outside the fix PRs. Preserve already-active Location fixes.

## Release discipline

- Commit -> PR -> required CI success -> merge -> exact-candidate Staging/Preview -> acceptance -> exact-candidate Production.
- Enforce merged PR/CI provenance before any deployment mutation. Production checks for successful Staging/Preview on the exact candidate SHA. Keep existing owner-only manual dispatch and typed confirmation gates.
- This correction turn changes code/docs/tests and creates PRs; it does not dispatch any deployment or mutate a remote database. Staging remains at the interrupted old release until a separately approved correction rollout.
