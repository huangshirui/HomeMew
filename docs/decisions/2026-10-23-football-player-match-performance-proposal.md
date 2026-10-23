# Proposed: Family-player match performance (goals + assists)

Date: 2026-10-23
Status: **Proposed model, not published**. Supersedes the withdrawn goal-level assist proposal from earlier today.

## Product intent / 产品目标

HomeMew football records are organized **by one family player in one match**, not by an individual scoring event. For each participating tracked family member, record the confirmed number of goals and assists **for that match**, including explicit zeroes. Team scores and all other match metadata remain on FootballMatch.

### Correct model responsibility / 模型职责

| Model | Owns | Notes |
| --- | --- | --- |
| football_match | date, teams, type, score, participation roster | Existing published ordinary model |
| **football_player_match_stat** (proposed) | matchId, playerPersonId, goals, assists, optional notes | One logical row per player per match. Both counts nonnegative integers. |
| football_goal | optional individual goal events | Existing single-goal model. **Do not** add an assister Person field. HomeMew stats must not require recording every goal. |
| person_group / activity | team / tournament | Reused existing model identifiers; hide their technical names in UX |

Fields for new ordinary model: `matchId: record(football_match), required, immutable`; `playerPersonId: person, required, immutable`; `goals: integer >= 0, required`; `assists: integer >= 0, required`; `notes?: text`. Filter matchId and playerPersonId (with indexed Canonical Query). The draft Schema JSON is recorded in the LifeSpace Notion model board.

## Semantics and consistency / 口径

- The record represents a **confirmed played match**. A performance of 0 goals and 0 assists is an explicit observation; no record means stats have not been entered, *not* confirmed zero.
- `playerPersonIds` on FootballMatch remains the known roster, which may include non-family Space People; do not equate the roster with all recorded performance rows.
- HomeMew stats are only displayed for the current family member-linked Space People; an outside player can still be a participant but is not listed on the family-person analysis dashboard.
- Goals/assists total for a player are sums of `goals`/`assists` over that person's completed, recorded per-match performance rows, subject to the same match filters.
- `recordedAppearances` is the number of distinct matched performance rows for the selected player. `goalsPerMatch = totalGoals / recordedAppearances`; `assistsPerMatch = totalAssists / recordedAppearances`. Zero denominator -> em dash, never zero. Display two decimals; show outstanding participation records as `未补录`, not 0.
- Separately surface total recorded participation in FootballMatch when it exceeds complete performance rows, and flag incomplete tracking rather than presenting a misleading fully-covered season average.
- At save time, selecting a family participant opens two small number fields. For scheduled matches leave them unconfirmed; for played matches allow explicit 0/0. The stats record is associated with the match and should not be regenerated from FootballGoal or team score.

## Platform correctness gap and release

- One logical record for a pair (matchId, playerPersonId). Before publishing, verify LifeSpace supports or needs authoritative composite uniqueness/upsert. The current model DSL's ordinary fields do not appear to expose a composite unique-key declaration. **Do not call a client-side existence check an authoritative uniqueness guarantee.**
- Publishing a new ordinary model requires its own LifeSpace Registry publication, staging validation, application × model access, then a separate production step. A Notion draft does not publish it.
- Keep existing FootballGoal records intact; if historical granular goals are migrated/aggregated into player-match stats, do so explicitly and deduplicate per match/person without rewriting historical events. Old games with only `playerPersonIds` must be marked missing performance, not assigned 0/0.
- Until the model is published and integrations verified, leave Web PR #142 football behavior unchanged. Previously committed goal-level assist UI/tests were reverted and their incorrect decision document deleted.

The user requested the per-player match-level model, not a per-goal credited assist Person.
