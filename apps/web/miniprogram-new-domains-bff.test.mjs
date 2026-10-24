import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMiniNewDomainBff } from './miniprogram-new-domains-bff.mjs';

const path = '/api/v1/miniprogram/families/spc_family/containers/activities/rec_parent/quick-create';
const selection = {
  name: '足球公园', address: '北京市朝阳区',
  coordinates: { latitude: 39.99, longitude: 116.4 },
};

async function createQuickEvent(format, location, locationDetail) {
  const batches = [];
  const env = {
    LIFESPACE_EVENT_LOCATION_FORMAT: format,
    LIFESPACE_CORE: {
      async fetch(incoming) {
        const url = new URL(incoming.url);
        if (url.pathname.endsWith('/members')) {
          return Response.json({ data: [] });
        }
        if (url.pathname.endsWith('/models/batch')) {
          batches.push(await incoming.json());
          return Response.json({ data: { items: [] } });
        }
        throw Error('Unexpected LifeSpace path: ' + url.pathname);
      },
    },
  };
  const draft = {
    summary: '训练', description: null, location,
    ...(locationDetail !== undefined ? { locationDetail } : {}),
    attendeeIds: [], isAllDay: true,
    startDate: '2026-10-25', endDateExclusive: '2026-10-26',
  };
  const response = await handleMiniNewDomainBff(new Request('https://homemew.test' + path, {
    method: 'POST',
    headers: { authorization: 'Bearer user-token-1234567890', 'content-type': 'application/json' },
    body: JSON.stringify({ targetType: 'event', draft }),
  }), env);
  return { response, batches };
}

test('legacy and upgraded Event Location formats are honored inside atomic quick-create', async () => {
  for (const format of ['string', 'location']) {
    const { response, batches } = await createQuickEvent(format, '足球公园');
    assert.equal(response.status, 200);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].atomicConsistency, true);
    assert.deepEqual(batches[0].operations[0].data.location,
      format === 'string' ? '足球公园' : { name: '足球公园' });
    assert.equal(batches[0].operations[1].operation, 'relation_create');
  }
});

test('explicit WGS84 selection is preserved in canonical quick-create only', async () => {
  const good = await createQuickEvent('location', selection.name, selection);
  assert.equal(good.response.status, 200);
  assert.deepEqual(good.batches[0].operations[0].data.location, selection);
  const old = await createQuickEvent('string', selection.name, selection);
  assert.equal(old.response.status, 422);
  assert.equal(old.batches.length, 0);
});

test('quick-create rejects mismatched names and malformed coordinates instead of fabricating points', async () => {
  const mismatched = await createQuickEvent('location', '另一个地方', selection);
  assert.equal(mismatched.response.status, 400);
  assert.equal(mismatched.batches.length, 0);
  const invalid = await createQuickEvent('location', selection.name, { ...selection, coordinates: { latitude: 999, longitude: 116.4 } });
  assert.equal(invalid.response.status, 422);
  assert.equal(invalid.batches.length, 0);
});
