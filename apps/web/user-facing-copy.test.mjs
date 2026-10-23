import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ApiError } from './src/lib/api-client.ts';
import { householdErrorMessage } from './src/lib/user-facing-error.ts';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('household errors do not reveal internal field names, request IDs or SQL messages', () => {
  const queries = [
    new ApiError('QUERY_UNSUPPORTED', 'matchId.eq is unsupported', 'req_abc', 400),
    new ApiError('INTERNAL', 'D1 SQL constraint failed', 'req_other', 500),
    new Error('TypeError: Failed to fetch'),
  ];
  for (const query of queries) {
    const message = householdErrorMessage(query);
    assert.doesNotMatch(message, /matchId|unsupported|req_|SQL|D1|TypeError|Failed to fetch/);
    assert.match(message, /[\u3400-\u9fff]/u);
  }
  assert.match(householdErrorMessage(new ApiError('FORBIDDEN', 'forbidden', undefined, 403)), /权限/u);
  assert.match(householdErrorMessage(new ApiError('CONFLICT', 'conflict', undefined, 409)), /刷新/u);
  assert.equal(householdErrorMessage(new Error('比赛日期和双方球队为必填')), '比赛日期和双方球队为必填');
});

test('family pages show user choices rather than internal model or version explanations', () => {
  const files = [
    './src/pages/football-page.tsx',
    './src/pages/football-manage-page.tsx',
    './src/pages/football-person-picker.tsx',
    './src/pages/wishes-page.tsx',
    './src/pages/calendar-page.tsx',
    './src/pages/tasks-page.tsx',
    './src/pages/days-page.tsx',
    './src/components/container-relations.tsx',
    './src/components/session-gate.tsx',
    './src/pages/more-page.tsx',
    './src/pages/settings-page.tsx',
  ].map(source);
  const sourceText = files.join('\n');
  for (const obsolete of [
    '当前 LifeSpace 环境尚不能读取足球表现模型',
    '其他 Space Person 按姓名搜索',
    '暂无已用球队，可搜索已有 PersonGroup',
    '模型发布后可查看统计',
    '· 版本 {editing.version}',
    '新建 LifeSpace Task 并立即关联',
    'Service Principal、Agent、凭据、Data Grant',
    'HomeMew Web 需要已有家事喵账号',
  ]) assert.ok(!sourceText.includes(obsolete), 'obsolete UI copy: ' + obsolete);
  assert.match(sourceText, /关联已有家事喵账号/);
  assert.match(sourceText, /最近选过或在比赛中用过的球队/);
  assert.match(sourceText, /暂时无法确认你在这个家庭中的身份/);
});
