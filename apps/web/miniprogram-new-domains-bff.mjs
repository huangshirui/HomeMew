/**
 * Bounded product contract for newly shipped HomeMew Mini domains.
 * The Mini never supplies a LifeSpace model key, query AST or upstream path.
 * All domain truth, versions, actions and policy checks stay in LifeSpace.
 */
import { errorResponse, forwardLifeSpace } from './miniprogram-upstream.mjs';
import { eventLocationToLifeSpace } from './event-location.mjs';

const PREFIX = '/api/v1/miniprogram/families';
const ID = /^spc_[a-zA-Z0-9_-]+$/u;
const RECORD = /^rec_[a-zA-Z0-9_-]+$/u;
const EDGE = /^[a-z]{2,8}_[a-zA-Z0-9_-]+$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const KINDS = Object.freeze({
  activities: { model: 'activity', fields: ['name','description','attendeePersonIds','startDate','endDate','presentation','version'] },
  goals: { model: 'goal', fields: ['name','description','subjectPersonIds','startDate','targetDate','presentation','version'] },
  habits: { model: 'habit', fields: ['name','description','subjectPersonId','intervalDays','presentation','version'] },
  anniversaries: { model: 'anniversary', fields: ['name','description','month','day','year','personIds','presentation','version'] },
  'football-matches': { model: 'football_match', fields: ['matchDate','matchType','competitionActivityId','representativeTeamId','opponentTeamId','representativeTeamScore','opponentTeamScore','playerPersonIds','notes','version'] },
  'football-performances': { model: 'football_performance', fields: ['matchId','playerPersonId','performanceType','goalMethod','shotOutcome','minutesPlayed','position','entryMode','notes','version'] },
  'football-teams': { model: 'person_group', fields: ['name','description','memberPersonIds','presentation','version'] },
});
const TARGETS = new Set(['task','event','day_record','activity','goal','habit','anniversary','wish']);
const ACTIONS = new Set(['pause','resume','achieve','abandon','end','reopen','check-in']);
const PARAMS = new Set(['limit','cursor','q','status','period','today','personId','year','matchType','matchId','playerPersonId','representativeTeamId','opponentTeamId','competitionActivityId']);
const safeDecode = (raw, pattern) => {
  try { const decoded = decodeURIComponent(raw); return decoded.length <= 200 && pattern.test(decoded) ? decoded : null; }
  catch { return null; }
};
const col = (space, model) => `/api/v1/spaces/${encodeURIComponent(space)}/models/${model}/records`;
const recordRef = (model, recordId) => ({ kind: 'record', modelKey: model, recordId });

export function matchMiniNewDomainRoute(pathname) {
  const p = new RegExp('^' + PREFIX + '/([^/]+)/football-people(?:/([^/]+))?$', 'u').exec(pathname);
  if (p) {
    const familyId = safeDecode(p[1], ID);
    const personId = p[2] ? safeDecode(p[2], /^per_[a-zA-Z0-9_-]+$/u) : null;
    return familyId && (!p[2] || personId) ? { familyId, personId, footballPeople: true } : null;
  }
  const schema = new RegExp('^' + PREFIX + '/([^/]+)/football-performance-schema$', 'u').exec(pathname);
  if (schema) {
    const familyId = safeDecode(schema[1], ID);
    return familyId ? { familyId, schema: true } : null;
  }
  const people = new RegExp('^' + PREFIX + '/([^/]+)/domain-people$', 'u').exec(pathname);
  if (people) {
    const familyId = safeDecode(people[1], ID);
    return familyId ? { familyId, people: true } : null;
  }
  const relation = new RegExp('^' + PREFIX + '/([^/]+)/containers/(activities|goals|habits)/([^/]+)/(relations|candidates|quick-create)(?:/([^/]+))?$', 'u').exec(pathname);
  if (relation) {
    const space = safeDecode(relation[1], ID), recordId = safeDecode(relation[3], RECORD);
    const relationId = relation[5] ? safeDecode(relation[5], EDGE) : null;
    return space && recordId && (!relation[5] || relationId)
      ? { familyId: space, kind: relation[2], recordId, relationId, feature: relation[4], relation: true } : null;
  }
  const match = new RegExp('^' + PREFIX + '/([^/]+)/domains/(activities|goals|habits|anniversaries|football-matches|football-performances|football-teams)(?:/([^/]+))?(?:/(actions/([^/]+)|check-ins))?$', 'u').exec(pathname);
  if (!match) return null;
  const familyId = safeDecode(match[1], ID);
  const recordId = match[3] ? safeDecode(match[3], RECORD) : null;
  if (!familyId || (match[3] && !recordId) || (match[4] && !recordId)) return null;
  return { familyId, kind: match[2], recordId, action: match[5] || null, history: match[4] === 'check-ins' };
}

