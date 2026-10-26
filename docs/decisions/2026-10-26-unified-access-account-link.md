# Unified Access account linking and release discipline

Date: 2026-10-26
Status: Accepted by direct user clarification; implementation delivered through PR/CI, deployment separate
Scope: Mini/Web account linking, Identity contract consumption, deployment provenance

## One identity relation, two entry points

The user clarified that entering an email in Mini and confirming an Access login's one-time code are alternative ways to bind the same existing LifeSpace user. The separate mailbox-authorization design in the email sections of `2026-10-25-miniprogram-2-navigation-email.md` is superseded. Its unrelated navigation decisions remain unchanged.

LifeSpace Identity 0.14/schema 13 owns one Access identity relation in `access_principals`. Mini email entry creates a pending row with declared `email_snapshot`, no verified subject, and an Application-bounded completion context. A pending declaration grants no token. After Access independently proves issuer/signature/lifetime/registered audience and mailbox, Identity completes the verified subject in that same row. All subsequent login/session resolution uses the ordinary issuer/subject mapping. Equal email on another subject cannot reuse a completed pre-link.

Code confirmation writes the same confirmed principal shape and completes an existing pending row when applicable. Its email is visible in the same settings response. Configuring an email does not block the code flow. HomeMew presents both as account binding, distinguishes pending versus confirmed state, and never claims email ownership was proved by a Mini form.

Changing the selected email disables that selected old subject and creates a new pending relation atomically, guarded by the current link revision. Other established identities remain intact. Existing global Access principals retain global identity semantics across registered Application audiences. Conflicts never merge users. Cached Web sessions recheck current subject eligibility through Identity; existing short-lived bearers expire normally.

Migration 0012 has executed in Staging. Repair must use additive migration 0013, preserve established mappings, migrate declarations, remove the separate `web_login_emails` authority and preserve non-secret audit. HomeMew persists no identity links or household truth.

## Deployment discipline

Required order: commit -> PR -> required CI -> merge -> exact-candidate Staging/Preview -> acceptance -> exact-candidate Production. Normal releases use repository-owned manual workflows. They must not publish uncommitted working-tree bundles or use direct Cloudflare uploads/SQL as substitutes for the release path.

The workflow must verify before any environment mutation that its immutable SHA is a merged PR candidate with successful required head CI. Production additionally requires successful Staging/Preview for the same SHA. Existing manual owner/confirmation, Access, isolation and performance gates remain. Backend Staging is manual-only rather than deploying automatically on push.

This correction implements code/docs/tests and PRs. It does not dispatch deployment, run remote migrations, upload Mini packages, or assert that already-interrupted Staging is corrected. Recorded state at stop: Staging Identity 0.13/schema 12; Production Identity 0.12/schema 11.

Required Web and Backend CI runs on every PR, including documentation-only changes. Otherwise a reviewed docs merge could become main without the evidence required by the exact-candidate release gate. This broadens validation only; deployments remain manual-only.
