import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

function executable(path: string): string {
  const source = readFileSync(new URL(`../miniprogram/${path}.ts`, import.meta.url), 'utf8');
  return stripTypeScriptTypes(source.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm, '')).replace(/\bexport /g, '');
}
const copy = { habits: { symbol: '◷' }, activities: { symbol: '📅' }, goals: { symbol: '◎' } };
const { homeLifeRows } = runInNewContext(executable('utils/home-life') + ';({homeLifeRows})', { DOMAIN_COPY: copy });
function service(listDomainRecords: (...args: any[]) => Promise<any>) {
  return runInNewContext(executable('services/life-records') + ';({listPersonalHabitPage,listCurrentLifeRecords})', { listDomainRecords });
}
const habit = (id: string, subjectPersonId = 'per_me', checkedInToday = false) => ({
  id, name: id, subjectPersonId, version: 4, status: 'active',
  computed: { checkIn: { today: '2026-10-26', checkedInToday, streakDays: 7 } },
});
function home(overrides: Record<string, any> = {}) {
  let page: any;
  runInNewContext(executable('pages/home/home'), {
    Page: (value: any) => { page = value; },
    userStore: { value: { id: 'usr_me' } },
    listDomainPeople: async () => [{ userId: 'usr_me', personId: 'per_me', displayName: '本人' }],
    listCurrentLifeRecords: async () => [], homeLifeRows,
    formatInstantInTimeZone: () => ({ date: '2026-10-26' }),
    showSuccess: () => {}, showError: () => {}, isVersionConflict: (code: string) => code === 'VERSION_CONFLICT',
    getErrorMessage: (_code: string, message: string) => message,
    ...overrides,
  });
  page.setData = (patch: Record<string, any>) => {
    for (const [path, value] of Object.entries(patch)) {
      const keys = path.split('.');
      let target = page.data;
      keys.slice(0, -1).forEach(key => { target = target[key]; });
      target[keys[keys.length - 1]] = value;
    }
  };
  page.data.currentFamily = { id: 'spc_a', timezone: 'Asia/Shanghai', role: 'member' };
  page.data.canCheckIn = true;
  page._lifePersonId = 'per_me';
  page.data.lifeRecords.habits = homeLifeRows([habit('one'), habit('two')], 'habits', [], 'per_me');
  return page;
}
const tap = (id: string) => ({ currentTarget: { dataset: { id } } });

test('personal habits continue past other owners and preserve a usable next cursor', async () => {
  const cursors: any[] = [];
  const s = service(async (_family, kind, options) => {
    assert.equal(kind, 'habits'); cursors.push(options.cursor);
    return options.cursor ? { items: [habit('mine')], nextCursor: 'more' }
      : { items: [habit('other', 'per_other')], nextCursor: 'page2' };
  });
  const page = await s.listPersonalHabitPage('spc_a', 'per_me', { status: 'active' });
  assert.deepEqual(cursors, [undefined, 'page2']);
  assert.equal(page.items[0].id, 'mine'); assert.equal(page.nextCursor, 'more');
});

test('home scans every active habit page before choosing unchecked personal habits', async () => {
  let calls = 0;
  const s = service(async (_family, _kind, options) => {
    calls++; assert.equal(options.status, 'active');
    return options.cursor ? { items: [habit('todo')], nextCursor: null }
      : { items: [habit('done', 'per_me', true), habit('other', 'per_other')], nextCursor: 'next' };
  });
  const records = await s.listCurrentLifeRecords('spc_a', 'habits', 'per_me', '2026-10-26');
  const rows = homeLifeRows(records, 'habits', [], 'per_me');
  assert.equal(calls, 2); assert.equal(rows[0].id, 'todo'); assert.equal(rows[1].id, 'done');
  assert.equal(rows[0].streakDays, 7);
});

test('missing Person mapping never matches unowned records or fetches family habits', async () => {
  const s = service(async () => { throw new Error('must not fetch'); });
  assert.equal((await s.listPersonalHabitPage('spc_a', '')).items.length, 0);
  assert.equal(homeLifeRows([{ id: 'missing', status: 'active' }], 'habits', [], '').length, 0);
});

test('stale pagination stops, and repeated cursors fail instead of looping forever', async () => {
  let calls = 0;
  const s = service(async () => { calls++; return { items: [], nextCursor: 'same' }; });
  assert.equal((await s.listCurrentLifeRecords('spc_a', 'habits', 'per_me', '2026-10-26', () => false)).length, 0);
  assert.equal(calls, 1);
  await assert.rejects(s.listPersonalHabitPage('spc_a', 'per_me'), /更新异常/);
  assert.ok(calls < 5);
});

test('activities use the Space-local current window and sort dated endings first', async () => {
  const s = service(async (_family, _kind, opts) => {
    assert.equal(opts.period, 'current'); assert.equal(opts.today, '2026-10-26');
    return { items: [{ id: 'open' }, { id: 'soon', endDate: '2026-10-27', attendeePersonIds: ['per_me'] }], nextCursor: null };
  });
  const rows = homeLifeRows(await s.listCurrentLifeRecords('spc_a', 'activities', 'per_me', '2026-10-26'),
    'activities', [{ personId: 'per_me', displayName: '本人' }], 'per_me');
  assert.equal(rows[0].id, 'soon'); assert.equal(rows[0].relatedToMe, true); assert.equal(rows[0].peopleLabel, '本人');
});

