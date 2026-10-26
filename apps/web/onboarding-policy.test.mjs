import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

test('HomeMew Web remains existing-user-link-only', () => {
  const worker = source('./worker.mjs');
  const sessionGate = source('./src/components/session-gate.tsx');
  const readme = source('../../README.md');
  const architecture = source('../../docs/architecture.md');
  const webPlan = source('../../docs/web-plan.md');
  const decision = source('../../docs/decisions/2026-08-25-web-existing-user-link-only.md');

  assert.match(decision, /Status: Accepted/u);
  assert.match(decision, /HomeMew Web must not expose or proxy LifeSpace Access registration/u);

  assert.match(worker, /\/api\/access\/link-challenge/u);
  assert.doesNotMatch(worker, /\/api\/access\/register/u, 'the HomeMew Web BFF must not expose Access registration');

  assert.match(sessionGate, /关联已有家事喵账号/u);
  assert.match(sessionGate, /首次使用家事喵，请先打开微信小程序/u);
  assert.match(sessionGate, /设置 → 绑定邮箱/u);
  assert.doesNotMatch(sessionGate, /创建新账号|registerNewAccount|\/api\/access\/register/u);

  assert.match(readme, /existing-user link challenge/u);
  assert.doesNotMatch(readme, /explicit registration/u);

  assert.match(architecture, /HomeMew Web does not expose LifeSpace Access registration/u);
  assert.doesNotMatch(architecture, /create new LifeSpace account/u);

  assert.match(webPlan, /only links an existing HomeMew\/LifeSpace user/u);
  assert.doesNotMatch(webPlan, /link-existing or create-new flows|account linking\/registration UI/u);
});

test('primary Web docs retain the accepted production front-door state', () => {
  const architecture = source('../../docs/architecture.md');
  const webPlan = source('../../docs/web-plan.md');
  const decision = source('../../docs/decisions/2026-08-24-web-production-cutover.md');

  assert.match(decision, /Status: Accepted/u);
  assert.match(decision, /homemew\.aisr\.online` is now owned by `homemew-web-production/u);
  assert.match(architecture, /2026-08-24/u);
  assert.match(architecture, /homemew-web/u);
  assert.doesNotMatch(architecture, /A later controlled production Web cutover/u);

  assert.match(webPlan, /production front-door cutover completed/u);
  assert.match(webPlan, /homemew-web-production/u);
  assert.doesNotMatch(webPlan, /only after staging acceptance, design the production front-door cutover|Do not transfer the production hostname to the Web Worker/u);
});
