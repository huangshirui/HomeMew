import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMiniNewDomainBff } from './miniprogram-new-domains-bff.mjs';

const path = '/api/v1/miniprogram/families/spc_family/containers/activities/rec_parent/quick-create';
const selection = {
  name: '足球公园', address: '北京市朝阳区',
  coordinates: { latitude: 39.99, longitude: 116.4 },
};

async function createQuickEvent(location, locationDetail) {
  const batches = [];
  const env = {
    LIFESPACE_CORE: {
      async fetch(incoming) {
        const url = new URL(incoming.url);
        if (url.pathname.endsWith('/members')) {
          assert.equal(incoming.method, 'GET', 'Family member lookup must never reuse quick-create POST');
          return Response.json({ data: [] });
        }
        if (url.pathname.endsWith('/models/batch')) {
          assert.equal(incoming.method, 'POST');
          batches.push(await incoming.json());
          return Response.json({ data: { items: [] } });
        }
        throw Error('Unexpected LifeSpace path: ' + url.pathname);
      },
    },
  };
  const draft = {
    summary: '训练', description: null, location,
    ...(locationDetail !== undefined ? { locationDetail } : {}),
    attendeeIds: [], isAllDay: true,
    startDate: '2026-10-25', endDateExclusive: '2026-10-26',
  };
  const response = await handleMiniNewDomainBff(new Request('https://homemew.test' + path, {
    method: 'POST',
    headers: { authorization: 'Bearer user-token-1234567890', 'content-type': 'application/json' },
    body: JSON.stringify({ targetType: 'event', draft }),
  }), env);
  return { response, batches };
}

test('old Mini label writes use canonical Location inside atomic quick-create', async () => {
  {
    const { response, batches } = await createQuickEvent('足球公园');
    assert.equal(response.status, 200);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].atomicConsistency, true);
    assert.deepEqual(batches[0].operations[0].data.location,
      { name: '足球公园' });
    assert.equal(batches[0].operations[1].operation, 'relation_create');
  }
});

test('explicit WGS84 selection is preserved in canonical quick-create only', async () => {
  const good = await createQuickEvent(selection.name, selection);
  assert.equal(good.response.status, 200);
  assert.deepEqual(good.batches[0].operations[0].data.location, selection);

});

test('quick-create rejects mismatched names and malformed coordinates instead of fabricating points', async () => {
  const mismatched = await createQuickEvent('另一个地方', selection);
  assert.equal(mismatched.response.status, 400);
  assert.equal(mismatched.batches.length, 0);
  const invalid = await createQuickEvent(selection.name, { ...selection, coordinates: { latitude: 999, longitude: 116.4 } });
  assert.equal(invalid.response.status, 422);
  assert.equal(invalid.batches.length, 0);
});

test('Mini semantic relation reads request the correct hydrated endpoint and preserve labels', async () => {
  const paths = [];
  const env = { LIFESPACE_CORE: { async fetch(incoming) {
    const url = new URL(incoming.url);
    paths.push(url);
    assert.equal(incoming.headers.get('authorization'), 'Bearer user-token-1234567890');
    return Response.json({ data: { items: [
      { id: 'rel_one', source: { modelKey: 'activity', recordId: 'rec_parent' },
        target: { modelKey: 'event', recordId: 'rec_event' },
        targetLabel: '足球训练', targetRecord: { summary: '足球训练' } },
    ], nextCursor: null } });
  } } };
  const base = '/api/v1/miniprogram/families/spc_family/containers/activities/rec_parent/relations';
  const headers = { authorization: 'Bearer user-token-1234567890' };
  const outgoing = await handleMiniNewDomainBff(
    new Request('https://homemew.test' + base + '?direction=outgoing&limit=50', { headers }), env);
  assert.equal(outgoing.status, 200);
  const data = (await outgoing.json()).data;
  assert.equal(data.items[0].targetLabel, '足球训练');
  assert.equal(data.items[0].targetRecord.summary, '足球训练');
  assert.equal(paths[0].pathname, '/api/v1/spaces/spc_family/semantic-relations');
  assert.equal(paths[0].searchParams.get('hydrate'), 'target');
  assert.equal(paths[0].searchParams.get('sourceRecordId'), 'rec_parent');
  assert.equal(paths[0].searchParams.get('predicate'), 'relates_to');

  const incoming = await handleMiniNewDomainBff(
    new Request('https://homemew.test' + base + '?direction=incoming', { headers }), env);
  assert.equal(incoming.status, 200);
  assert.equal(paths[1].searchParams.get('hydrate'), 'source');
  assert.equal(paths[1].searchParams.get('targetRecordId'), 'rec_parent');
});

