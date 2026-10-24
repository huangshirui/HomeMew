import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./src/pages/domain-page.tsx', import.meta.url), 'utf8');
const title = readFileSync(new URL('./src/components/record-title-field.tsx', import.meta.url), 'utf8');

test('Activity uses indexed createdAt ordering with bounded cursor pagination and server filters', () => {
  assert.match(page, /sort: \[\{ field: 'createdAt', direction: 'desc' \}\]/);
  assert.match(page, /page: \{ limit: 40,/);
  assert.match(page, /activityQuery\(activitySearch, activityPerson, activityPeriod, currentFamily\.timezone, cursor\)/);
  assert.match(page, /queryModelRecords<DomainRecord>\(currentFamily\.id, 'activity'/);
  assert.match(page, /field: 'attendeePersonIds', op: 'contains'/);
  assert.match(page, /field: 'startDate', op: 'lte'/);
  assert.match(page, /field: 'endDate', op: 'gte'/);
  assert.match(page, /requestGeneration\.current/);
  assert.match(page, /加载更多活动/);
});

test('Activity list is rows rather than cards, with expandable search next to creation', () => {
  assert.match(page, /activityFilterOpen \? <div/);
  assert.match(page, /搜索与筛选/);
  assert.match(page, /没有找到符合条件的活动/);
  assert.match(page, /divide-y divide-stone-100/);
  assert.match(page, /查看活动/);
  assert.match(page, /openDetail\(record\)/);
});

test('Anniversary has optional user-chosen icon, no hardcoded gift, and natural year/month/day controls', () => {
  assert.doesNotMatch(page, /🎁/);
  assert.match(page, /\['year','month','day'\]/);
  assert.match(page, /k === 'year' \? '年' : k === 'month' \? '月 \*' : '日 \*'/);
  assert.match(page, /stepAnniversaryYear\(d\.year, -1\)/);
  assert.match(page, /stepAnniversaryYear\(d\.year, 1\)/);
  assert.match(page, /return value \? String\(Math\.max\(1, Math\.min\(9999, Number\(value\) \+ step\)\)\) : String\(currentYear\)/);
  assert.match(page, /<RecordTitleField/);
  assert.match(title, /items-center gap-2\.5/);
});

test('All new household modules share subtitle-free PageHeader', () => {
  assert.doesNotMatch(page, /spec\.description/);
  assert.match(page, /<PageHeader title=\{spec\.title\} mobileActions=/);
});
