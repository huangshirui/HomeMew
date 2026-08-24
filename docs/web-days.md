# HomeMew Web Days

Updated: 2026-08-24

`/days` is backed directly by LifeSpace `day_record` and the Temporal capability.

Current slice:

- elapsed, countdown and cycle records;
- Temporal-computed remaining/elapsed days and attention state;
- active/archive views;
- create/update/soft-delete with `version` concurrency;
- archive/restore model Actions;
- `record-occurrence` for elapsed/cycle records;
- optional Space Person association;
- family timezone remains authoritative for `today` and Temporal validation.

HomeMew does not recalculate or persist authoritative Temporal state; it displays the `computed.temporal` response from LifeSpace.
