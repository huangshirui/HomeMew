const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LIFESPACE_KERNEL_CONTRACT,
  LIFESPACE_MODEL_CONTRACT,
  LIFESPACE_IDENTITY_CONTRACT,
  USER_SCOPES,
  createLifeSpaceIdentityClient,
} = require('./lifespace');

test('pins the Phase 4 LifeSpace contract triple and stable ordinary-resource scopes', () => {
  assert.equal(LIFESPACE_KERNEL_CONTRACT, '0.12.0');
  assert.equal(LIFESPACE_MODEL_CONTRACT, 'mct_9a3d9588da8591ab376ef000e5e661f670a64dd8b1ebc14fd146580f0ed1fa45');
  assert.equal(LIFESPACE_IDENTITY_CONTRACT, '0.4.0');
  assert.deepEqual(USER_SCOPES, [
    'profile:read',
    'profile:write',
    'spaces:read',
    'spaces:write',
    'spaces:manage',
    'resources:read',
    'resources:write',
    'creation-drafts:read',
    'creation-drafts:write',
  ]);
  assert.equal(USER_SCOPES.includes('models:manage'), false);
  assert.equal(USER_SCOPES.some(scope => scope.startsWith('tasks:') || scope.startsWith('events:')), false);
});

test('creates LifeSpace users and exchanges only the pinned application user scopes', async () => {
  const calls = [];
  const request = async options => {
    calls.push(options);
    if (options.path === '/internal/v1/users') {
      return { statusCode: 201, data: { data: { id: 'usr_new' } } };
    }
    if (options.path === '/internal/v1/tokens') {
      return { statusCode: 200, data: { data: { accessToken: 'jwt', expiresIn: 900, scope: options.body.scopes.join(' ') } } };
    }
    throw new Error(`Unexpected path ${options.path}`);
  };

  const client = createLifeSpaceIdentityClient({
    applicationCredential: 'lsa_test_credential_that_is_server_only',
    identityBaseUrl: 'https://auth-staging.aisr.online/',
    coreBaseUrl: 'https://core-staging.aisr.online/',
    request,
  });

  assert.equal(await client.createUser('wxabcdef123'), 'usr_new');
  const token = await client.issueUserToken('usr_new');
  assert.deepEqual(token, { accessToken: 'jwt', expiresIn: 900, scope: USER_SCOPES.join(' ') });
  assert.deepEqual(calls[0], {
    baseUrl: 'https://auth-staging.aisr.online',
    method: 'POST',
    path: '/internal/v1/users',
    bearer: 'lsa_test_credential_that_is_server_only',
    body: { displayName: '微信用户wxabcd' },
  });
  assert.deepEqual(calls[1].body, { subjectId: 'usr_new', scopes: [...USER_SCOPES] });
});

test('does not reinterpret token exchange denial as a missing user', async () => {
  const client = createLifeSpaceIdentityClient({
    applicationCredential: 'lsa_test_credential_that_is_server_only',
    request: async () => ({ statusCode: 403, data: { error: { code: 'FORBIDDEN', message: 'User is not active' } } }),
  });

  await assert.rejects(client.issueUserToken('usr_disabled'), error => {
    assert.equal(error.code, 'FORBIDDEN');
    assert.equal(error.statusCode, 403);
    return true;
  });
});
