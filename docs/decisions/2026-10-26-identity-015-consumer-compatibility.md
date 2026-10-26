# HomeMew compatibility with LifeSpace Identity 0.15 / Core 0.53 schema 74

Date: 2026-10-26  
Status: Release-compatibility correction; platform already in Production, HomeMew candidate requires normal release process  
Scope: Web/BFF deployment baseline, cached Access sessions, stable Mini Program application contract

## Verified platform facts

- [LifeSpace Production #40328058875](https://github.com/huangshirui/LifeSpace/actions/runs/40328058875) succeeded for immutable SHA `cc735f9a357c13ab506960e0c49fba5d794cfe22`, with **Identity API 0.15.0 / schema 14** and **Core Kernel 0.53.0 / schema 74**.
- Identity 0.15 `GET/PATCH /api/v1/me/web-login` uses an authenticated LifeSpace-global user mailbox reservation, not a HomeMew Application-specific authorization. The response remains `{data:{email,version,linked,status}}` with `unlinked/pending/linked`.
- Its `PATCH` accepts `{email,version}`, returns `EMAIL_ALREADY_LINKED` for another user's reserved mailbox, `EMAIL_VERSION_CONFLICT` on optimistic concurrency, and does not alter the underlying `usr_*` or unrelated login identities.
- Its `POST /internal/v1/access/session-check` revalidates a verified Access assertion and current linked principal, returning `ACCESS_PRINCIPAL_UNLINKED` (409) where applicable. HomeMew Web must not recycle signed cached sessions bypassing this check.
- Current HomeMew Mini BFF routes `/api/v1/miniprogram/me/web-login` GET/PATCH to the fixed LifeSpace Identity endpoint and preserves its envelope, request ID, status and error codes. Mini does not speak the upstream wire format directly.

## Decision / 结论

1. The HomeMew release baseline **accepts only** reviewed Identity **0.15.0** with schema **at least 14**; Core **0.53.0** requires schema **at least 74**. Do not auto-accept unknown versions by numeric ordering.
2. HomeMew Web BFF and existing Mini clients keep their current request paths and successful data payloads. No new LifeSpace auth or household-data authority is implemented in HomeMew.
3. Add contract regression tests for Global mailbox DTO, `EMAIL_ALREADY_LINKED`/409 passthrough, version conflicts and cached Web session invalidation. Scope this PR to compatibility gates and evidence; no forced Mini code change, WeChat package/review, CI deploy or Production mutation.
4. The previous [2026-10-26 unified Access account-link decision](./2026-10-26-unified-access-account-link.md) documents the historical 0.14/schema 13 implementation. **Its distinction between pending unverified declarations, verified Access login, independent identities and no account merge remains applicable**, but the superseded Application-bound email ownership wording is replaced by the global mailbox reservation in 0.15.
5. After PR CI and merge, explicitly run the owner-managed `backend-staging-deploy.yml` and `web-preview-deploy.yml` on the exact candidate, then manually test Web login/account linking and Mini BFF backwards compatibility, and only afterward run owner-managed backend/Web Production deployment for the same SHA. Existing users and Production Web front door must remain unaffected until promotion.

## Mini Program conclusion

**LifeSpace 0.15 does not require changing or redistributing the native Mini Program.** The Mini's production BFF route remains the same; the code's existing `status` and `version` semantics are valid. Older clients that lack the mailbox UI still use other login flows. The new email-conflict error is returned as a failure rather than a false success even if an old Mini version does not locally translate its English message; translating it into Chinese is an independent optional Mini UX improvement requiring its normal WeChat release process.
