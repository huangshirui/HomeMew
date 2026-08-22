import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adaptLifeSpaceEventDraft } from '../miniprogram/services/creation-draft-adapter.ts';

test('timed event draft converts LifeSpace startAt into HomeMew wall time', () => {
  const draft = adaptLifeSpaceEventDraft({
    summary: '足球比赛',
    description: null,
    location: null,
    isAllDay: false,
    startAt: '2026-08-22T02:00:00.000Z',
    endAt: null,
    startTimezone: null,
    endTimezone: null,
    startDate: null,
    endDateExclusive: null,
    attendeePersonIds: [],
  }, 'Asia/Shanghai');

  assert.equal(draft.isAllDay, false);
  assert.equal(draft.startDate, '2026-08-22');
  assert.equal(draft.startTime, '10:00');
  assert.equal(draft.endDate, '2026-08-22');
  assert.equal(draft.endTime, '');
});

test('timed event draft preserves an explicit endAt', () => {
  const draft = adaptLifeSpaceEventDraft({
    summary: '足球训练',
    isAllDay: false,
    startAt: '2026-08-22T02:00:00.000Z',
    endAt: '2026-08-22T03:30:00.000Z',
    startTimezone: null,
    endTimezone: null,
  }, 'Asia/Shanghai');

  assert.equal(draft.startTime, '10:00');
  assert.equal(draft.endTime, '11:30');
  assert.equal(draft.endDate, '2026-08-22');
});

test('all-day event draft converts half-open end date to inclusive form date', () => {
  const draft = adaptLifeSpaceEventDraft({
    summary: '家庭活动',
    isAllDay: true,
    startDate: '2026-08-22',
    endDateExclusive: '2026-08-23',
  }, 'Asia/Shanghai');

  assert.equal(draft.startDate, '2026-08-22');
  assert.equal(draft.endDate, '2026-08-22');
  assert.equal(draft.startTime, null);
  assert.equal(draft.endTime, null);
});
