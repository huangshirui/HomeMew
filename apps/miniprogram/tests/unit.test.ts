/**
 * HomeMew miniprogram pure-function unit tests.
 *
 * Run (zero deps, no monorepo config changes):
 *   cd apps/miniprogram
 *   node --experimental-strip-types tests/unit.test.ts
 *
 * All modules under test are self-contained (no wx / no relative
 * extension-less imports) so they run directly in Node.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { evaluateToken, normalizeBaseUrl, generateRequestId } from '../miniprogram/services/config.ts';
import { shouldAutoRetry, extractData } from '../miniprogram/services/request-utils.ts';
import { getErrorMessage, ERROR_MESSAGES } from '../miniprogram/utils/errors.ts';
import { resolveCurrentFamily } from '../miniprogram/stores/family-state.ts';
import {
  addDaysYmd,
  addMonths,
  monthLabelOf,
  dateLabelOf,
  weekLabelOf,
  eventDaysInRange,
  buildCalendarMatrix,
} from '../miniprogram/utils/event-timeline.ts';
import {
  formatInstantInTimeZone,
  getWallTimeCandidates,
  resolveDeviceTimeZone,
} from '../miniprogram/utils/datetime.ts';
import {
  buildTimeZoneOptions,
  searchTimeZoneOptions,
} from '../miniprogram/utils/timezones.ts';
import { isEventEnded, isEventOngoing, eventDisplayRank } from '../miniprogram/utils/event-status.ts';

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const SOON = new Date(Date.now() + 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

// ============ 1. 204 response handling ============
test('extractData: 204 returns undefined', () => {
  assert.equal(extractData(204, ''), undefined);
  assert.equal(extractData(204, '{}'), undefined);
});

test('extractData: 2xx parses the data envelope', () => {
  assert.deepEqual(extractData(200, { data: { id: 1 } }), { id: 1 });
});

// ============ 2. GET 401 retry once ============
test('shouldAutoRetry: GET allows retry', () => {
  assert.equal(shouldAutoRetry('GET', false), true);
});

test('shouldAutoRetry: write requests are not retried', () => {
  assert.equal(shouldAutoRetry('POST', false), false);
  assert.equal(shouldAutoRetry('PATCH', false), false);
  assert.equal(shouldAutoRetry('DELETE', false), false);
});

test('shouldAutoRetry: explicit skipRetry skips', () => {
  assert.equal(shouldAutoRetry('GET', true), false);
});

// ============ 3. token invalid without expiresAt ============
test('evaluateToken: no token is invalid', () => {
  assert.equal(evaluateToken(null, FUTURE), false);
  assert.equal(evaluateToken('', FUTURE), false);
});

test('evaluateToken: no expiresAt is invalid', () => {
  assert.equal(evaluateToken('t', undefined), false);
  assert.equal(evaluateToken('t', null), false);
  assert.equal(evaluateToken('t', ''), false);
});

test('evaluateToken: unparsable expiresAt is invalid', () => {
  assert.equal(evaluateToken('t', 'not-a-date'), false);
});

test('evaluateToken: expired token is invalid', () => {
  assert.equal(evaluateToken('t', PAST), false);
});

test('evaluateToken: expires within 5 min buffer is invalid', () => {
  assert.equal(evaluateToken('t', SOON), false);
});

test('evaluateToken: ample validity is valid', () => {
  assert.equal(evaluateToken('t', FUTURE), true);
});

// ============ 4. current family restore rules ============
const famA = { id: 'a', name: 'A', avatarUrl: null, role: 'admin' as const, memberCount: 1 };
const famB = { id: 'b', name: 'B', avatarUrl: null, role: 'member' as const, memberCount: 2 };

test('resolveCurrentFamily: empty list returns null and clears cache', () => {
  const r = resolveCurrentFamily([], 'a');
  assert.equal(r.family, null);
  assert.equal(r.clearSaved, true);
});

test('resolveCurrentFamily: valid cache is restored', () => {
  const r = resolveCurrentFamily([famA, famB], 'b');
  assert.equal(r.family?.id, 'b');
  assert.equal(r.clearSaved, false);
});

test('resolveCurrentFamily: stale cache picks first and clears', () => {
  const r = resolveCurrentFamily([famA, famB], 'zzz');
  assert.equal(r.family?.id, 'a');
  assert.equal(r.clearSaved, true);
});

test('resolveCurrentFamily: no cache picks first', () => {
  const r = resolveCurrentFamily([famA, famB], undefined);
  assert.equal(r.family?.id, 'a');
  assert.equal(r.clearSaved, true);
});

// ============ 5. error code Chinese mapping ============
const REQUIRED_CODES = [
  'UNAUTHORIZED', 'FORBIDDEN', 'USER_NOT_FOUND', 'USER_DISABLED',
  'FAMILY_NOT_FOUND', 'FAMILY_CREATE_LIMIT_REACHED', 'FAMILY_MEMBER_LIMIT_REACHED',
  'ALREADY_FAMILY_MEMBER', 'LAST_ADMIN_CANNOT_BE_REMOVED', 'CANNOT_REMOVE_SELF',
  'INVITE_NOT_FOUND', 'INVITE_REVOKED', 'INVITE_EXPIRED', 'INVITE_EXHAUSTED',
  'INVALID_REQUEST', 'NETWORK_ERROR', 'TIMEOUT',
];

test('ERROR_MESSAGES covers all required error codes', () => {
  for (const code of REQUIRED_CODES) {
    assert.ok(ERROR_MESSAGES[code], `missing error code mapping: ${code}`);
  }
});

test('getErrorMessage: known code returns mapped copy', () => {
  assert.equal(getErrorMessage('USER_DISABLED', 'disabled'), ERROR_MESSAGES['USER_DISABLED']);
  assert.equal(
    getErrorMessage('FAMILY_MEMBER_LIMIT_REACHED', ''),
    ERROR_MESSAGES['FAMILY_MEMBER_LIMIT_REACHED'],
  );
});

test('getErrorMessage: unknown code falls back to Core message (ASCII input)', () => {
  assert.equal(getErrorMessage('STRANGE_CODE', 'RAW_MESSAGE'), 'RAW_MESSAGE');
});

test('getErrorMessage: unknown code without message returns non-empty generic copy', () => {
  const msg = getErrorMessage('STRANGE_CODE', undefined);
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0);
  assert.notEqual(msg, 'STRANGE_CODE');
});

// ============ 6. URL / requestId utilities ============
test('normalizeBaseUrl: strips trailing slash', () => {
  assert.equal(normalizeBaseUrl('https://x.com/'), 'https://x.com');
  assert.equal(normalizeBaseUrl('https://x.com///'), 'https://x.com');
  assert.equal(normalizeBaseUrl('https://x.com'), 'https://x.com');
});

test('generateRequestId: returns non-empty string', () => {
  assert.equal(typeof generateRequestId(), 'string');
  assert.ok(generateRequestId().length > 0);
});

// ============ 7. schedule timeline pure functions ============
// CJK expected values use \u escapes so the file is ASCII-only and
// encoding-independent. event-timeline.ts produces these exact strings.
test('addDaysYmd: cross-month / cross-year day arithmetic', () => {
  assert.equal(addDaysYmd('2026-07-27', 1), '2026-07-28');
  assert.equal(addDaysYmd('2026-07-31', 1), '2026-08-01');
  assert.equal(addDaysYmd('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysYmd('2026-03-01', -1), '2026-02-28');
});

test('addMonths: returns the 1st of the offset month', () => {
  assert.equal(addMonths('2026-07-15', 1), '2026-08-01');
  assert.equal(addMonths('2026-12-05', 1), '2027-01-01');
  assert.equal(addMonths('2026-01-05', -1), '2025-12-01');
  assert.equal(addMonths('2026-07-01', 0), '2026-07-01');
});

test('date labels: month / date / weekday', () => {
  assert.equal(monthLabelOf('2026-07-27'), '2026\u5e747\u6708');
  assert.equal(dateLabelOf('2026-07-27', '2026'), '7\u670827\u65e5');
  assert.equal(dateLabelOf('2025-12-31', '2026'), '2025\u5e7412\u670831\u65e5');
  // 2026-07-27 is a Monday
  assert.equal(weekLabelOf('2026-07-27'), '\u5468\u4e00');
});

test('eventDaysInRange: timed event is grouped by the viewing timezone', () => {
  const e = {
    startAt: '2026-07-27T15:30:00.000Z',
    endAt: '2026-07-27T17:00:00.000Z',
    startTimezone: 'Asia/Tokyo',
    endTimezone: 'Europe/Paris',
    isAllDay: false as const,
  };
  // Shanghai viewer: 2026-07-27 23:30 -> 2026-07-28 01:00 local.
  // The endpoint timezone metadata (Tokyo/Paris) is ignored; the viewing
  // timezone decides the day. Overlap semantics puts it on both 27 and 28.
  assert.deepEqual(
    eventDaysInRange(e, '2026-07-01', '2026-08-01', 'Asia/Shanghai'),
    ['2026-07-27', '2026-07-28'],
  );
  // Tokyo viewer: 2026-07-28 00:30 -> 02:00 local -> the 28th only
  assert.deepEqual(
    eventDaysInRange(e, '2026-07-01', '2026-08-01', 'Asia/Tokyo'),
    ['2026-07-28'],
  );
});

test('eventDaysInRange: endpoint timezone metadata never overrides the viewing day', () => {
  // Los Angeles Aug 1 18:00 == Shanghai Aug 2 09:00.
  // Core returns it inside the LA Aug 1 window, so the client must agree.
  const e = {
    startAt: '2026-08-02T01:00:00.000Z',
    endAt: '2026-08-02T02:00:00.000Z',
    startTimezone: 'Asia/Shanghai',
    endTimezone: 'Asia/Shanghai',
    isAllDay: false as const,
  };
  assert.deepEqual(
    eventDaysInRange(e, '2026-08-01', '2026-08-02', 'America/Los_Angeles'),
    ['2026-08-01'],
  );
});

test('eventDaysInRange: cross-midnight timed event spans both overlapping days', () => {
  // LA 7/31 22:00 -> 8/1 02:00 (PDT, UTC-7): starts before midnight, ends after.
  const e = {
    startAt: '2026-08-01T05:00:00.000Z',
    endAt: '2026-08-01T09:00:00.000Z',
    startTimezone: 'America/Los_Angeles',
    endTimezone: 'America/Los_Angeles',
    isAllDay: false as const,
  };
  // Full window: appears on both 7/31 and 8/1.
  assert.deepEqual(
    eventDaysInRange(e, '2026-07-01', '2026-09-01', 'America/Los_Angeles'),
    ['2026-07-31', '2026-08-01'],
  );
});

test('eventDaysInRange: cross-midnight timed event is not dropped when its start day is outside the loaded window', () => {
  // Same event as above, but the loaded window only covers August.
  // Old logic grouped by start day only (7/31) and dropped it; the overlap-aware
  // logic must keep it on 8/1 where it actually overlaps.
  const e = {
    startAt: '2026-08-01T05:00:00.000Z',
    endAt: '2026-08-01T09:00:00.000Z',
    startTimezone: 'America/Los_Angeles',
    endTimezone: 'America/Los_Angeles',
    isAllDay: false as const,
  };
  assert.deepEqual(
    eventDaysInRange(e, '2026-08-01', '2026-08-31', 'America/Los_Angeles'),
    ['2026-08-01'],
  );
});

test('eventDaysInRange: multi-day timed event fills every overlapping day', () => {
  // LA 8/1 09:00 -> 8/4 18:00: spans four calendar days in LA.
  const e = {
    startAt: '2026-08-01T16:00:00.000Z',
    endAt: '2026-08-05T01:00:00.000Z',
    isAllDay: false as const,
  };
  assert.deepEqual(
    eventDaysInRange(e, '2026-07-01', '2026-09-01', 'America/Los_Angeles'),
    ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'],
  );
  // Clipped to a narrower window: only the overlapping slice remains.
  assert.deepEqual(
    eventDaysInRange(e, '2026-08-02', '2026-08-03', 'America/Los_Angeles'),
    ['2026-08-02'],
  );
});

test('eventDaysInRange: all-day event covers each day and end is exclusive', () => {
  const e = {
    startDate: '2026-07-27',
    endDateExclusive: '2026-07-30',
    isAllDay: true as const,
  };
  assert.deepEqual(
    eventDaysInRange(e, '2026-07-01', '2026-08-01', 'Asia/Shanghai'),
    ['2026-07-27', '2026-07-28', '2026-07-29'],
  );
});

test('eventDaysInRange: cross-window all-day event is clipped (adjacent windows dedup by id)', () => {
  const e = {
    startDate: '2026-07-29',
    endDateExclusive: '2026-08-03',
    isAllDay: true as const,
  };
  assert.deepEqual(
    eventDaysInRange(e, '2026-07-01', '2026-08-01', 'Asia/Shanghai'),
    ['2026-07-29', '2026-07-30', '2026-07-31'],
  );
  assert.deepEqual(
    eventDaysInRange(e, '2026-08-01', '2026-09-01', 'Asia/Shanghai'),
    ['2026-08-01', '2026-08-02'],
  );
});

test('eventDaysInRange: malformed end <= start still shows start day', () => {
  const e = {
    startDate: '2026-07-27',
    endDateExclusive: '2026-07-27',
    isAllDay: true as const,
  };
  assert.deepEqual(
    eventDaysInRange(e, '2026-07-01', '2026-08-01', 'Asia/Shanghai'),
    ['2026-07-27'],
  );
});

test('buildCalendarMatrix: 6x7 grid, today and dots correct', () => {
  const rows = buildCalendarMatrix(2026, 7, '2026-07-27', new Set(['2026-07-27', '2026-07-05']));
  assert.equal(rows.length, 6);
  rows.forEach(row => assert.equal(row.length, 7));
  const cells = rows.flat();
  const day27 = cells.find(c => c.date === '2026-07-27');
  assert.ok(day27);
  assert.equal(day27.isToday, true);
  assert.equal(day27.hasEvent, true);
  assert.equal(day27.inMonth, true);
  const day5 = cells.find(c => c.date === '2026-07-05');
  assert.equal(day5?.hasEvent, true);
  const day1 = cells.find(c => c.date === '2026-07-01');
  assert.equal(day1?.hasEvent, false);
  // 2026-07-01 is Wednesday; first row has 3 leading out-of-month cells
  assert.equal(cells.filter(c => c.inMonth).length, 31);
});

// ============ 8. all navigated pages are registered in app.json and files exist ============
const appJsonPath = path.resolve(import.meta.dirname, '../miniprogram/app.json');
const appJson = JSON.parse(readFileSync(appJsonPath, 'utf-8'));
const REQUIRED_PAGES = [
  'pages/launch/launch',
  'pages/launch/disabled',
  'pages/profile-setup/profile-setup',
  'pages/home/home',
  'pages/profile/profile',
  'pages/family/join',
  'pages/family/detail',
  'pages/family/members',
  'pages/family/invites',
];

test('app.json registers all required pages', () => {
  for (const p of REQUIRED_PAGES) {
    assert.ok(appJson.pages.includes(p), `app.json missing page: ${p}`);
  }
});

test('registered page files (.ts / .wxml) all exist', () => {
  for (const p of appJson.pages) {
    const tsFile = path.resolve(import.meta.dirname, '../miniprogram', `${p}.ts`);
    const wxmlFile = path.resolve(import.meta.dirname, '../miniprogram', `${p}.wxml`);
    assert.ok(existsSync(tsFile), `missing page script: ${p}.ts`);
    assert.ok(existsSync(wxmlFile), `missing page template: ${p}.wxml`);
  }
});

// ============ 9. Core v8 time contract ============
test('Core DTOs use discriminated event shapes and dueDate without legacy fields', () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/types/index.ts'),
    'utf-8',
  );
  assert.match(source, /startAt:\s*string/);
  assert.match(source, /endDateExclusive:\s*string/);
  assert.match(source, /startTimezone:\s*string\s*\|\s*null/);
  assert.match(source, /dueDate:\s*string\s*\|\s*null/);
  assert.doesNotMatch(source, /^\s+start:\s*string/m);
  assert.doesNotMatch(source, /^\s+due:\s*string\s*\|\s*null/m);
});

test('event service requires the new date window and viewer timezone query', () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/services/events.ts'),
    'utf-8',
  );
  assert.match(source, /startDate:\s*string/);
  assert.match(source, /endDateExclusive:\s*string/);
  assert.match(source, /timezone:\s*string/);
  assert.doesNotMatch(source, /query\.start\s*=/);
  assert.doesNotMatch(source, /query\.end\s*=/);
});

test('formatInstantInTimeZone formats a UTC instant in endpoint-local time', () => {
  assert.deepEqual(
    formatInstantInTimeZone('2026-08-01T01:00:00.000Z', 'Asia/Tokyo'),
    { date: '2026-08-01', time: '10:00' },
  );
  assert.deepEqual(
    formatInstantInTimeZone('2026-08-01T16:00:00.000Z', 'Europe/Paris'),
    { date: '2026-08-01', time: '18:00' },
  );
});

test('getWallTimeCandidates rejects DST gaps and exposes both repeated instants', () => {
  assert.deepEqual(
    getWallTimeCandidates('2026-03-08', '02:30', 'America/New_York'),
    [],
  );
  assert.deepEqual(
    getWallTimeCandidates('2026-11-01', '01:30', 'America/New_York'),
    ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'],
  );
});

test('resolveDeviceTimeZone follows device, family, Shanghai fallback order', () => {
  assert.equal(resolveDeviceTimeZone('Asia/Tokyo', 'Europe/Paris'), 'Asia/Tokyo');
  assert.equal(resolveDeviceTimeZone('Invalid/Zone', 'Europe/Paris'), 'Europe/Paris');
  assert.equal(resolveDeviceTimeZone(undefined, 'Invalid/Zone'), 'Asia/Shanghai');
});

test('timezone options prioritize dynamic zones and search by city or IANA id', () => {
  const options = buildTimeZoneOptions([
    'Pacific/Chatham',
    'Asia/Shanghai',
    'Pacific/Chatham',
  ]);
  assert.equal(options[0].id, 'Pacific/Chatham');
  assert.equal(options.filter(option => option.id === 'Pacific/Chatham').length, 1);
  assert.equal(searchTimeZoneOptions(options, '东京')[0].id, 'Asia/Tokyo');
  assert.equal(searchTimeZoneOptions(options, 'Europe/Paris')[0].id, 'Europe/Paris');
});

test('grouping uses the viewing timezone only, and query windows are not padded', () => {
  const timeline = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/utils/event-timeline.ts'),
    'utf-8',
  );
  const events = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/pages/events/events.ts'),
    'utf-8',
  );
  const home = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/pages/home/home.ts'),
    'utf-8',
  );
  // the pure grouping module must never read endpoint timezone metadata
  assert.doesNotMatch(timeline, /e\.startTimezone/);
  assert.match(timeline, /instantToZonedDate\(e\.startAt, viewingTimezone\)/);
  // list query and grouping share one viewing timezone, with no +-2 day padding
  assert.match(events, /timezone: this\._viewingTimezone/);
  assert.match(events, /eventDaysInRange\(e, rs, re, this\._viewingTimezone/);
  assert.doesNotMatch(events, /queryStart|queryEnd/);
  assert.match(home, /timezone: viewingTimezone/);
  assert.doesNotMatch(home, /addDaysToDateOnly\(start, -2\)/);
  assert.doesNotMatch(home, /addDaysToDateOnly\(end, 2\)/);
});

test('event editor preserves nullable timezone metadata and task dates use family timezone', () => {
  const eventEditor = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/pages/events/edit.ts'),
    'utf-8',
  );
  const taskList = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/pages/tasks/tasks.ts'),
    'utf-8',
  );
  assert.match(eventEditor, /startTimezoneMetadata\s*=\s*event\.startTimezone/);
  assert.match(eventEditor, /this\.setData\(\{[\s\S]*?startTimezoneMetadata,[\s\S]*?endTimezoneMetadata,/);
  assert.match(eventEditor, /startTimezone:\s*this\.data\.startTimezoneMetadata/);
  assert.match(taskList, /currentFamilyStore\.value\?\.timezone/);
  assert.match(taskList, /formatInstantInTimeZone\(new Date\(\)\.toISOString\(\), familyTimezone\)\.date/);
  const home = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/pages/home/home.ts'),
    'utf-8',
  );
  assert.match(home, /mapTaskHome\(t, today, tomorrow\)/);
  assert.match(home, /taskDueLabel\(t, today, tomorrow\)/);
});

// ============ 10. 日程状态派生（已结束 / 进行中 / 排序） ============
// 这些判据是首页「今天安排」与日程页置灰共用的单一来源，必须稳定。
const T = (iso: string) => new Date(iso).getTime();

test('isEventEnded: 非全天且 endAt 早于 now 才算已结束', () => {
  const ended = { isAllDay: false, startAt: '2026-07-27T01:00:00.000Z', endAt: '2026-07-27T02:00:00.000Z' } as Event;
  const ongoing = { isAllDay: false, startAt: '2026-07-27T01:00:00.000Z', endAt: '2099-01-01T00:00:00.000Z' } as Event;
  assert.equal(isEventEnded(ended, T('2026-07-27T03:00:00.000Z')), true);
  assert.equal(isEventEnded(ongoing, T('2026-07-27T03:00:00.000Z')), false);
});

test('isEventEnded: 全天事件 endDateExclusive 早于今天才视为已结束', () => {
  // endExclusive=2026-07-29 表示覆盖 27、28 两天，29 当天已结束
  const ongoingAllDay = { isAllDay: true, startDate: '2026-07-27', endDateExclusive: '2026-07-29' } as Event;
  const endedAllDay = { isAllDay: true, startDate: '2026-07-25', endDateExclusive: '2026-07-27' } as Event;
  // 2026-07-28 当天：endExclusive(29) > 今天 → 未结束
  assert.equal(isEventEnded(ongoingAllDay, T('2026-07-28T12:00:00.000Z')), false);
  // 2026-07-28 当天：endExclusive(27) <= 今天 → 已结束（置灰）
  assert.equal(isEventEnded(endedAllDay, T('2026-07-28T12:00:00.000Z')), true);
});

test('isEventEnded: 缺少 endAt 的非全天事件不视为已结束', () => {
  const noEnd = { isAllDay: false, startAt: '2026-07-27T01:00:00.000Z' } as Event;
  assert.equal(isEventEnded(noEnd, T('2026-07-27T03:00:00.000Z')), false);
});

test('isEventOngoing: startAt<=now<endAt 且非全天才算进行中', () => {
  const ongoing = { isAllDay: false, startAt: '2026-07-27T01:00:00.000Z', endAt: '2026-07-27T02:00:00.000Z' } as Event;
  const before = { isAllDay: false, startAt: '2026-07-27T01:00:00.000Z', endAt: '2026-07-27T02:00:00.000Z' } as Event;
  const after = { isAllDay: false, startAt: '2026-07-27T01:00:00.000Z', endAt: '2026-07-27T02:00:00.000Z' } as Event;
  const allDay = { isAllDay: true, startDate: '2026-07-27', endDateExclusive: '2026-07-28' } as Event;
  assert.equal(isEventOngoing(ongoing, T('2026-07-27T01:30:00.000Z')), true);
  assert.equal(isEventOngoing(before, T('2026-07-27T00:30:00.000Z')), false);
  assert.equal(isEventOngoing(after, T('2026-07-27T03:00:00.000Z')), false);
  assert.equal(isEventOngoing(allDay, T('2026-07-27T12:00:00.000Z')), false);
});

test('eventDisplayRank: 已结束沉底，未结束按开始时间升序', () => {
  const now = T('2026-07-27T12:00:00.000Z');
  const endedEarly = { isAllDay: false, startAt: '2026-07-27T01:00:00.000Z', endAt: '2026-07-27T02:00:00.000Z' } as Event;
  const liveEarly = { isAllDay: false, startAt: '2026-07-27T08:00:00.000Z', endAt: '2026-07-27T09:00:00.000Z' } as Event;
  const liveLater = { isAllDay: false, startAt: '2026-07-27T10:00:00.000Z', endAt: '2026-07-27T13:00:00.000Z' } as Event;
  const allDay = { isAllDay: true, startDate: '2026-07-27', endDateExclusive: '2026-07-28' } as Event;
  const sorted = [endedEarly, liveLater, allDay, liveEarly]
    .sort((a, b) => eventDisplayRank(a, b, now))
    .map(e => (e.isAllDay ? 'allDay' : e.startAt));
  // 全天(0) < liveLater(10，end 13 未结束) < endedEarly(end 02 已沉底) < liveEarly(end 09 已沉底)
  assert.deepEqual(sorted, ['allDay', '2026-07-27T10:00:00.000Z', '2026-07-27T01:00:00.000Z', '2026-07-27T08:00:00.000Z']);
});

test('首页与日程页共用同一套 event-status 判据（无重复内联实现）', () => {
  const home = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/pages/home/home.ts'),
    'utf-8',
  );
  const events = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/pages/events/events.ts'),
    'utf-8',
  );
  assert.match(home, /from '\.\.\/\.\.\/utils\/event-status'/);
  assert.match(home, /isEventEnded\(e, now\)/);
  assert.match(home, /isEventOngoing\(e, now\)/);
  assert.match(events, /from '\.\.\/\.\.\/utils\/event-status'/);
  assert.match(events, /isEventEnded\(e, now\)/);
  // 内联的重复计算不应再存在
  assert.doesNotMatch(home, /!e\.isAllDay && !!e\.endAt && new Date\(e\.endAt\)\.getTime\(\) < now/);
  assert.doesNotMatch(events, /!e\.isAllDay && !!e\.endAt && new Date\(e\.endAt\)\.getTime\(\) < now/);
});

test('首页今天安排：已结束日程被过滤、全量展示（不 slice 到 3 条）', () => {
  const home = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/pages/home/home.ts'),
    'utf-8',
  );
  // recompute 应先 filter 掉已结束再展示，且 todayEvents 不再被 HOME_LIMIT 截断
  assert.match(home, /\.filter\(event => !\(isEventEnded\(event, now\)\)\)/);
  assert.doesNotMatch(home, /todayEvents: todayEvents\.slice\(0, HOME_LIMIT\)/);
  assert.match(home, /todayEvents: todayEvents,/);
});

test('日程页卡片对 isEnded 事件加 event-ended 类（置灰）', () => {
  const wxml = readFileSync(
    path.resolve(import.meta.dirname, '../miniprogram/pages/events/events.wxml'),
    'utf-8',
  );
  assert.match(wxml, /event-card \{\{ev\.isEnded \? 'event-ended' : ''\}\}/);
});
