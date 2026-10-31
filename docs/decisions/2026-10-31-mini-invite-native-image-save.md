# HomeMew Mini: try the native WeChat image menu for QR saving

Date: 2026-10-31
Status: Experimental implementation; final availability requires real-device testing.
Scope: HomeMew Mini Program UI only; no changes to LifeSpace, Web BFF, or Backend.

## Why

The QR invite-code generation and scan/join flow works on a real device, but the app-level `wx.saveImageToPhotosAlbum` path still reports insufficient permission even after PR #171's scope-based handling. Current HomeMew's AppID is unverified, and native image sharing is already known to be restricted.

The "official SaveButton security control" described for HarmonyOS is an ArkUI system security component for **native HarmonyOS applications**. It is **not** a WeChat Mini Program WXML component, even if WeChat is running on a HarmonyOS handset. We must not import ArkUI code or claim its temporary permission semantics apply to WeChat.

## Scoped experiment

- Retain the existing short-lived local QR PNG/JPEG provided by HomeMew Mini BFF; do not publish a sensitive invitation-code image on an unauthenticated public URL.
- Enable the official WeChat `<image show-menu-by-longpress="{{true}}">` menu. `wx.previewImage` explicitly passes `showmenu: true`. The user chooses "保存图片" in WeChat's own UI.
- The Mini app presents a **查看并保存** button that only opens the native WeChat preview with menu support; it does not programmatically press Save. The Mini app no longer calls `wx.getSetting`, `wx.authorize`, `wx.saveImageToPhotosAlbum` or renders `open-type="openSetting"` just to save this QR image. Remove the currently failing programmatic save button; replace it with a clearly labeled fullscreen-preview action. The native menu itself may still be limited by WeChat version, app verification or device policy.
- Keep manual screenshot and plaintext invite-code copying as fallbacks; never promise native menu success or bypass platform share/verification restrictions.
- User acceptance is essential: Android/iOS and any HarmonyOS WeChat device available should test (a) long-press on embedded image, (b) tap fullscreen then long-press, (c) file appearing in the album, and (d) QR scan/join. If not available, preserve screenshot fallback.

## Evidence and rollback

- The Mini client has dedicated regression tests asserting the native menu is enabled, preview invokes `showmenu: true`, and app-level scope/album API calls are absent.
- If testing disproves the menu path, keep UI fallback, document WeChat's actual failure and reassess. Do not add insecure public QR hosting or a pretend HarmonyOS SaveButton component.
