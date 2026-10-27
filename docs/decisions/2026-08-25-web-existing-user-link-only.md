# HomeMew Web uses existing Mini Program users only

Status: Accepted

Date: 2026-08-25

## Decision

HomeMew treats the WeChat Mini Program as the base client and the account-entry client. HomeMew Web is an advanced client for an already-existing HomeMew/LifeSpace user.

For an unknown Cloudflare Access principal, HomeMew Web therefore supports exactly one onboarding path:

1. create a LifeSpace Access link challenge;
2. show the one-time challenge to the user;
3. the already-authenticated HomeMew Mini Program confirms it with its existing LifeSpace user bearer;
4. LifeSpace Identity binds the verified Access principal to that existing global `usr_*`;
5. Web retries `/api/session` and enters the application as that same user.

HomeMew Web must not expose or proxy LifeSpace Access registration and must not create a new LifeSpace user from the Web onboarding flow. A user who has never used HomeMew is directed to complete first use in the Mini Program before linking Web.

## Product positioning

- Mini Program: base client, first-use/account-entry client, normal household functions.
- Web: advanced client, larger-screen household management and Web-only advanced capabilities such as external-system administration.
- LifeSpace: platform identity remains application-neutral. LifeSpace may continue to support explicit Access registration for other applications.

## Identity boundary

This is a HomeMew product policy, not a LifeSpace platform limitation.

LifeSpace still owns verified Cloudflare Access `(iss, sub) -> usr_*` mapping and proof-backed account linking. HomeMew must not keep its own Access-subject mapping or accept a browser-supplied target `userId`.

LifeSpace is expected to support user merge as a future platform capability so accidental or legitimate duplicate global users can be reconciled across applications. HomeMew Web does not depend on merge for its normal onboarding path because it avoids creating a second user in the first place.

## Implementation consequences

- Remove the HomeMew Web UI for “create new account”.
- Remove `/api/access/register` from the HomeMew Web BFF surface; direct calls return `NOT_FOUND` and are never forwarded to Identity.
- Keep `/api/access/link-challenge` and Mini Program confirmation as the only HomeMew Web first-link flow.
- Update tests so registration is explicitly unavailable and link-challenge origin/security checks remain covered.
- Do not remove LifeSpace's platform registration contract as part of this HomeMew change.

## 2026-10-25 amendment

The accepted Mini 2.0 navigation/email decision extends code-only first-link behavior with an explicit user-authorized Web mailbox. Cloudflare Access still verifies Web login; no application email OTP is sent. Unknown users are never auto-created and principals are never silently merged. See `2026-10-25-miniprogram-2-navigation-email.md`. Pending platform rollout.
