import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildUserAvatarUrl, resolveRuntimeEnvironment, selectLaunchEnvironment, getApplicationBaseUrl, getRuntimeEnvironment } from '../miniprogram/services/config.ts';

test('main Mini Program runtime is pinned to production for all WeChat env versions', () => {
  for (const envVersion of [undefined, 'develop', 'trial', 'release']) {
    assert.equal(resolveRuntimeEnvironment(envVersion), 'production');
  }
});

test('buildUserAvatarUrl uses the stable HomeMew media route', () => {
  assert.equal(
    buildUserAvatarUrl('https://homemew.aisr.online/', 'usr_example'),
    'https://homemew.aisr.online/api/v1/miniprogram/media/users/usr_example/avatar',
  );
});

test('Mini explicit path env selects staging prefix without persisting a UI toggle', () => {
  assert.equal(selectLaunchEnvironment('staging'), true);
  assert.equal(getRuntimeEnvironment(), 'staging');
  assert.equal(getApplicationBaseUrl(), 'https://homemew.aisr.online/_stage');
  assert.equal(selectLaunchEnvironment('https://evil.example'), false);
  assert.equal(getRuntimeEnvironment(), 'staging');
  assert.equal(selectLaunchEnvironment('production'), true);
  assert.equal(getApplicationBaseUrl(), 'https://homemew.aisr.online');
});
