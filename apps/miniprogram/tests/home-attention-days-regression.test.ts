import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const homeSource = readFileSync(
  new URL('../miniprogram/pages/home/home.ts', import.meta.url),
  'utf8',
);

test('home recomputes derived attention cards after attention days load', () => {
  const start = homeSource.indexOf('async loadAttentionDays(familyId: string)');
  const end = homeSource.indexOf('onRetryDays(): void', start);
  assert.ok(start >= 0 && end > start, 'loadAttentionDays block must exist');

  const block = homeSource.slice(start, end);
  const attentionUpdate = block.indexOf('attentionDays: records.map(mapDayRecordView)');
  const recompute = block.indexOf('this.recompute();', attentionUpdate);

  assert.ok(attentionUpdate >= 0, 'loadAttentionDays must store the loaded attention days');
  assert.ok(
    recompute > attentionUpdate,
    'loadAttentionDays must recompute derived attention cards after storing attention days',
  );
});
