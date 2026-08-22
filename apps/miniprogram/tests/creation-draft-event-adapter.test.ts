import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { formatInstantInTimeZone } from '../miniprogram/utils/datetime.ts';

const adapterSource = readFileSync(
  new URL('../miniprogram/services/creation-draft-adapter.ts', import.meta.url),
  'utf8',
);
const serviceSource = readFileSync(
  new URL('../miniprogram/services/creation-drafts.ts', import.meta.url),
  'utf8',
);
const meowSource = readFileSync(
  new URL('../miniprogram/pages/meow/meow.ts', import.meta.url),
  'utf8',
);

test('viewing timezone converts LifeSpace UTC event start into HomeMew wall time', () => {
  assert.deepEqual(
    formatInstantInTimeZone('2026-08-22T02:00:00.000Z', 'Asia/Shanghai'),
    { date: '2026-08-22', time: '10:00' },
  );
});

test('event draft adapter defaults an absent endAt to a 60-minute duration', () => {
  assert.match(adapterSource, /DEFAULT_EVENT_DURATION_MS\s*=\s*60 \* 60 \* 1000/);
  assert.match(adapterSource, /start\.getTime\(\) \+ DEFAULT_EVENT_DURATION_MS/);
  assert.match(
    adapterSource,
    /const end = explicitEndAt[\s\S]*\? localInstant\(explicitEndAt, endZone\)[\s\S]*: defaultEndFromStart\(draft\.startAt, endZone\)/,
  );
});

test('one-hour default preserves date rollover in the viewing timezone', () => {
  const start = new Date('2026-08-22T15:30:00.000Z');
  const defaultEnd = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
  assert.deepEqual(
    formatInstantInTimeZone(defaultEnd, 'Asia/Shanghai'),
    { date: '2026-08-23', time: '00:30' },
  );
});

test('Creation Draft service adapts event drafts with the interpretation viewing timezone', () => {
  assert.match(serviceSource, /adaptLifeSpaceEventDraft\(raw\.draft, viewingTimezone\)/);
  assert.match(serviceSource, /getCreationDraftJob\([\s\S]*viewingTimezone: string/);
  assert.match(meowSource, /this\.startPolling\(familyId, job\.draftId, viewingTimezone\)/);
  assert.match(meowSource, /getCreationDraftJob\(familyId, draftId, viewingTimezone\)/);
});
