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

test('event draft adapter leaves unknown end time empty instead of inventing a duration', () => {
  assert.match(adapterSource, /endDate:\s*end\?\.date \?\? start\?\.date \?\? ''/);
  assert.match(adapterSource, /endTime:\s*end\?\.time \?\? ''/);
  assert.match(adapterSource, /startTime:\s*start\?\.time \?\? ''/);
});

test('Creation Draft service adapts event drafts with the interpretation viewing timezone', () => {
  assert.match(serviceSource, /adaptLifeSpaceEventDraft\(raw\.draft, viewingTimezone\)/);
  assert.match(serviceSource, /getCreationDraftJob\([\s\S]*viewingTimezone: string/);
  assert.match(meowSource, /this\.startPolling\(familyId, job\.draftId, viewingTimezone\)/);
  assert.match(meowSource, /getCreationDraftJob\(familyId, draftId, viewingTimezone\)/);
});
