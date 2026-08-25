import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('./src/pages/event-subscriptions-page.tsx', import.meta.url);

async function source() {
  return readFile(sourceUrl, 'utf8');
}

test('event push UI exposes event and task as filters under one webhook endpoint', async () => {
  const value = await source();
  assert.match(value, /key: 'event'[\s\S]*label: '日程'/u);
  assert.match(value, /key: 'task'[\s\S]*label: '待办'/u);
  assert.match(value, /\/api\/lifespace\/core\/v1\/webhook-endpoints/u);
  assert.match(value, /endpointId, modelKey: option\.key, eventTypes/u);
  assert.match(value, /一个 Webhook，选择要订阅的内容/u);
  assert.match(value, /一套 URL \/ 一套密钥/u);
});

test('transport controls live on the webhook endpoint instead of each model subscription', async () => {
  const value = await source();
  assert.match(value, /webhook-endpoints\/\$\{encodeURIComponent\(endpoint\.id\)\}\/test/u);
  assert.match(value, /webhook-endpoints\/\$\{encodeURIComponent\(endpointId\)\}\/deliveries/u);
  assert.match(value, /rotateSigningSecret: true/u);
  assert.doesNotMatch(value, /event-subscriptions\/\$\{encodeURIComponent\([^)]*\.id\)\}\/test/u);
  assert.doesNotMatch(value, /event-subscriptions\/\$\{encodeURIComponent\([^)]*\.id\)\}\/deliveries/u);
  assert.doesNotMatch(value, /function ModelPicker/u);
});
