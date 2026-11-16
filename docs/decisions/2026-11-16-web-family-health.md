# Decision: HomeMew Web Family Health / 家庭健康

Status: Accepted product scope; incremental draft implementation, not released. Tracking #190.

- Web-only /health: desktop 家庭生活 (renamed from 生活与回忆), mobile More mirrors it, no Mini Program or bottom-tab changes. Four tabs: 概览 / 健康指标 / 健康事件 / 健康档案, one household member selector across all.
- Reuse LifeSpace health_metric, health_observation, health_event, health_document. Metric definition is Space-level; the other three use the same-family subjectPersonId. No duplicate model, data store or ALOHA UI framework. Only deliberately family-shared health data; personal medical files are not implicitly shared.
- Family selection is context, not ACL. Current Core authorization and model policy are authoritative; a viewer's hidden controls are only UX. No automatic grants, no policy bypass, no health content in browser persistent storage or telemetry. Current Registry/Model Access and negative tests must be verified before release.
- First draft slice: navigation, member-scoped bounded queries, metric definitions and observation CRUD with optimistic concurrency, unit-consistent loaded-history trends; event/document metadata read only. Remaining MVP: quick combined height/weight, metric definition lifecycle and dedupe, health event CRUD, authorized file upload/view/document CRUD, semantic links to Event/Task and production checks.
- Follow the current Web same-origin BFF, no new generic proxy or persistent backend. Separate platform approval if Core policy/capability needs changes. No deploy without required review, CI and owner-controlled Preview/Production workflow.
