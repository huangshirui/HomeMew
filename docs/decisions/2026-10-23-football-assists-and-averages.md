# Decision: Optional credited assists on FootballGoal and personal per-match averages

Date: 2026-10-23
Status: Accepted product change; runtime Model Definition must be published separately

## Model contract / 模型

- Reuse the ordinary published LifeSpace `football_goal` record. Add `assisterPersonId` as an optional/nullable `person` reference to the same Space Person directory. One credited assist maximum per goal. No `FootballAssist` model, no integer assist counter on FootballMatch and no HomeMew shadow storage.
- Extend `query.filterable` with `assisterPersonId` for player-specific browsing. Preserve all existing Match, Scorer, Method and Notes semantics and existing records; missing assister data is allowed.
- The user must not select the scorer as the assister of the same goal; this UI invariant is enforced at HomeMew entry time. Do not pretend client validation is platform policy.
- Empty/missing assist means `not recorded`, not definite proof that the goal was unassisted; it does not accrue a recorded assist to anyone.
- Football models are ordinary Console-published LifeSpace models (not baseline catalog). The [Notion draft Schema JSON](https://app.notion.com/p/3e6873b4a6a28142a9e8e2d9c825c5ea) is updated for the field and filter but is not itself deployment. Staging/Production Model Definition versions must be independently verified/published before assisted-goal create attempts are accepted.

## Personal statistics / 个人统计

- Only active HomeMew Family Membership-linked Space Person IDs appear as personal-statistics rows; non-family participants remain valid match/goal/assist records but are excluded from family profiles.
- `appearances = count(matches where playerPersonIds contains this person)`. Duplicate IDs inside one match must count once.
- `goals = count(football_goal where scorerPersonId is this person and match is in the selected match filter)`. `assists = count(football_goal where assisterPersonId is this person, scorer differs, and match is in filter)`.
- `goalsPerMatch = goals / appearances`; `assistsPerMatch = assists / appearances` formatted to 2 decimal places; if appearances=0 display em dash, never 0.00 or Infinity. Missing recorded match participation is not silently inferred from a goal/assist; such anomalies require a future validation/data-quality UX.
- `FootballMatch` team score is not an authoritative source for personal goal or assist events. No synthetic assists can be inferred from team score.

## Implementation / 范围

- Add the scorer/assister entry and personal average displays to HomeMew Web PR #142 without changing the platform repository. Existing soccer UX redesign (searchable full Person directory, compact match list, five filters, family-player-first dashboard) remains a separate follow-up, not deemed done by this incremental change.
- Before Preview writes with assisterPersonId, publish the updated FootballGoal Model Definition and check the current application/model permissions in LifeSpace staging. Production remains gated by separate owner approval.
