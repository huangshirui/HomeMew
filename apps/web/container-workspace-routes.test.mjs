import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const app = read('./src/app.tsx');
const page = read('./src/pages/domain-page.tsx');
const relations = read('./src/components/container-relations.tsx');
const calendar = read('./src/pages/calendar-page.tsx');

test('Activity Goal Habit have deep-linked detail routes, not container dialogs', () => {
  for (const [path, model] of [['activities','activity'],['goals','goal'],['habits','habit']]) {
    assert.ok(app.includes(`path="${path}/:recordId" element={<DomainPage modelKey="${model}" />}`));
  }
  assert.match(page, /useParams<\{ recordId\?: string \}>\(\)/);
  assert.match(page, /apiRequest<DomainRecord>\(url\(currentFamily\.id, modelKey, recordId\)\)/);
  assert.match(page, /detailMode \? !currentFamily/);
  assert.match(page, /mode="page"/);
  assert.match(page, /navigate\(listPath\)/);
  assert.doesNotMatch(page, /setContainerFor\(record\)/);
});

test('Current tab is initial Activity view, with date-aware bounded server query', () => {
  assert.match(page, /useState<ActivityPeriod>\('current'\)/);
  for(const label of ['当前','即将开始','已结束','全部']) assert.ok(page.includes(label));
  assert.match(page, /period === 'current'/);
  assert.match(page, /field: 'startDate', op: 'isNull'/);
  assert.match(page, /field: 'startDate', op: 'lte'/);
  assert.match(page, /field: 'endDate', op: 'isNull'/);
  assert.match(page, /field: 'endDate', op: 'gte'/);
  assert.match(page, /sort: \[\{ field: 'createdAt', direction: 'desc' \}\]/);
  assert.match(page, /page: \{ limit: 40,/);
  assert.doesNotMatch(page, /activityStatus.*localStorage/);
});

test('Activity workspace reuses full Calendar editor and native atomic semantic association', () => {
  assert.match(relations, /defaultDraft\(timezone, record\.startDate \|\| undefined\)/);
  assert.match(relations, /<EventEditor draft=\{eventDraft\}/);
  assert.match(relations, /eventPayload\(eventDraft\)/);
  assert.match(relations, /presentationToSave\(spaceId, 'event', eventDraft\.icon\)/);
  assert.match(relations, /modelKey: 'event', clientRef: 'new_event'/);
  assert.match(relations, /operation: 'relation_create'/);
  assert.match(relations, /atomicConsistency: true/);
  assert.match(relations, /新建日程/);
  assert.match(relations, /管理参与人/);
  assert.match(relations, /新建待办/);
  assert.match(relations, /添加倒计时/);
  assert.match(calendar, /export function EventEditor/);
  assert.match(calendar, /export function eventPayload/);
});

test('Workspace tabs distinguish activity schedules, goal actions, habit-related content', () => {
  assert.match(relations, /活动日程/);
  assert.match(relations, /活动待办/);
  assert.match(relations, /行动计划/);
  assert.match(relations, /相关内容/);
  assert.match(page, /今天打卡/);
  assert.match(page, /myPersonId === record\.subjectPersonId/);
});

test('New containers open their detail rather than disappear under current-date filter', () => {
  assert.match(page, /const saved = await apiRequest<DomainRecord>/);
  assert.match(page, /wasCreating && modelKey !== 'anniversary' && saved\?\.id/);
  assert.match(page, /navigate\(\`\$\{listPath\}\/\$\{encodeURIComponent\(saved\.id\)\}\`\)/);
});
test('Task quick action uses the complete existing editor with atomic relation', () => {
  assert.match(relations, /<TaskEditor draft=\{taskDraft\}/);
  assert.match(relations, /taskPayload\(taskDraft\)/);
  assert.match(relations, /presentationToSave\(spaceId, 'task', taskDraft\.icon\)/);
  assert.match(relations, /atomicConsistency: true/);
});
