# HomeMew Web Home / Today

Updated: 2026-08-24

The Web home page contains no preview/fake household data. It aggregates the selected family's current LifeSpace state through the existing same-origin BFF.

Current Today surface:

- Calendar events overlapping the current family-local day;
- pending tasks due today or overdue;
- Temporal day records currently requiring attention;
- quick task completion through the LifeSpace `complete` Action;
- counts and navigation are derived only from those real responses.

The selected Space timezone defines today's date and the timed-event query boundary. HomeMew stores no aggregation copy.

This is the first post-W5 aggregation slice and is verified against the stacked Calendar/Tasks/Days/Wishes implementation rather than the old preview page.
