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

## Mini Record Icon picker UX / 图标选择器设计（2026-10-20 补充）

- **统一组件，不在表单内展开 Emoji 宫格**：DayRecord / Event / Task / Wish 的新建及编辑页，在标题/名称左侧展示小型 Icon 入口。未设置时显示淡色加号占位，已有 Emoji 或已上传图片时显示当前图标；点击打开通用底部选择器 `components/record-icon-picker`。普通表单不再占用一整块图标卡片。
- **完整的 Unicode Emoji 集合**：选择器使用仓库内随小程序一起打包的 Unicode 17.0 `emoji-test.txt` 完整 fully-qualified repertoire（3,944 个，包括肤色/性别/家庭组合），按“常用、表情、人物、动物自然、食物饮品、旅行地点、活动、物品、符号、旗帜”分类标签。支持搜索（Unicode 官方英文名称、部分常用中文关键词与 Emoji 字符），结果每次仅渲染 72 个，滚动继续加载。**新 Emoji 的显示取决于微信与设备系统字体，不能保证每台设备显示一致**。
- **图片和清除**：同一弹层可从相册/相机选图片，选择时仅保存临时路径并在表单显示预览，真正的压缩与受授权预上传发生在提交时。限制仍是静态 PNG/JPEG/WebP、256 KiB / 512×512，服务端独立检验；清除操作发送显式 `presentation.icon=null`。
- **元数据始终可选**：无 Icon 不发/不读 presentation，用户不修改已有图标时不会重写它。Emoji/上传文件 ID 与业务内容在一个原子 Record POST/PATCH 里保存；没有独立 Icon 修改请求。
- **范围**：Mini 共享选择器；Web 仍有自己的 React RecordIconField，但 API / 数据语义完全一致。开发分支 [HomeMew Draft PR #133](https://github.com/huangshirui/HomeMew/pull/133)。目前尚无真实微信设备 UX 验收/生产发布，相关 CI 环境现出现空步骤 runner 启动失败，不能误报为新提交通过。
