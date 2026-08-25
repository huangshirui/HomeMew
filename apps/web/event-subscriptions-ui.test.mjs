import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('./src/pages/event-subscriptions-page.tsx', import.meta.url);

async function source() {
  return readFile(sourceUrl, 'utf8');
}

test('event subscription UI exposes both event and task models', async () => {
  const value = await source();
  assert.match(value, /key: 'event'[\s\S]*label: '日程'/u);
  assert.match(value, /key: 'task'[\s\S]*label: '待办'/u);
  assert.match(value, /modelKey: selectedModel/u);
  assert.match(value, /supportedModelKeys\.has\(item\.modelKey as SubscriptionModelKey\)/u);
});

test('event subscription UI no longer presents calendar as the only supported model', async () => {
  const value = await source();
  assert.doesNotMatch(value, /第一版仅开放“日程”/u);
  assert.match(value, /当前开放“日程”和“待办”/u);
});
