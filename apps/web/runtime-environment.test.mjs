import assert from 'node:assert/strict';
import test from 'node:test';
import { getRuntimeEnvironment, withRuntimeEnvironment, environmentApiPath } from './src/lib/runtime-environment.ts';

function at(search, fn) {
  const old = globalThis.window;
  globalThis.window = { location: { search } };
  try { fn(); } finally {
    if (old === undefined) delete globalThis.window;
    else globalThis.window = old;
  }
}

test('LifeSpace production is always default, including after a staging visit', () => {
  at('?env=staging', () => {
    assert.equal(getRuntimeEnvironment(), 'staging');
    assert.equal(environmentApiPath('/api/session'), '/_stage/api/session');
  });
  for (const query of ['', '?other=1', '?env=unknown', '?env=production']) {
    at(query, () => {
      assert.equal(getRuntimeEnvironment(), 'production');
      assert.equal(environmentApiPath('/api/session'), '/api/session');
      assert.equal(withRuntimeEnvironment('/calendar'), '/calendar');
    });
  }
});

test('SPA navigation preserves explicit staging environment and ordinary query/fragment', () => {
  at('?env=staging', () => {
    assert.equal(withRuntimeEnvironment('/calendar'), '/calendar?env=staging');
    assert.equal(withRuntimeEnvironment('/tasks?sort=due#today'), '/tasks?sort=due&env=staging#today');
    assert.deepEqual(withRuntimeEnvironment({ pathname: '/football', search: '?view=chart', hash: '#scorers' }), {
      pathname: '/football', search: '?view=chart&env=staging', hash: '#scorers',
    });
    assert.equal(withRuntimeEnvironment('/'), '/?env=staging');
    assert.equal(environmentApiPath('/api/lifespace/core/v1/spaces'), '/_stage/api/lifespace/core/v1/spaces');
  });
});

test('changing browser URL to production immediately stops staging routing', () => {
  at('?env=staging', () => assert.equal(getRuntimeEnvironment(), 'staging'));
  at('', () => assert.equal(getRuntimeEnvironment(), 'production'));
});
