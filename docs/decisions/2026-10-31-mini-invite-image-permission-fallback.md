# HomeMew Mini invite image: native album permission and restricted-sharing fallback

Date: 2026-10-31
Status: Accepted for Mini client fix
Scope: `apps/miniprogram` only; no LifeSpace/BFF/Backend change

## Context

The QR generation path delivered by PR #167 was successfully deployed in Production, and a real device successfully generated a Mini Program invite code. However, the user reported that direct sharing was blocked and album saving reported insufficient permission. The first Mini implementation called `wx.saveImageToPhotosAlbum` without checking or requesting `scope.writePhotosAlbum`. A separate WeChat account verification policy can also restrict the `wx.showShareImageMenu` share action; application code cannot grant privileges that WeChat denies.

## Product and UX decision

1. Request `scope.writePhotosAlbum` only when the user explicitly taps **保存图片到相册**, not when merely generating/viewing the QR code.
2. Use `wx.getSetting` to distinguish granted / never asked / previously denied. For first use, call `wx.authorize`. When previously denied, reveal the native `open-type="openSetting"` button; after authorization is granted, retry saving.
3. Treat an OS-level photo-writing denial separately when WeChat's Mini Program scope already reads as granted. Display a clear message rather than a misleading reauthorize loop.
4. On image share failure, report that WeChat disallowed sharing, without claiming that album saving will necessarily succeed or trying to work around platform verification.
5. Allow a user to tap the QR image for native fullscreen preview and take a normal phone screenshot, then send it from the user's own WeChat conversation. Keep the existing **复制邀请码** path. The QR image remains ephemeral in local Mini Program files; do not expose the original invitation as a public Web URL.
6. QR generation, LifeSpace grants, explicit family join consent, production BFF routing, and Mini develop/trial/release version selection remain unchanged.

## Acceptance criteria

- First use, granted permission, denied permission, Settings recovery, and OS-level denial are tested; repeated taps do not trigger duplicate save requests while one save is active.
- Existing QR generation and scanning are unaffected. Test on real iOS/Android WeChat builds, distinguishing Mini scope, phone system permission and account verification restrictions.
- Merging/publishing Mini client code follows the repository release discipline. Production backend and Web BFF do not need to be redeployed for this client-only fix.
