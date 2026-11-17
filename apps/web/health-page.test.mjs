import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const domain = source('./src/pages/health-domain.ts');
const page = source('./src/pages/health-page.tsx');
test('health scope is the household Space and selected Person, not actor identity', () => {
  assert.match(domain, /field: 'subjectPersonId', op: 'contains'/u);
  assert.match(domain, /model === 'health_metric' \? \{\}/u);
  assert.match(domain, /limit: 40, cursor/u);
  assert.match(page, /currentFamily\.id \+ ':' \+ selected\.personId \+ ':' \+ tab/u);
  assert.match(page, /generation\.current \+= 1/u);
  assert.doesNotMatch(page + domain, /localStorage|sessionStorage|console\.log/u);
});
test('health uses four tabs, existing BFF and versioned writes', () => {
  for (const label of ['概览','健康指标','健康事件','健康档案']) assert.ok(page.includes(label));
  assert.match(source('./src/app.tsx'), /path="family-health" element=\{<HealthPage \/>\}/u);
  assert.match(domain, /\/api\/lifespace\/core\/v1\/spaces\//u);
  assert.match(domain, /version: existing\.version/u);
  assert.match(page, /currentFamily\.role !== 'viewer'/u);
  assert.match(page, /new Set\(points\.map\(p => p\.unit/u);
});

test('health never displays a mismatched subject and uses the native atomic batch', () => {
  assert.match(page, /result\.items\.some\(item => item\.subjectPersonId !== personId\)/u);
  assert.match(domain, /atomicConsistency: true/u);
  assert.match(page, /readHealthSchema\(spaceId, 'health_event'\)/u);
});

test('product route never shadows reserved worker readiness endpoint',()=>{
  assert.match(source('./src/app.tsx'),/path="family-health"/u);
  assert.doesNotMatch(source('./src/app.tsx'),/path="health"/u);
  assert.match(source('./wrangler.production.jsonc'),/"\/health"/u);
});
test('health relations reuse declared source predicate and document event field',()=>{
  assert.match(domain,/sourceModelKey:'health_event'/u);
  assert.match(domain,/predicate:'relates_to'/u);
  assert.match(page,/verifyDocumentEvent\(spaceId,personId,eventId\)/u);
  assert.match(domain,/delete fields.subjectPersonId/u);
});

test('BMI loads the two specific growth metrics rather than depending on total observation count',()=>{
  assert.match(domain,/readGrowthObservations/u);
  assert.match(domain,/field:'metricId',op:'contains',value:heightId/u);
  assert.match(page,/const boundary=page.nextCursor\?page.items.at\(-1\)\?\.observedDate/u);
});