test('goals exclude finished records, show three rows, and put dated goals before undated goals', () => {
  const rows = homeLifeRows([
    { id: 'open', status: 'active' }, { id: 'finished', status: 'achieved' },
    { id: 'later', status: 'active', targetDate: '2026-12-01' },
    { id: 'soon', status: 'active', targetDate: '2026-10-27' }, { id: 'open2', status: 'active' },
  ], 'goals', [], 'per_me');
  assert.equal(rows.length, 3); assert.equal(rows[0].id, 'soon'); assert.equal(rows[1].id, 'later'); assert.equal(rows[2].id, 'open');
});

test('check-in suppresses double taps, forwards the version, and updates in place', async () => {
  let resolve: any, calls = 0;
  const page = home({ performDomainAction: async (...args: any[]) => {
    calls++; assert.deepEqual(args, ['spc_a', 'habits', 'one', 'check-in', 4]);
    return new Promise(done => { resolve = done; });
  } });
  const pending = page.onHabitCheckIn(tap('one'));
  await page.onHabitCheckIn(tap('one')); assert.equal(calls, 1);
  resolve({ ...habit('one', 'per_me', true), version: 5 }); await pending;
  assert.equal(page.data.lifeRecords.habits[0].id, 'one');
  assert.equal(page.data.lifeRecords.habits[0].checkedInToday, true);
  assert.equal(page.data.lifeRecords.habits[0].version, 5);
  assert.equal(page.data.lifeRecords.habits[0].checking, false);
});

test('parallel check-ins do not discard each other, and polling leaves pending habits in place', async () => {
  const resolves: Record<string, any> = {};
  const page = home({ performDomainAction: async (_family: string, _kind: string, id: string) =>
    new Promise(done => { resolves[id] = done; }) });
  const one = page.onHabitCheckIn(tap('one')), two = page.onHabitCheckIn(tap('two'));
  await page.loadLife('spc_a');
  assert.equal(page.data.lifeRecords.habits.length, 2);
  resolves.two(habit('two', 'per_me', true)); await two;
  resolves.one(habit('one', 'per_me', true)); await one;
  assert.ok(page.data.lifeRecords.habits.every((row: any) => row.checkedInToday && !row.checking));
});

test('other owners, inactive habits, read-only users and already checked habits cannot trigger writes', async () => {
  let calls = 0;
  const page = home({ performDomainAction: async () => { calls++; } });
  for (const patch of [{ subjectPersonId: 'per_other' }, { status: 'paused' }, { checkedInToday: true }]) {
    page.data.lifeRecords.habits = [{ ...homeLifeRows([habit('one')], 'habits', [], 'per_me')[0], ...patch }];
    await page.onHabitCheckIn(tap('one'));
  }
  page.data.lifeRecords.habits = homeLifeRows([habit('one')], 'habits', [], 'per_me');
  page.data.canCheckIn = false; await page.onHabitCheckIn(tap('one')); assert.equal(calls, 0);
});

test('family switch discards an old check-in result even after switching back', async () => {
  let resolve: any;
  const page = home({ performDomainAction: async () => new Promise(done => { resolve = done; }) });
  const pending = page.onHabitCheckIn(tap('one'));
  page._resetFamilyData();
  page.data.lifeRecords.habits = homeLifeRows([habit('fresh')], 'habits', [], 'per_me');
  resolve(habit('one', 'per_me', true)); await pending;
  assert.equal(page.data.lifeRecords.habits[0].id, 'fresh');
});

test('version conflict reloads for review without replaying the check-in', async () => {
  let writes = 0, reloads = 0, message = '';
  const page = home({ performDomainAction: async () => { writes++; throw { code: 'VERSION_CONFLICT' }; },
    showError: (value: string) => { message = value; } });
  page.loadLife = async () => { reloads++; };
  await page.onHabitCheckIn(tap('one'));
  assert.equal(writes, 1); assert.equal(reloads, 1); assert.match(message, /最新状态/);
  assert.equal(page._checkingHabits.size, 0);
});

test('independent domain errors preserve other results and allow retry; truly empty module hides', async () => {
  const page = home({ listCurrentLifeRecords: async (_family: string, kind: string) => {
    if (kind === 'habits') throw new Error('offline');
    return kind === 'goals' ? [{ id: 'goal', status: 'active' }] : [];
  } });
  await page.loadLife('spc_a');
  assert.equal(page.data.lifeErrors.habits, true); assert.equal(page.data.lifeRecords.goals.length, 1);
  assert.equal(page.data.lifeVisible, true);
  page.data.lifeRecords = { habits: [], activities: [], goals: [] };
  page.data.lifeErrors = { habits: false, activities: false, goals: false };
  page.updateLifeVisible(); assert.equal(page.data.lifeVisible, false);
});

test('home removes tools, keeps module order, and hides only successfully empty task reminders', () => {
  const template = readFileSync(new URL('../miniprogram/pages/home/home.wxml', import.meta.url), 'utf8');
  assert.doesNotMatch(template, /常用工具|tools-section/);
  const positions = ['需要关注', '今天安排', '待办提醒', '生活进行时'].map(label => template.indexOf(`>${label}</text>`));
  assert.ok(positions.every((value, index) => value >= 0 && (!index || value > positions[index - 1])));
  assert.match(template, /wx:if="\{\{pendingTasks.length > 0 \|\| tasksLoading \|\| tasksError\}\}"/);
});
