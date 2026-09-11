import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('./src/app.tsx', import.meta.url), 'utf8');
const reporterSource = readFileSync(new URL('./src/components/activity-reporter.tsx', import.meta.url), 'utf8');
const frontDoorSource = readFileSync(new URL('./front-door.mjs', import.meta.url), 'utf8');

test('Web activity reporter runs only after SessionGate authentication and de-duplicates per tab/day', () => {
  assert.match(appSource, /<SessionGate>[\s\S]*<ActivityReporter \/>/);
  assert.match(reporterSource, /sessionStorage/);
  assert.match(reporterSource, /visibilitychange/);
  assert.match(reporterSource, /fetch\('\/api\/activity\/me'/);
  assert.match(reporterSource, /reportedInMemoryDay === day/);
});

test('production front door exposes only the exact HomeMew backend activity routes', () => {
  assert.match(frontDoorSource, /POST' && url\.pathname === '\/api\/v1\/activity\/me'/);
  assert.match(frontDoorSource, /POST' && url\.pathname === '\/api\/v1\/activity\/report'/);
  assert.match(frontDoorSource, /GET' && url\.pathname === '\/api\/v1\/activity'/);
  assert.doesNotMatch(frontDoorSource, /startsWith\('\/api\/v1\/activity'/);
});
