import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AsyncKeyedTtlCache } from '../miniprogram/services/async-keyed-ttl-cache.ts';

test('AsyncKeyedTtlCache single-flights concurrent loads for one key', async () => {
  let loads = 0;
  let release!: (value: string[]) => void;
  const pending = new Promise<string[]>(resolve => { release = resolve; });
  const cache = new AsyncKeyedTtlCache<string[]>(30_000, () => 1000);
  const loader = async (): Promise<string[]> => {
    loads += 1;
    return pending;
  };

  const first = cache.get('space-a', loader);
  const second = cache.get('space-a', loader);
  const third = cache.get('space-a', loader);
  assert.equal(loads, 1);

  release(['member-1']);
  const values = await Promise.all([first, second, third]);
  assert.deepEqual(values, [['member-1'], ['member-1'], ['member-1']]);
  assert.equal(loads, 1);
});

test('AsyncKeyedTtlCache reuses values inside TTL and reloads after expiry', async () => {
  let now = 1000;
  let loads = 0;
  const cache = new AsyncKeyedTtlCache<number>(30_000, () => now);
  const loader = async (): Promise<number> => ++loads;

  assert.equal(await cache.get('space-a', loader), 1);
  now += 29_999;
  assert.equal(await cache.get('space-a', loader), 1);
  assert.equal(loads, 1);

  now += 2;
  assert.equal(await cache.get('space-a', loader), 2);
  assert.equal(loads, 2);
});

test('AsyncKeyedTtlCache invalidate forces a fresh load', async () => {
  let loads = 0;
  const cache = new AsyncKeyedTtlCache<number>(30_000, () => 1000);
  const loader = async (): Promise<number> => ++loads;

  assert.equal(await cache.get('space-a', loader), 1);
  cache.invalidate('space-a');
  assert.equal(await cache.get('space-a', loader), 2);
  assert.equal(loads, 2);
});

test('AsyncKeyedTtlCache does not let an invalidated in-flight response repopulate cache', async () => {
  let loads = 0;
  let releaseFirst!: (value: number) => void;
  const firstPending = new Promise<number>(resolve => { releaseFirst = resolve; });
  const cache = new AsyncKeyedTtlCache<number>(30_000, () => 1000);

  const first = cache.get('space-a', async () => {
    loads += 1;
    return firstPending;
  });
  cache.invalidate('space-a');
  const second = cache.get('space-a', async () => {
    loads += 1;
    return 2;
  });

  assert.equal(await second, 2);
  releaseFirst(1);
  assert.equal(await first, 1);
  assert.equal(await cache.get('space-a', async () => ++loads), 2);
  assert.equal(loads, 2);
});
