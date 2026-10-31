import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoRefreshGate, markRefreshDirty } from '../miniprogram/services/refresh-policy.ts';

test('unlock within 60s reuses rendered view without an additional request', () => {
  const gate = new AutoRefreshGate();
  assert.equal(gate.shouldRefresh('family:a:match:1', 'football', true, 100_000), true);
  gate.noteRequest('family:a:match:1', 'football', 100_000);
  assert.equal(gate.shouldRefresh('family:a:match:1', 'football', true, 140_000), false);
  assert.equal(gate.shouldRefresh('family:a:match:1', 'football', true, 160_000), true);
});

test('successful edit bypasses throttle and scope switches cannot reuse prior freshness', () => {
  const gate = new AutoRefreshGate();
  gate.noteRequest('family:a:match:2', 'football', 100_000);
  markRefreshDirty('football');
  assert.equal(gate.shouldRefresh('family:a:match:2', 'football', true, 100_001), true);
  gate.noteRequest('family:a:match:2', 'football', 100_002);
  assert.equal(gate.shouldRefresh('family:b:match:2', 'football', true, 100_003), true);
  assert.equal(gate.shouldRefresh('family:a:match:3', 'football', true, 100_003), true);
});

test('concurrent initial show is deduplicated; incomplete load retries after 10s', () => {
  const gate = new AutoRefreshGate();
  gate.noteRequest('family:a:list', 'domains', 100_000);
  assert.equal(gate.shouldRefresh('family:a:list', 'domains', false, 100_100), false);
  assert.equal(gate.shouldRefresh('family:a:list', 'domains', false, 110_000), true);
});
