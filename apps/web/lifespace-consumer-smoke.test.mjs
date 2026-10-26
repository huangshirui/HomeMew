import assert from 'node:assert/strict';
import test from 'node:test';
import { runReadOnlyConsumerSmoke } from './lifespace-consumer-smoke.mjs';

function jsonResponse(data, { status = 200, requestId = 'req_smoke' } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
    },
  });
}

test('read-only consumer smoke proves the pinned LifeSpace baseline and HomeMew Mini BFF read surfaces', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const fakeFetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target === 'https://auth.example/api/v1/status') {
      return jsonResponse({ data: { status: 'ok', service: 'identity', environment: 'production', contractVersion: '0.14.0', schemaVersion: 13 } });
    }
    if (target === 'https://core.example/api/v1/status') {
      return jsonResponse({ data: { status: 'ok', service: 'core', environment: 'production', contractVersion: '0.48.0', schemaVersion: 53 } });
    }
    if (target === 'https://homemew.example/api/v1/miniprogram/families') {
      return jsonResponse({ data: { items: [{ id: 'spc_home', name: 'Home' }] } });
    }
    if (target === 'https://homemew.example/api/v1/miniprogram/families/spc_home') {
      return jsonResponse({ data: { id: 'spc_home', name: 'Home' } });
    }
    if (target.endsWith('/members')) return jsonResponse({ data: { items: [{ userId: 'usr_1' }] } });
    if (target.endsWith('/events')) return jsonResponse({ data: { items: [{ id: 'evt_1' }] } });
    if (target.endsWith('/tasks')) return jsonResponse({ data: { items: [{ id: 'tsk_1' }] } });
    if (target.endsWith('/day-records')) return jsonResponse({ data: { items: [] } });
    if (target.endsWith('/wishes')) return jsonResponse({ data: { items: [] } });
    throw new Error(`Unexpected fetch: ${target}`);
  };

  globalThis.fetch = fakeFetch;
  try {
    const result = await runReadOnlyConsumerSmoke({
      homeMewBaseUrl: 'https://homemew.example/',
      bearer: 'usr_test_bearer',
      identityBaseUrl: 'https://auth.example/',
      coreBaseUrl: 'https://core.example/',
      fetcher: fakeFetch,
    });
    assert.deepEqual(result, {
      baseline: { identity: '0.14.0', core: '0.48.0' },
      families: 1,
      familyId: 'spc_home',
      resources: { members: 1, events: 1, tasks: 1, dayRecords: 0, wishes: 0 },
    });
    assert.equal(calls.length, 9);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('read-only consumer smoke never requires a family when the user has none', async () => {
  const originalFetch = globalThis.fetch;
  const fakeFetch = async (url) => {
    const target = String(url);
    if (target.includes('auth.example')) {
      return jsonResponse({ data: { status: 'ok', service: 'identity', environment: 'production', contractVersion: '0.14.0', schemaVersion: 13 } });
    }
    if (target.includes('core.example')) {
      return jsonResponse({ data: { status: 'ok', service: 'core', environment: 'production', contractVersion: '0.48.0', schemaVersion: 53 } });
    }
    return jsonResponse({ data: { items: [] } });
  };
  globalThis.fetch = fakeFetch;
  try {
    const result = await runReadOnlyConsumerSmoke({
      homeMewBaseUrl: 'https://homemew.example',
      bearer: 'usr_test_bearer',
      identityBaseUrl: 'https://auth.example',
      coreBaseUrl: 'https://core.example',
      fetcher: fakeFetch,
    });
    assert.equal(result.families, 0);
    assert.equal(result.familyId, null);
    assert.equal(result.resources, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
