import { test } from 'node:test';
import assert from 'node:assert/strict';

import { median, summarizeLatency } from '../miniprogram/services/latency-metrics.ts';

test('median is robust to sample ordering and outliers', () => {
  assert.equal(median([120, 42, 44]), 44);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), 0);
});

test('summarizeLatency reports BFF-to-Core health and status medians', () => {
  const summary = summarizeLatency(
    [70, 62, 210],
    [130, 125, 300],
  );

  assert.equal(summary.healthMedianMs, 70);
  assert.equal(summary.statusMedianMs, 130);
  assert.equal(summary.workerD1ExtraMs, 60);
});

test('summarizeLatency never reports a negative Worker+D1 estimate', () => {
  const summary = summarizeLatency(
    [120],
    [90],
  );
  assert.equal(summary.workerD1ExtraMs, 0);
});
