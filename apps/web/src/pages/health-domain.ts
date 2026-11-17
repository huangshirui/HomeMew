import { apiRequest } from '../lib/api-client';
import { queryModelRecords, type CanonicalQuery, type CanonicalQueryPage } from '../lib/canonical-query';

export type HealthModel = 'health_metric' | 'health_observation' | 'health_event' | 'health_document';
export type HealthRecord = { id: string; version: number; subjectPersonId?: string; updatedAt?: string };
export type HealthMetric = HealthRecord & { name: string; valueType: 'number' | 'text' | 'boolean'; defaultUnit?: string | null };
export type HealthObservation = HealthRecord & { metricId: string; observedDate: string; valueNumber?: number | null; valueText?: string | null; valueBoolean?: boolean | null; unit?: string | null; notes?: string | null };
export type HealthEvent = HealthRecord & { summary: string; eventType: string; when?: { kind: 'date' | 'instant'; start: string; endExclusive: string }; status?: string; description?: string | null; location?: { name: string; address?: string; coordinates?: unknown } | null };
export type HealthDocument = HealthRecord & { title: string; documentType: string; issuedDate?: string | null; issuerName?: string | null; notes?: string | null; artifactRef?: string; eventId?: string | null };
export type HealthSchema = { key: string; fields: Array<{ key: string; values?: string[] }> };

function spaceRoot(spaceId: string) {
  if (!/^spc_[A-Za-z0-9_-]+$/.test(spaceId)) throw Error('家庭空间无效');
  return '/api/lifespace/core/v1/spaces/' + encodeURIComponent(spaceId);
}
export function healthRecordUrl(spaceId: string, model: HealthModel, id?: string) {
  return spaceRoot(spaceId) + '/models/' + model + '/records' + (id ? '/' + encodeURIComponent(id) : '');
}
export function healthQuery(model: HealthModel, personId: string, cursor: string | null, metricId?: string, timezone = 'UTC'): CanonicalQuery {
  if (model !== 'health_metric' && !/^per_[A-Za-z0-9_-]+$/.test(personId)) throw Error('请选择有效家庭成员');
  const subject = { field: 'subjectPersonId', op: 'contains' as const, value: personId };
  return {
    ...(model === 'health_metric' ? {} : { filter: model === 'health_observation' && metricId
      ? { and: [subject, { field: 'metricId', op: 'contains' as const, value: metricId }] } : subject }),
    sort: [{ field: model === 'health_observation' ? 'observedDate' : model === 'health_event' ? 'when' : model === 'health_document' ? 'issuedDate' : 'name', direction: model === 'health_metric' ? 'asc' : 'desc' }],
    ...(model === 'health_event' ? { context: { viewingTimezone: timezone } } : {}),
    page: { limit: 40, cursor },
  };
}
export function readHealthPage<T extends HealthRecord>(spaceId: string, model: HealthModel, personId: string, cursor: string | null, metricId?: string, timezone = 'UTC') {
  spaceRoot(spaceId);
  return queryModelRecords<T>(spaceId, model, healthQuery(model, personId, cursor, metricId, timezone));
}
export async function readHealthSchema(spaceId: string, model: HealthModel) {
  const schema = await apiRequest<HealthSchema>(spaceRoot(spaceId) + '/_discovery/models/' + model);
  if (schema.key !== model || !Array.isArray(schema.fields)) throw Error('健康模型契约不可用');
  return schema;
}
export function saveHealthRecord(spaceId: string, model: HealthModel, payload: Record<string, unknown>, existing?: HealthRecord) {
  const fields = { ...payload };
  if (existing) {
    if ('subjectPersonId' in fields && fields.subjectPersonId !== existing.subjectPersonId) throw Error('成员不可变更');
    delete fields.subjectPersonId;
    if (model === 'health_document') delete fields.artifactRef;
  }
  return apiRequest<HealthRecord>(healthRecordUrl(spaceId, model, existing?.id), {
    method: existing ? 'PATCH' : 'POST',
    body: JSON.stringify({ ...fields, ...(existing ? { version: existing.version } : {}) }),
  });
}
export function deleteHealthRecord(spaceId: string, model: HealthModel, existing: HealthRecord) {
  return apiRequest(healthRecordUrl(spaceId, model, existing.id), { method: 'DELETE', body: JSON.stringify({ version: existing.version }) });
}
export function observationValue(record: HealthObservation) {
  if (typeof record.valueNumber === 'number') return String(record.valueNumber);
  if (typeof record.valueBoolean === 'boolean') return record.valueBoolean ? '是' : '否';
  return record.valueText ?? '—';
}
export { measurementPayload, validDate, dateRange, eventPayload } from './health-values';
export async function saveHealthBatch(spaceId: string, payloads: Record<string, unknown>[]) {
  if (!payloads.length || payloads.length > 2) throw Error('请选择一到两条测量记录');
  return apiRequest(spaceRoot(spaceId) + '/models/batch', {
    method: 'POST', body: JSON.stringify({ atomicConsistency: true,
      operations: payloads.map(data => ({ operation: 'create', modelKey: 'health_observation', data })) }),
  });
}
export function familyToday(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year','month','day'].map(key => parts.find(p => p.type === key)?.value).join('-');
}

