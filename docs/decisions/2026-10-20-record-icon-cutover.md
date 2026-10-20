# Decision: One-time Record Icon cutover / 日子图标一次切换

Date: 2026-10-20  
Status: Accepted (implementation in PR, not deployed)  
Tracking: [HomeMew #132](https://github.com/huangshirui/HomeMew/issues/132) / [LifeSpace #390](https://github.com/huangshirui/LifeSpace/issues/390)

## Decision / 决策

LifeSpace Native Records have optional `presentation.icon` with Emoji or uploaded static PNG/JPEG/WebP image; uploaded files are limited to **256 KiB and 512×512 pixels** by Core. DayRecord's legacy `data.icon` is migrated exactly once to shared metadata by Core migration 0069, then removed from the Baseline Model. Do not ship a legacy dual read/write, protocol adapter, version-detection mechanism or temporary `icon:null` filter.

HomeMew Mini BFF's product Day DTO returns **optional** `presentation.icon`, omitting `presentation` altogether if the Core record has no Icon. Original business Create/Update DTOs optionally accept `presentation: { icon }` and forward it in the **same Core Record POST/PATCH**. There is **no independent Icon PATCH**. A fixed `day-records/icon-image` POST supports pre-creation private image upload; record-scoped `day-records/{id}/icon-image` GET serves the assigned image. Web consumes the same shared metadata via session-scoped Core BFF; no direct client R2 credentials or persistent signed URLs. The new Mini UI edits Emoji or uploads/compresses images, then submits **exactly one business Record mutation** with optional presentation; unmodified existing Icons are not touched. It uses Bearer-authorized BFF requests to load temporary local image data.

## Rollout / 上线顺序

1. LifeSpace Staging: schema 69 migration plus File/R2 governance, hot-query budgets and data audit.
2. HomeMew BFF/Web/Mini integration tests against new Core contract; no old Mini compatibility acceptance requirement.
3. Manually approved LifeSpace production + HomeMew BFF/Web deployment (controlled cutover).
4. New WeChat Mini program submitted for review, then published when approved. During this review the entire **Days** section in older Mini may be unavailable. This is explicitly accepted; other application features must remain intact.
5. Verify production Data/Icons post-cutover. Never announce deployed status from CI or merged source.

## Non-goals / 不做

No permanent legacy DayRecord icon field; no other icon types (built-in-name/remote-URL/SVG); no second HomeMew data store; no general-purpose arbitrary Core proxy; no forced WeChat upgrade for the short review window.

## Optional presentation / 元数据不强制

Create without `presentation` persists no Icon; GET/list omits `presentation` for records without Icon; PATCH without `presentation` preserves any existing Icon; PATCH with `presentation.icon=null` clears it. HomeMew Web and Mini must use `record.presentation?.icon`, never assume a mandatory metadata object. Missing metadata must not affect existing operations or Legacy Event/Task/Wish clients.
