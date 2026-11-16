import { apiRequest } from '../lib/api-client';
import { queryModelRecords, type CanonicalQuery } from '../lib/canonical-query';

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
export function healthQuery(model: HealthModel, personId: string, cursor: string | null, metricId?: string): CanonicalQuery {
  if (model !== 'health_metric' && !/^per_[A-Za-z0-9_-]+$/.test(personId)) throw Error('请选择有效家庭成员');
  const subject = { field: 'subjectPersonId', op: 'contains' as const, value: personId };
  return {
    ...(model === 'health_metric' ? {} : { filter: model === 'health_observation' && metricId
      ? { and: [subject, { field: 'metricId', op: 'contains' as const, value: metricId }] } : subject }),
    sort: [{ field: model === 'health_observation' ? 'observedDate' : 'updatedAt', direction: 'desc' }],
    page: { limit: 40, cursor },
  };
}
export function readHealthPage<T extends HealthRecord>(spaceId: string, model: HealthModel, personId: string, cursor: string | null, metricId?: string) {
  spaceRoot(spaceId);
  return queryModelRecords<T>(spaceId, model, healthQuery(model, personId, cursor, metricId));
}
export async function readHealthSchema(spaceId: string, model: HealthModel) {
  const schema = await apiRequest<HealthSchema>(spaceRoot(spaceId) + '/_discovery/models/' + model);
  if (schema.key !== model || !Array.isArray(schema.fields)) throw Error('健康模型契约不可用');
  return schema;
}
export function saveHealthRecord(spaceId: string, model: HealthModel, payload: Record<string, unknown>, existing?: HealthRecord) {
  return apiRequest<HealthRecord>(healthRecordUrl(spaceId, model, existing?.id), {
    method: existing ? 'PATCH' : 'POST',
    body: JSON.stringify({ ...payload, ...(existing ? { version: existing.version } : {}) }),
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
