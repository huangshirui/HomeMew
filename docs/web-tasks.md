# HomeMew Web Tasks

Updated: 2026-08-24

`/tasks` is a W5 household-domain page backed directly by the published LifeSpace `task` model.

Current slice:

- pending/completed views;
- pending grouping into overdue, today, upcoming, and undated using the selected family's IANA timezone;
- text search using the LifeSpace generic `q` query;
- create/update/soft-delete with optimistic `version` concurrency;
- complete/reopen through LifeSpace task Actions;
- assignee selection using current Space Person IDs;
- viewer role is read-only UX while LifeSpace remains authoritative.

API:

```text
GET    /api/lifespace/core/v1/spaces/{spaceId}/tasks
POST   /api/lifespace/core/v1/spaces/{spaceId}/tasks
PATCH  /api/lifespace/core/v1/spaces/{spaceId}/tasks/{taskId}
DELETE /api/lifespace/core/v1/spaces/{spaceId}/tasks/{taskId}
POST   /api/lifespace/core/v1/spaces/{spaceId}/tasks/{taskId}/actions/complete
POST   /api/lifespace/core/v1/spaces/{spaceId}/tasks/{taskId}/actions/reopen
```

HomeMew introduces no task compatibility API or business-data store.