export async function checkMetricName(spaceId: string, name: string, existingId?: string) {
  // Name is searchable, not filterable. Page all matching candidates within
  // a bounded budget; never claim uniqueness if search is incomplete.
  let cursor: string | null = null;
  for (let i = 0; i < 4; i++) {
    const page: CanonicalQueryPage<HealthMetric> = await queryModelRecords<HealthMetric>(spaceId, 'health_metric', {search:{text:name},page:{limit:40,cursor}});
    if (page.items.some(m => m.id !== existingId && m.name.trim().normalize('NFKC').toLowerCase() === name.trim().normalize('NFKC').toLowerCase())) throw Error('已存在同名指标，请复用。');
    cursor = page.nextCursor;
    if (!cursor) return;
  }
  throw Error('同名指标检查未完成，请缩小搜索范围。');
}
export type RelatedHealthTarget = { id: string; name?: string; summary?: string; dueDate?: string | null; when?: HealthEvent['when'] };
export type HealthRelation = { id: string; target: {modelKey:string;recordId:string}; targetLabel?: string; targetRecord?: RelatedHealthTarget };
export function searchHealthTargets(spaceId:string, model:'event'|'task', text:string, cursor:string|null) {
  return queryModelRecords<RelatedHealthTarget>(spaceId,model,{search:{text},page:{limit:30,cursor}});
}
export function listHealthRelations(spaceId:string, eventId:string, cursor:string|null) {
  const params = new URLSearchParams({sourceModelKey:'health_event',sourceRecordId:eventId,predicate:'relates_to',hydrate:'target',limit:'30'});
  if(cursor)params.set('cursor',cursor);
  return apiRequest<{items:HealthRelation[];nextCursor:string|null}>(spaceRoot(spaceId)+'/semantic-relations?'+params);
}
export function linkHealthEvent(spaceId:string,eventId:string,model:'event'|'task',targetId:string) {
  return apiRequest(spaceRoot(spaceId)+'/semantic-relations',{method:'POST',body:JSON.stringify({predicate:'relates_to',source:{kind:'record',modelKey:'health_event',recordId:eventId},target:{kind:'record',modelKey:model,recordId:targetId}})});
}
export function unlinkHealthEvent(spaceId:string,relationId:string) {
  return apiRequest(spaceRoot(spaceId)+'/semantic-relations/'+encodeURIComponent(relationId),{method:'DELETE'});
}
export async function verifyDocumentEvent(spaceId:string,personId:string,eventId:string) {
  if(!eventId)return;
  const event=await apiRequest<HealthEvent>(healthRecordUrl(spaceId,'health_event',eventId));
  if(event.id!==eventId||event.subjectPersonId!==personId)throw Error('只能关联同一成员的健康事件');
}

export function readGrowthObservations(spaceId:string,personId:string,heightId:string,weightId:string) {
  if(!/^per_[A-Za-z0-9_-]+$/.test(personId)||heightId===weightId)throw Error('生长指标无效');
  return queryModelRecords<HealthObservation>(spaceId,'health_observation',{
    filter:{and:[{field:'subjectPersonId',op:'contains',value:personId},
      {or:[{field:'metricId',op:'contains',value:heightId},{field:'metricId',op:'contains',value:weightId}]}]},
    sort:[{field:'observedDate',direction:'desc'}],page:{limit:40}
  });
}
