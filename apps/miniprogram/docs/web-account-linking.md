# Web account linking

HomeMew Web uses Cloudflare Access for browser authentication, while the Mini Program already represents an authenticated LifeSpace user. Existing-account linking must join those identities only through the LifeSpace Identity one-time challenge contract.

## Staging / MVP flow

1. HomeMew Web receives `ACCESS_PRINCIPAL_UNLINKED` from `GET /api/session`.
2. Web calls `POST /api/access/link-challenge` and displays the returned `alc_*` challenge ID.
3. The user opens the Mini Program and goes to **我的 → 设置 → 关联 Web 登录**.
4. The Mini Program submits the challenge to `POST /api/v1/me/access-link-challenges/{challengeId}/confirm` on LifeSpace Identity using its existing short-lived LifeSpace user bearer.
5. LifeSpace Identity derives the target `usr_*` only from that verified bearer and links the verified Access `(iss, sub)` to it.
6. Web retries `GET /api/session`; Identity now exchanges the Access assertion for a HomeMew-Web-scoped user token for the same global user.

## Security rules

- The Web client and Mini Program never submit a target LifeSpace `userId`.
- Email is never used to merge accounts.
- The challenge is high-entropy, short-lived and single-use.
- The confirmation request goes directly through the shared authenticated Mini Program request layer to LifeSpace Identity.
- Do not retry the confirmation POST blindly; an expired/consumed challenge must require a new challenge.
- Manual copy/paste is the first staging/MVP UX. QR code or Mini Program deep-link support may carry the same challenge ID later, but must preserve the same Identity contract and confirmation semantics.
