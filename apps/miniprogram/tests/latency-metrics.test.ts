import { test } from 'node:test';
import assert from 'node:assert/strict';

import { median, summarizeLatency } from '../miniprogram/services/latency-metrics.ts';

test('median is robust to sample ordering and outliers', () => {
  assert.equal(median([120, 42, 44]), 44);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), 0);
});

test('summarizeLatency reports health, D1 and optional network RTT medians', () => {
  const summary = summarizeLatency(
    [
      { elapsedMs: 70, rttMs: 32 },
      { elapsedMs: 62, rttMs: 28 },
      { elapsedMs: 210, rttMs: null },
    ],
    [
      { elapsedMs: 130, rttMs: null },
      { elapsedMs: 125, rttMs: null },
      { elapsedMs: 300, rttMs: null },
    ],
  );

  assert.equal(summary.healthMedianMs, 70);
  assert.equal(summary.statusMedianMs, 130);
  assert.equal(summary.networkRttMedianMs, 30);
  assert.equal(summary.workerD1ExtraMs, 60);
});

test('summarizeLatency never reports a negative Worker+D1 estimate', () => {
  const summary = summarizeLatency(
    [{ elapsedMs: 120, rttMs: null }],
    [{ elapsedMs: 90, rttMs: null }],
  );
  assert.equal(summary.networkRttMedianMs, null);
  assert.equal(summary.workerD1ExtraMs, 0);
});