function derived(request, method, body) {
  const headers = new Headers();
  for (const name of ['authorization','x-request-id','accept']) {
    const v = request.headers.get(name); if (v) headers.set(name, v);
  }
  if (body !== undefined) headers.set('content-type','application/json');
  return new Request(request.url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const forward = (request, env, path, method = request.method, body) =>
  forwardLifeSpace(derived(request, method, body), env, { target: 'core', upstreamPath: path });
const bad = (message = '请求参数不正确') => errorResponse(400, 'INVALID_PRODUCT_REQUEST', message);
const f = (field, op, value) => ({ field, op, value });
const combine = clauses => clauses.length === 1 ? clauses[0] : { and: clauses };
function queryOptions(url, kind) {
  const p = url.searchParams;
  if ([...p.keys()].some(key => !PARAMS.has(key))) return null;
  const limit = p.has('limit') ? Number(p.get('limit')) : 40;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null;
  const cursor = p.get('cursor') || null;
  if (cursor && cursor.length > 2048) return null;
  const period = p.get('period') || '';
  const status = p.get('status') || '';
  const year = p.get('year') || '';
  const today = p.get('today') || '';
  const q = p.get('q')?.trim() || '';
  if (q.length > 150 || (today && !DAY.test(today)) || (year && !/^\d{4}$/.test(year))) return null;
  const clauses = [];
  let sort = [{ field: 'createdAt', direction: 'desc' }];
  if (kind === 'activities') {
    if (period && !['current','upcoming','past','all'].includes(period)) return null;
    if (period && period !== 'all' && !DAY.test(today)) return null;
    if (period === 'current') clauses.push({ and: [
      { or: [{ field:'startDate', op:'isNull' }, f('startDate','lte',today)] },
      { or: [{ field:'endDate', op:'isNull' }, f('endDate','gte',today)] },
    ] });
    if (period === 'upcoming') clauses.push(f('startDate','gt',today));
    if (period === 'past') clauses.push(f('endDate','lt',today));
    if (p.get('personId')) clauses.push(f('attendeePersonIds','contains',p.get('personId')));
  } else if (kind === 'goals' || kind === 'habits') {
    if (status && !['active','paused','achieved','abandoned','ended'].includes(status)) return null;
    if (status) clauses.push(f('status','eq',status));
    sort = kind === 'goals' ? [{ field:'targetDate', direction:'asc' }] : [{ field:'name', direction:'asc' }];
  } else if (kind === 'anniversaries') {
    sort = [{ field:'month', direction:'asc' }, { field:'day', direction:'asc' }];
  } else if (kind === 'football-matches') {
    sort = [{ field:'matchDate', direction:'desc' }];
    if (year) { clauses.push(f('matchDate','gte',year+'-01-01')); clauses.push(f('matchDate','lt',String(Number(year)+1)+'-01-01')); }
    for (const key of ['matchType','representativeTeamId','opponentTeamId','competitionActivityId','playerPersonId']) {
      const value = p.get(key);
      if (value) clauses.push(f(key === 'playerPersonId' ? 'playerPersonIds' : key, key === 'matchType' ? 'eq' : 'contains', value));
    }
  } else if (kind === 'football-performances') {
    const matchId = p.get('matchId');
    if (matchId) { if (!RECORD.test(matchId)) return null; clauses.push(f('matchId','contains',matchId)); }
    if (p.get('playerPersonId')) clauses.push(f('playerPersonId','contains',p.get('playerPersonId')));
  } else if (kind === 'football-teams') {
    sort = [{ field:'name', direction:'asc' }];
  }
  return {
    ...(q ? { search: { text: q } } : {}),
    ...(clauses.length ? { filter: combine(clauses) } : {}),
    sort, page: { limit, ...(cursor ? { cursor } : {}) },
  };
}
async function writePayload(request, kind, isUpdate) {
  try {
    const data = await request.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (Object.keys(data).some(key => !KINDS[kind].fields.includes(key))) return null;
    if (isUpdate && (!Number.isInteger(data.version) || data.version < 1)) return null;
    if (!isUpdate && 'version' in data) return null;
    return data;
  } catch { return null; }
}
async function membersForLinkedCreate(request,env,familyId) {
  // quick-create itself is a POST; member lookup must use the Core GET contract.
  const response = await forward(request,env,`/api/v1/spaces/${encodeURIComponent(familyId)}/members`,'GET');
  if (!response.ok) return { response };
  try {
    const envelope = await response.json();
    if (!Array.isArray(envelope?.data)) return { response: errorResponse(502,'INVALID_UPSTREAM_RESPONSE','家庭成员数据无效') };
    return { members: envelope.data };
  } catch { return { response: errorResponse(502,'INVALID_UPSTREAM_RESPONSE','家庭成员数据无效') }; }
}
async function quickCreate(request,env,route,url) {
  if (request.method !== 'POST' || url.search) return bad();
  let value;
  try { value = await request.json(); } catch { return bad(); }
  if (!value || !['task','event','countdown'].includes(value.targetType) ||
      Object.keys(value).some(key=>!['targetType','draft'].includes(key)) ||
      !value.draft || typeof value.draft !== 'object' || Array.isArray(value.draft)) return bad();
  const d=value.draft;
  let model, data;
  if (value.targetType === 'countdown') {
    if (Object.keys(d).some(key=>!['name','anchorDate'].includes(key)) ||
      typeof d.name !== 'string' || !d.name.trim() || !DAY.test(d.anchorDate||'')) return bad('倒计时名称和日期必填');
    model='day_record'; data={name:d.name.trim(),kind:'countdown',anchorDate:d.anchorDate};
  } else {
    const memberResult=await membersForLinkedCreate(request,env,route.familyId);
    if (memberResult.response) return memberResult.response;
    const toPeople=(userIds) => {
      if (!Array.isArray(userIds) || userIds.some(x=>typeof x!=='string')) return null;
      const ids=userIds.map(userId=>memberResult.members.find(m=>m.userId===userId)?.personId);
      return ids.some(x=>!x) ? null : [...new Set(ids)];
    };
    if (value.targetType==='task') {
      if (Object.keys(d).some(key=>!['name','description','dueDate','assigneeIds','presentation'].includes(key)) ||
        typeof d.name !== 'string' || !d.name.trim()) return bad();
      const people=toPeople(d.assigneeIds??[]);
      if (!people) return bad('待办负责人不在家庭中');
      model='task'; data={name:d.name.trim(),description:d.description??null,dueDate:d.dueDate??null,
        assigneePersonIds:people,...(d.presentation?{presentation:d.presentation}:{})};
    } else {
      if (Object.keys(d).some(key=>!['summary','description','location','attendeeIds','presentation',
          'isAllDay','startDate','endDateExclusive','startAt','endAt','startTimezone','endTimezone','locationDetail'].includes(key)) ||
        typeof d.summary !== 'string' || !d.summary.trim()) return bad();
      const people=toPeople(d.attendeeIds??[]);
      if (!people) return bad('日程参与人不在家庭中');
      let when;
      if (d.isAllDay===true && DAY.test(d.startDate||'') && DAY.test(d.endDateExclusive||'') && d.endDateExclusive>d.startDate)
        when={kind:'date',start:d.startDate,endExclusive:d.endDateExclusive};
      else if (d.isAllDay===false && typeof d.startAt==='string' && typeof d.endAt==='string'
        && Number.isFinite(Date.parse(d.startAt)) && Date.parse(d.endAt)>Date.parse(d.startAt))
        when={kind:'instant',start:new Date(d.startAt).toISOString(),endExclusive:new Date(d.endAt).toISOString()};
      if (!when) return bad('日程日期范围无效');
      // Mini Event keeps its legacy string label. The optional locationDetail is
      // a deliberate WGS84 selection; never infer coordinates from free text.
      if (d.location != null && typeof d.location !== 'string') return bad('日程地点名称无效');
      let selectedLocation = d.location ?? null;
      if (Object.hasOwn(d, 'locationDetail') && d.locationDetail !== null) {
        const detail = d.locationDetail;
        if (!detail || typeof detail !== 'object' || Array.isArray(detail) ||
          typeof detail.name !== 'string' ||
          detail.name.trim() !== d.location?.trim()) return bad('所选地点与名称不一致');
        selectedLocation = detail;
      }
      let location;
      try { location = eventLocationToLifeSpace(selectedLocation); }
      catch { return errorResponse(422, 'VALIDATION_ERROR', '日程地点不符合当前 LifeSpace Location 版本'); }
      model='event';data={summary:d.summary.trim(),description:d.description??null,location,
        attendeePersonIds:people,when,...(d.presentation?{presentation:d.presentation}:{})};
    }
  }
  return forward(request,env,`/api/v1/spaces/${encodeURIComponent(route.familyId)}/models/batch`,'POST',{
    atomicConsistency:true,operations:[
      {operation:'create',modelKey:model,clientRef:'child',data},
      {operation:'relation_create',predicate:'relates_to',
        source:recordRef(KINDS[route.kind].model,route.recordId),
        target:{kind:'record',modelKey:model,clientRef:'child'}},
    ],
  });
}
async function candidates(request,env,route,url) {
  if (request.method!=='GET') return bad();
  const p=url.searchParams;
  if ([...p.keys()].some(k=>!['model','q','cursor'].includes(k))) return bad();
  const model=p.get('model'), q=p.get('q')?.trim()||'', cursor=p.get('cursor');
  if (!TARGETS.has(model)||q.length<2||q.length>120||(cursor&&cursor.length>2048)) return bad('请输入至少 2 个字搜索关联内容');
  return forward(request,env,col(route.familyId,model)+'/query','POST',{
    search:{text:q},page:{limit:30,...(cursor?{cursor}:{})},
  });
}
async function relations(request, env, route, url) {
  const { familyId, recordId, kind, relationId } = route;
  if (route.feature==='quick-create') return quickCreate(request,env,route,url);
  if (route.feature==='candidates') return candidates(request,env,route,url);
  const base = `/api/v1/spaces/${encodeURIComponent(familyId)}/semantic-relations`;
  const owner = KINDS[kind].model;
  if (relationId) {
    if (request.method !== 'DELETE' || url.search) return bad();
    return forward(request, env, base + '/' + encodeURIComponent(relationId));
  }
  if (request.method === 'GET') {
    const p = url.searchParams;
    if ([...p.keys()].some(key => !['direction','cursor','limit'].includes(key))) return bad();
    const direction = p.get('direction') || 'outgoing';
    if (!['outgoing','incoming'].includes(direction)) return bad();
    const limit = Number(p.get('limit') || 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return bad();
    const cursor = p.get('cursor');
    if (cursor && cursor.length > 2048) return bad();
    const query = new URLSearchParams({
      [direction === 'outgoing' ? 'sourceModelKey' : 'targetModelKey']: owner,
      [direction === 'outgoing' ? 'sourceRecordId' : 'targetRecordId']: recordId,
      predicate: 'relates_to', hydrate: direction === 'outgoing' ? 'target' : 'source',
      limit: String(limit),
    });
    if (cursor) query.set('cursor',cursor);
    return forward(request, env, base + '?' + query.toString());
  }
  if (request.method === 'POST' && !url.search) {
    let payload;
    try { payload = await request.json(); } catch { return bad(); }
    if (!payload || !TARGETS.has(payload.targetModel) || !RECORD.test(payload.targetId || '') ||
      Object.keys(payload).some(key => !['targetModel','targetId'].includes(key))) return bad();
    return forward(request, env, base, 'POST', {
      source: recordRef(owner,recordId), predicate:'relates_to', target: recordRef(payload.targetModel,payload.targetId),
    });
  }
  return errorResponse(405,'METHOD_NOT_ALLOWED','不支持该关联操作');
}
export async function handleMiniNewDomainBff(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX + '/')) return null;
  const route = matchMiniNewDomainRoute(url.pathname);
  if (!route) return null; // Other existing bounded Mini routes handle their paths.
  if(route.schema) {
    if(request.method!=='GET'||url.search)return bad();
    return forward(request,env,`/api/v1/spaces/${encodeURIComponent(route.familyId)}/_discovery/models/football_performance`);
  }
  if(route.footballPeople) {
    const path=`/api/v1/spaces/${encodeURIComponent(route.familyId)}/people`+
      (route.personId?'/'+encodeURIComponent(route.personId):'');
    if(request.method==='GET'){
      const p=url.searchParams;
      if(route.personId){if(url.search)return bad();return forward(request,env,path);}
      if([...p.keys()].some(x=>!['q','limit','cursor'].includes(x)))return bad();
      const limit=Number(p.get('limit')||50);
      if(!Number.isInteger(limit)||limit<1||limit>50)return bad();
      const q=p.get('q')||'',cursor=p.get('cursor')||'';
      if(q.length>120||cursor.length>2048)return bad();
      const params=new URLSearchParams({limit:String(limit)});
      if(q)params.set('q',q);if(cursor)params.set('cursor',cursor);
      return forward(request,env,path+'?'+params.toString());
    }
    if(url.search)return bad();
    if(['POST','PATCH','DELETE'].includes(request.method)){
      if((request.method==='POST'&&route.personId)||
        ((request.method==='PATCH'||request.method==='DELETE')&&!route.personId))return bad();
      let data;try{data=await request.json();}catch{return bad();}
      if(!data||typeof data!=='object'||Array.isArray(data))return bad();
      if(request.method==='DELETE'){
        if(Object.keys(data).join()!=='version'||!Number.isInteger(data.version))return bad();
      }else{
        if(Object.keys(data).some(key=>!['displayName','version'].includes(key))||
          typeof data.displayName!=='string'||!data.displayName.trim())return bad();
        if(request.method==='PATCH'&&!Number.isInteger(data.version))return bad();
        if(request.method==='POST'&&data.version!==undefined)return bad();
      }
      return forward(request,env,path,request.method,data);
    }
    return errorResponse(405,'METHOD_NOT_ALLOWED','不支持该操作');
  }
  if (route.people) {
    if (request.method !== 'GET' || url.search) return bad();
    return forward(request,env,`/api/v1/spaces/${encodeURIComponent(route.familyId)}/members`);
  }
  if (route.relation) return relations(request,env,route,url);
  const { kind, familyId, recordId, action, history } = route;
  const collection = col(familyId,KINDS[kind].model);
  const path = recordId ? collection + '/' + encodeURIComponent(recordId) : collection;
  if (history) {
    if (kind !== 'habits' || request.method !== 'GET') return bad();
    const p = url.searchParams;
    if ([...p.keys()].some(key => !['cursor','limit'].includes(key))) return bad();
    const limit = Number(p.get('limit') || 40);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return bad();
    const qs = new URLSearchParams({limit:String(limit)});
    if (p.get('cursor')) qs.set('cursor',p.get('cursor'));
    return forward(request,env,path+'/check-ins?'+qs.toString());
  }
  if (action) {
    if (!ACTIONS.has(action) || !['goals','habits'].includes(kind) || request.method !== 'POST' || url.search) return bad();
    if (action === 'check-in' && kind !== 'habits') return bad();
    let body;
    try { body = await request.json(); } catch { return bad(); }
    if (!body || Object.keys(body).join() !== 'version' || !Number.isInteger(body.version) || body.version < 1) return bad();
    return forward(request,env,path+'/actions/'+action,'POST',body);
  }
  if (request.method === 'GET' && !recordId) {
    const query = queryOptions(url, kind);
    return query ? forward(request,env,collection+'/query','POST',query) : bad('列表筛选参数无效');
  }
  if (url.search) return bad('该操作不支持筛选参数');
  if (recordId && request.method === 'GET') return forward(request,env,path);
  if (!recordId && request.method === 'POST') {
    const data = await writePayload(request,kind,false);
    return data ? forward(request,env,path,'POST',data) : bad('创建字段不符合产品契约');
  }
  if (recordId && request.method === 'PATCH') {
    const data = await writePayload(request,kind,true);
    return data ? forward(request,env,path,'PATCH',data) : bad('编辑字段或版本号无效');
  }
  if (recordId && request.method === 'DELETE') {
    let body;
    try { body = await request.json(); } catch { return bad(); }
    if (!body || Object.keys(body).join() !== 'version' || !Number.isInteger(body.version)) return bad();
    return forward(request,env,path,'DELETE',body);
  }
  return errorResponse(405,'METHOD_NOT_ALLOWED','不支持该操作');
}
