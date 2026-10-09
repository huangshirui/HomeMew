import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('external system creation only creates HomeMew metadata', () => {
  const page = source('./src/pages/integrations-page.tsx');
  const api = source('./integration-api.mjs');

  assert.match(page, /这里只创建 HomeMew 的系统容器/u);
  assert.match(page, /displayName: name\.trim\(\)/u);
  assert.doesNotMatch(page, /credentialMode/u);
  assert.doesNotMatch(page, /permissions:/u);

  assert.match(api, /createExternalSystem/u);
  assert.match(api, /创建外部系统时只需要名称和说明/u);
  assert.match(api, /servicePrincipalId/u);
});

test('Service Access, Agent Access and Event Push are separate capability modules', () => {
  const detail = source('./src/pages/integration-detail-page.tsx');
  const service = source('./src/pages/service-access-section.tsx');
  const agent = source('./external-system-agent-api.mjs');

  assert.match(detail, /<ServiceAccessSection/u);
  assert.match(detail, /<AgentAccessSection/u);
  assert.match(detail, /<EventSubscriptionsSection/u);
  assert.match(detail, /需要先配置 Service Access/u);
  assert.match(service, /创建 Service Access/u);
  assert.match(agent, /bindExternalSystemAgent/u);
  assert.doesNotMatch(agent, /patchServiceBinding/u);
});

test('retired 喵一下 shell card is absent', () => {
  const shell = source('./src/components/app-shell.tsx');
  assert.doesNotMatch(shell, /喵一下/u);
  assert.doesNotMatch(shell, /Sparkles/u);
});
