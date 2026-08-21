import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRuntimeEnvironment } from '../miniprogram/services/config.ts';

test('main Mini Program runtime is pinned to production for all WeChat env versions', () => {
  for (const envVersion of [undefined, 'develop', 'trial', 'release']) {
    assert.equal(resolveRuntimeEnvironment(envVersion), 'production');
  }
});