test('candidate query passes full model fields through to Mini without dropping summary/title', async () => {
  const upstream = [];
  const env = { LIFESPACE_CORE: { async fetch(incoming) {
    upstream.push({ path: new URL(incoming.url).pathname, body: await incoming.json() });
    return Response.json({ data: { items: [
      { id: 'rec_event', summary: '足球训练' },
      { id: 'rec_wish', title: '去露营' },
    ], nextCursor: null } });
  } } };
  const path = '/api/v1/miniprogram/families/spc_family/containers/activities/rec_parent/candidates?model=event&q=足球';
  const response = await handleMiniNewDomainBff(
    new Request('https://homemew.test' + path, {
      headers: { authorization: 'Bearer user-token-1234567890' },
    }), env);
  assert.equal(response.status, 200);
  const result = (await response.json()).data.items;
  assert.equal(result[0].summary, '足球训练');
  assert.equal(result[1].title, '去露营');
  assert.equal(upstream[0].path, '/api/v1/spaces/spc_family/models/event/records/query');
  assert.equal(upstream[0].body.search.text, '足球');
});

const activityPath = '/api/v1/miniprogram/families/spc_family/domains/activities';
async function activityRequest(suffix, method='GET', body) {
  const calls=[];
  const response=await handleMiniNewDomainBff(new Request('https://homemew.test'+activityPath+suffix,{
    method,headers:{authorization:'Bearer user-token-1234567890','content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  }),{LIFESPACE_CORE:{async fetch(req){
    calls.push({path:new URL(req.url).pathname,method:req.method,body:await req.json(),
      token:req.headers.get('authorization')});
    return Response.json({data:{items:[],nextCursor:null}});
  }}});
  return {response,calls};
}
test('Activity status is explicit and composable; released Mini period remains date-based', async()=>{
  for(const status of ['planned','active','completed','cancelled']){
    const {response,calls}=await activityRequest('?status='+status+'&personId=per_example&cursor=next');
    assert.equal(response.status,200);
    assert.equal(calls[0].path,'/api/v1/spaces/spc_family/models/activity/records/query');
    assert.deepEqual(calls[0].body.filter,{and:[
      {field:'status',op:'eq',value:status},{field:'attendeePersonIds',op:'contains',value:'per_example'},
    ]});
    assert.equal(calls[0].body.page.cursor,'next');
  }
  const legacy=await activityRequest('?period=current&today=2026-11-14');
  assert.equal(legacy.response.status,200);
  assert.equal(legacy.calls[0].body.filter.and[0].or[0].field,'startDate');
  for(const suffix of ['?status=paused','?status=active&period=current&today=2026-11-14']){
    const invalid=await activityRequest(suffix);assert.equal(invalid.response.status,400);assert.equal(invalid.calls.length,0);
  }
});
test('Activity Action uses explicit product route, current bearer and version only', async()=>{
  for(const action of ['start','complete','cancel','reopen','reset']){
    const {response,calls}=await activityRequest('/rec_example/actions/'+action,'POST',{version:5});
    assert.equal(response.status,200);
    assert.deepEqual(calls,[{path:'/api/v1/spaces/spc_family/models/activity/records/rec_example/actions/'+action,
      method:'POST',body:{version:5},token:'Bearer user-token-1234567890'}]);
  }
  for(const [suffix,method,body] of [
    ['/rec_example/actions/pause','POST',{version:5}],
    ['/rec_example/actions/complete','POST',{version:0}],
    ['/rec_example/actions/complete','POST',{version:5,status:'completed'}],
    ['/rec_example','PATCH',{version:5,status:'completed'}],
    ['','POST',{name:'Activity',status:'planned'}],
  ]){
    const invalid=await activityRequest(suffix,method,body);
    assert.equal(invalid.response.status,400);assert.equal(invalid.calls.length,0);
  }
});
