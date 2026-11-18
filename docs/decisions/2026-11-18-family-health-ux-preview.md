# Decision: Family health UX review iteration and bounded reads

Date: 2026-11-18
Status: Owner requested Preview; no production acceptance.
Refs #190, #191, #193.

- Keep four existing LifeSpace health models and the existing family Space subject boundary. Family avatars are lightweight initials; selected Person and metric persist across tab/member changes within the same workspace. No background data loading for other people.
- Overview: latest bounded measurements, height/weight/BMI cards, direct actions. Use recent observation page (12) first, at most one additional filtered growth query (20) if needed and recent page is incomplete. No adult/child classification or synthetic values. Indicator list is shared at Space level (40/page), one current workspace instance; time presets filter observations on Core, history page 30; explicit more only.
- One current Space runtime discovery projection supplies effective access and enum semantics; never static detail as authority. Model-specific controls reflect capability preview; execution rechecks current Core authority. Clear denied lists; scope keyed by user/Space/role and selected subject, no persistent cache or polling. Refresh explicitly, no cross-user data reuse. In-flight identical reads coalesced locally; no N+1 reference/file fetch.
- Events use chronological details, existing links; documents use server-side category filter and on-demand authenticated file preview from bounded transient Blob, sandboxed PDF, safe image types and download fallback. Object URLs revoked on close; original BFF and governed file authority unchanged. Lazy event chooser; creation uses BFF same-subject validation, editing verifies changed relation.
- Preview user review and actual D1 rows_read/written comparison with synthetic data remain required; application request targets are not measured D1 costs. Production model access and external agent scope remain separate release gates.
