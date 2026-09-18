import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('HomeMew Web has one explicit production release path and no active staging deployment', () => {
  assert.equal(existsSync('.github/workflows/web-staging-deploy.yml'), false);
  assert.equal(existsSync('apps/web/scripts/deploy-staging.mjs'), false);

  const rootPackage = readJson('package.json');
  const webPackage = readJson('apps/web/package.json');
  const developmentConfig = readJson('apps/web/wrangler.jsonc');
  assert.equal(Object.hasOwn(rootPackage.scripts, 'deploy:web:staging'), false);
  assert.equal(Object.hasOwn(webPackage.scripts, 'deploy:staging'), false);
  assert.equal(Object.hasOwn(developmentConfig.env ?? {}, 'staging'), false);

  const production = readJson('apps/web/wrangler.production.jsonc');
  assert.equal(production.name, 'homemew-web-production');
  assert.equal(production.workers_dev, false);
  assert.equal(production.vars?.ENVIRONMENT, 'production');
  assert.equal(Object.hasOwn(production.vars ?? {}, 'LIFESPACE_EVENT_CONTRACT'), false);
  assert.equal(production.services?.find(item => item.binding === 'LIFESPACE_CORE')?.service, 'lifespace-core');
  assert.equal(production.services?.find(item => item.binding === 'LIFESPACE_IDENTITY')?.service, 'lifespace-identity');

  const workflow = readFileSync('.github/workflows/web-production-deploy.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /DEPLOY_HOMEMEW_WEB_PRODUCTION/u);
  assert.match(workflow, /production smoke|Verify Access front door and Mini Program provider route/u);
});
