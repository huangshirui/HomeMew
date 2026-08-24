import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/web-production-cutover.yml', 'utf8');
const script = fs.readFileSync('apps/web/scripts/cutover-production-domain.mjs', 'utf8');

test('production cutover stays manual and confirmation-gated', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /CUTOVER_HOMEMEW_WEB_PRODUCTION/);
  assert.match(workflow, /GITHUB_REF_NAME.*main/);
});

test('production cutover preserves Mini Program login and supports rollback', () => {
  assert.match(script, /homemew\.aisr\.online/);
  assert.match(script, /\/api\/v1\/login\/wechat/);
  assert.match(script, /homemew-backend-production/);
  assert.match(script, /homemew-web-production/);
  assert.match(script, /movedByThisRun/);
  assert.match(script, /attachDomain\(OLD_SERVICE\)/);
  assert.match(script, /INVALID_REQUEST/);
});

test('production cutover requires all Web runtime secret bindings', () => {
  assert.match(script, /LIFESPACE_APPLICATION_CREDENTIAL/);
  assert.match(script, /WEB_SESSION_SECRET/);
  assert.match(script, /LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL/);
});
