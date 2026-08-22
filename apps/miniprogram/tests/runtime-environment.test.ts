import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildUserAvatarUrl, resolveRuntimeEnvironment } from '../miniprogram/services/config.ts';

test('main Mini Program runtime is pinned to production for all WeChat env versions', () => {
  for (const envVersion of [undefined, 'develop', 'trial', 'release']) {
    assert.equal(resolveRuntimeEnvironment(envVersion), 'production');
  }
});

test('buildUserAvatarUrl uses the stable LifeSpace Identity asset route', () => {
  assert.equal(
    buildUserAvatarUrl('https://auth.aisr.online/', 'usr_example'),
    'https://auth.aisr.online/assets/users/usr_example/avatar',
  );
});
