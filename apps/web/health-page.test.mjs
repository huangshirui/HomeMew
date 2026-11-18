import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source=file=>readFileSync(new URL(file,import.meta.url),'utf8');
const domain=source('./src/pages/health-domain.ts'),page=source('./src/pages/health-page.tsx');
test('health scope, page limits and lifecycle',()=>{
  assert.match(domain,/field:'subjectPersonId',op:'contains'/u);
  assert.match(domain,/model==='health_metric'\?\{\}/u);
  assert.match(domain,/Math\.min\(40/u);
  assert.match(page,/currentFamily\.id\+':'\+selected\.personId\+':'\+tab/u);
  assert.match(page,/generation\.current \+= 1/u);
  assert.doesNotMatch(page+domain,/localStorage|sessionStorage|console\.log/u);
  assert.match(page,/pending\.current\?\.key===key/u);
  assert.match(page,/result\.items\.some\(item => item\.subjectPersonId !== personId\)/u);
  assert.match(page,/setItems\(\[\]\);setCursor\(null\);setLoadedScope\(scope\);setError/u);
});
test('health uses four tabs, authoritative capability preview and versioned writes',()=>{
  for(const label of ['概览','健康指标','健康事件','健康档案'])assert.ok(page.includes(label));
  assert.match(source('./src/app.tsx'),/path="family-health" element=\{<HealthPage \/>\}/u);
  assert.match(domain,/\/api\/lifespace\/core\/v1\/spaces\//u);
  assert.match(domain,/version: existing\.version/u);
  assert.match(domain,/spaceRoot\(spaceId\)\+'\/_discovery'/u);
  assert.match(page,/currentFamily\?\.role!=='viewer'/u);
  assert.match(page,/new Set\(points\.map\(p => p\.unit/u);
  assert.match(domain,/atomicConsistency: true/u);
  assert.equal((page.match(/useHealthList<HealthMetric>\(spaceId,'health_metric'/gu)||[]).length,1);
});
test('reserved health route, relationships and immutable field guard',()=>{
  assert.match(source('./src/app.tsx'),/path="family-health"/u);
  assert.doesNotMatch(source('./src/app.tsx'),/path="health"/u);
  assert.match(source('./wrangler.production.jsonc'),/"\/health"/u);
  assert.match(domain,/sourceModelKey:'health_event'/u);
  assert.match(domain,/predicate:'relates_to'/u);
  assert.match(page,/verifyDocumentEvent\(spaceId,personId,eventId\)/u);
  assert.match(domain,/delete fields.subjectPersonId/u);
});
test('bounded growth and on-demand query and file access',()=>{
  assert.match(domain,/readGrowthObservations/u);
  assert.match(domain,/field:'metricId',op:'contains',value:heightId/u);
  assert.match(page,/const boundary=page.nextCursor\?page.items.at\(-1\)\?\.observedDate/u);
  assert.match(page,/obs.cursor&&!localBmi/u);
  assert.match(domain,/field:'observedDate',op:'gte'/u);
  assert.match(domain,/field:'documentType',op:'eq'/u);
  assert.match(page,/\{limit:20\},chooseEvent/u);
  assert.match(page,/preview\?<DocumentPreview/u);
  assert.match(page,/URL.revokeObjectURL/u);
  assert.match(page,/iframe sandbox=""/u);
});

 test('stable empty list avoids repeated effects while access or data is unavailable',()=>{
 assert.match(page,/const EMPTY_HEALTH_ROWS:never\[\]=\[\]/u);assert.match(page,/items:ready\?items:EMPTY_HEALTH_ROWS/u);assert.match(page,/!obs.loading&&!obs.error\?extra:EMPTY_HEALTH_ROWS/u);
 });
