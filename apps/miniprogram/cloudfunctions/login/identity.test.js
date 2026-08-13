const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveIdentity } = require('./identity');

test('creates and stores a mapping for a new identity', async () => {
  const calls = [];
  const result = await resolveIdentity({
    openid: 'wx-new',
    existingMapping: null,
    createUser: async () => 'user-new',
    verifyUser: async () => assert.fail('must not verify without a mapping'),
    addMapping: async value => calls.push(['add', value]),
    updateMapping: async value => calls.push(['update', value]),
    nowIso: () => '2026-08-01T01:02:03.000Z',
  });
  assert.deepEqual(result, { userId: 'user-new', isNewUser: true });
  assert.deepEqual(calls, [['add', {
    openid: 'wx-new',
    homemewUserId: 'user-new',
    provider: 'wechat_miniprogram',
    createdAt: '2026-08-01T01:02:03.000Z',
    updatedAt: '2026-08-01T01:02:03.000Z',
  }]]);
});

test('reuses a verified mapping', async () => {
  const updates = [];
  const result = await resolveIdentity({
    openid: 'wx-old',
    existingMapping: { _id: 'map-1', homemewUserId: 'user-old' },
    verifyUser: async userId => {
      assert.equal(userId, 'user-old');
      return true;
    },
    createUser: async () => assert.fail('must not create a verified user'),
    addMapping: async () => assert.fail('must not add another mapping'),
    updateMapping: async value => updates.push(value),
    nowIso: () => '2026-08-01T01:02:03.000Z',
  });
  assert.deepEqual(result, { userId: 'user-old', isNewUser: false });
  assert.deepEqual(updates, [{ mappingId: 'map-1', data: { updatedAt: '2026-08-01T01:02:03.000Z' } }]);
});

test('adds a parallel LifeSpace mapping to the existing openid document without overwriting HomeMew identity', async () => {
  const updates = [];
  const result = await resolveIdentity({
    openid: 'wx-migrate',
    existingMapping: { _id: 'map-life', homemewUserId: 'hmw-user' },
    mappingField: 'lifespaceUserId',
    verifyUser: async () => assert.fail('new LifeSpace mapping must not verify before creation'),
    createUser: async () => 'usr_lifespace',
    addMapping: async () => assert.fail('must reuse the existing openid mapping document'),
    updateMapping: async value => updates.push(value),
    nowIso: () => '2026-08-13T01:02:03.000Z',
  });
  assert.deepEqual(result, { userId: 'usr_lifespace', isNewUser: true });
  assert.deepEqual(updates, [{
    mappingId: 'map-life',
    data: {
      lifespaceUserId: 'usr_lifespace',
      updatedAt: '2026-08-13T01:02:03.000Z',
    },
  }]);
  assert.equal(updates[0].data.homemewUserId, undefined);
});

test('rebuilds a stale mapping only when verification reports missing', async () => {
  const updates = [];
  const result = await resolveIdentity({
    openid: 'wx-stale',
    existingMapping: { _id: 'map-2', homemewUserId: 'deleted-user' },
    verifyUser: async () => false,
    createUser: async () => 'replacement-user',
    addMapping: async () => assert.fail('must update the existing mapping'),
    updateMapping: async value => updates.push(value),
    nowIso: () => '2026-08-01T01:02:03.000Z',
  });
  assert.deepEqual(result, { userId: 'replacement-user', isNewUser: true });
  assert.deepEqual(updates, [{
    mappingId: 'map-2',
    data: {
      homemewUserId: 'replacement-user',
      updatedAt: '2026-08-01T01:02:03.000Z',
    },
  }]);
});

for (const label of ['401', '500', 'timeout']) {
  test(`does not create a user when verification fails with ${label}`, async () => {
    let created = false;
    const failure = new Error(label);
    await assert.rejects(resolveIdentity({
      openid: 'wx-error',
      existingMapping: { _id: 'map-3', homemewUserId: 'user-old' },
      verifyUser: async () => { throw failure; },
      createUser: async () => { created = true; return 'duplicate'; },
      addMapping: async () => {},
      updateMapping: async () => {},
      nowIso: () => '2026-08-01T01:02:03.000Z',
    }), failure);
    assert.equal(created, false);
  });
}
