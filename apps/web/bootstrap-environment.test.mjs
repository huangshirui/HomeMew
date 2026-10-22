import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const boot = readFileSync(new URL('./src/main.tsx', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('./wrangler.production.jsonc', import.meta.url), 'utf8'));

test('Web bootstrap has no query-specific staging warning or environment switch', () => {
  assert.match(boot, /createRoot\(root\)\.render\(/);
  assert.match(boot, /<BrowserRouter>/);
  assert.doesNotMatch(boot, /searchParams|URLSearchParams|retiredStagingUrl|env=staging|旧测试入口已停用/);
});

test('the Worker deployment, not URL parameters, selects LifeSpace', () => {
  assert.equal(config.vars.ENVIRONMENT, 'production');
  assert.equal(config.previews.vars.ENVIRONMENT, 'staging');
  assert.equal(config.services.find(b => b.binding === 'LIFESPACE_CORE').service, 'lifespace-core');
  assert.equal(config.previews.services.find(b => b.binding === 'LIFESPACE_CORE').service, 'lifespace-core-staging');
});
