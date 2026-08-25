import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const productionWranglerUrl = new URL('./wrangler.production.jsonc', import.meta.url);
const cutoverScriptUrl = new URL('./scripts/cutover-production-domain.mjs', import.meta.url);
const cutoverWorkflowUrl = new URL('../../.github/workflows/web-production-cutover.yml', import.meta.url);

test('production front door stays traffic-dark until the guarded cutover', async () => {
  const config = JSON.parse(await readFile(productionWranglerUrl, 'utf8'));
  assert.equal(config.name, 'homemew-web-production');
  assert.equal(config.workers_dev, false);
  assert.equal(Array.isArray(config.routes) ? config.routes.length : 0, 0);
  assert.deepEqual(
    config.services?.find((entry) => entry.binding === 'HOMEMEW_BACKEND'),
    { binding: 'HOMEMEW_BACKEND', service: 'homemew-backend-production' },
  );
});

test('production cutover requires the Eventing-capable LifeSpace release', async () => {
  const source = await readFile(cutoverScriptUrl, 'utf8');
  assert.match(source, /REQUIRED_IDENTITY_CONTRACT = '0\.5\.0'/);
  assert.match(source, /REQUIRED_CORE_CONTRACT = '0\.15\.0'/);
  assert.doesNotMatch(source, /REQUIRED_CORE_CONTRACT = '0\.14\.0'/);
  assert.match(source, /CUTOVER_HOMEMEW_WEB_PRODUCTION/);
  assert.match(source, /verifyMiniProgramLogin\(\)/);
  assert.match(source, /verifyAccessRoot\(\)/);
  assert.match(source, /restoring the production Custom Domain to the previous backend/);
});

test('production cutover remains manual and confirmation-gated', async () => {
  const workflow = await readFile(cutoverWorkflowUrl, 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /confirmation:/);
  assert.match(workflow, /CUTOVER_HOMEMEW_WEB_PRODUCTION/);
  assert.doesNotMatch(workflow, /\n\s*push:/);
});
