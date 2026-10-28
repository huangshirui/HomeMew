import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function sourceFiles(relativePath) {
  const root = new URL(relativePath, import.meta.url);
  const files = [];
  for (const entry of readdirSync(root)) {
    const url = new URL(entry, root.href.endsWith('/') ? root.href : `${root.href}/`);
    if (statSync(url).isDirectory()) {
      files.push(...sourceFiles(`${relativePath.replace(/\/$/u, '')}/${entry}/`));
    } else if (/\.(?:ts|tsx)$/u.test(entry)) {
      files.push({ path: url.pathname, content: readFileSync(url, 'utf8') });
    }
  }
  return files;
}

test('external system creation only creates HomeMew metadata', () => {
  const page = source('./src/pages/integrations-page.tsx');
  const api = source('./integration-api.mjs');

  assert.match(page, /先填写外部系统的信息/u);
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
  assert.match(detail, /需要先设置服务接入/u);
  assert.match(service, /创建 Service Access/u);
  assert.match(agent, /bindExternalSystemAgent/u);
  assert.doesNotMatch(agent, /patchServiceBinding/u);
});

test('generic Web integration copy does not hard-code one consumer product', () => {
  for (const file of sourceFiles('./src/')) {
    assert.doesNotMatch(file.content, /n8n/iu, `${file.path} must keep generic integration copy vendor-neutral`);
  }
});

test('Service credential one-time reveal survives the parent binding refresh', () => {
  const detail = source('./src/pages/integration-detail-page.tsx');
  const service = source('./src/pages/service-access-section.tsx');

  assert.match(detail, /load\(\{ preserveContent: true \}\)/u);
  assert.match(detail, /if \(!preserveContent\) setLoading\(true\)/u);
  assert.ok(
    service.indexOf('setRevealedCredential(result.credential)') < service.indexOf('await onBindingChanged()'),
    'the one-time secret must be stored before the parent binding summary refreshes',
  );
});

test('retired 喵一下 shell card is absent', () => {
  const shell = source('./src/components/app-shell.tsx');
  assert.doesNotMatch(shell, /喵一下/u);
  assert.doesNotMatch(shell, /Sparkles/u);
});

test('external-system permission UI obtains models from LifeSpace instead of a fixed three-model catalog', () => {
  const catalog = source('./src/lib/integrations.ts');
  const service = source('./src/pages/service-access-section.tsx');
  const agent = source('./src/pages/agent-access-section.tsx');
  assert.match(catalog, /\/api\/lifespace\/core\/v1\/me\/_discovery\/models/u);
  assert.match(catalog, /visibleIntegrationModels/u);
  assert.match(service, /fetchIntegrationModels/u);
  assert.match(agent, /fetchIntegrationModels/u);
  assert.doesNotMatch(service, /integrationModels\.map/u);
  assert.doesNotMatch(agent, /integrationModels\.map/u);
  assert.match(service, /!canManageModels/u);
  assert.match(agent, /!canManageModels/u);
});

test('football performance model key has a localized HomeMew label', () => {
  const catalog = source('./src/lib/integrations.ts');
  assert.match(catalog, /football_performance: '球员表现'/u);
  assert.doesNotMatch(catalog, /football_player_performance: '球员表现'/u);
});

test('Person Directory is a separate Kernel Data Grant, not a discovered model grant', () => {
  const catalog = source('./src/lib/integrations.ts');
  const service = source('./integration-api-core.mjs');
  const agent = source('./external-system-agent-api.mjs');
  const legacyAgent = source('./agent-integration-api.mjs');

  assert.match(catalog, /PERSON_DIRECTORY_PERMISSION_KEY = 'person_directory'/u);
  assert.match(catalog, /label: '人员'/u);
  assert.match(catalog, /return \[personDirectoryPermission, \.\.\.models/u);
  for (const sourceCode of [service, agent, legacyAgent]) {
    assert.match(sourceCode, /PERSON_DIRECTORY_KEY = 'person_directory'/u);
    assert.match(sourceCode, /modelKey === PERSON_DIRECTORY_KEY \? 'person-directory\/grants' : 'grants'/u);
    assert.match(sourceCode, /modelKey === PERSON_DIRECTORY_KEY \? \{\} : \{ resourceType: 'model', resourceId: modelKey \}/u);
    assert.match(sourceCode, /grant\.resourceType === 'person_directory' && grant\.resourceId === null/u);
  }
});
