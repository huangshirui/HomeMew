import type { HealthMetric, HealthEvent, HealthObservation } from './health-domain';

export function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const timestamp = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}
export function dateRange(date: string) {
  if (!validDate(date)) throw Error('请选择有效日期');
  const end = new Date(date + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + 1);
  return { kind: 'date' as const, start: date, endExclusive: end.toISOString().slice(0, 10) };
}
export function measurementPayload(personId: string, metric: HealthMetric, date: string, raw: string, unit: string, notes: string) {
  if (!/^per_[A-Za-z0-9_-]+$/.test(personId) || !validDate(date) || !raw.trim()) throw Error('请填写成员、有效日期与测量值');
  const numeric = Number(raw);
  if (metric.valueType === 'number' && !Number.isFinite(numeric)) throw Error('请输入有效数值');
  if (metric.valueType === 'boolean' && !['true','false'].includes(raw)) throw Error('请选择是或否');
  if (!['number','text','boolean'].includes(metric.valueType)) throw Error('不支持的指标类型');
  return { subjectPersonId: personId, metricId: metric.id, observedDate: date,
    valueNumber: metric.valueType === 'number' ? numeric : null,
    valueText: metric.valueType === 'text' ? raw.trim() : null,
    valueBoolean: metric.valueType === 'boolean' ? raw === 'true' : null,
    unit: unit.trim() || null, notes: notes.trim() || null };
}
export function eventPayload(personId: string, summary: string, eventType: string, date: string, location: string, description: string, existing?: HealthEvent) {
  if (!/^per_[A-Za-z0-9_-]+$/.test(personId) || !summary.trim() || !eventType) throw Error('请填写成员、标题和类型');
  if (existing && existing.subjectPersonId !== personId) throw Error('成员不匹配');
  const oldWhen = existing?.when;
  // Editing a date-only range preserves its original duration. Existing instant
  // records are edited without changing time or losing offset/precision.
  let when: HealthEvent['when'];
  if (oldWhen?.kind === 'instant') when = oldWhen;
  else if (oldWhen?.kind === 'date' && oldWhen.start === date) when = oldWhen;
  else {
    when = dateRange(date);
    if (oldWhen?.kind === 'date' && validDate(oldWhen.start) && validDate(oldWhen.endExclusive)) {
      const duration = Date.parse(oldWhen.endExclusive) - Date.parse(oldWhen.start);
      if (duration > 0) when.endExclusive = new Date(Date.parse(date) + duration).toISOString().slice(0, 10);
    }
  }
  return { subjectPersonId: personId, summary: summary.trim(), eventType, when,
    ...(existing ? {} : { status: 'active' }),
    location: location.trim() ? existing?.location?.name === location.trim() ? existing.location : { name: location.trim() } : null,
    description: description.trim() || null };
}

export function growthMetrics(metrics: HealthMetric[], complete: boolean) {
  const find = (name:string,unit:string) => {
    const matches=metrics.filter(m=>m.name===name);
    return complete && matches.length===1 && matches[0].valueType==='number' && matches[0].defaultUnit===unit ? matches[0] : undefined;
  };
  return {height:find('身高','cm'),weight:find('体重','kg')};
}
export function derivedBmi(rows:HealthObservation[],heightId:string,weightId:string,personId:string, incompleteOldestDate?:string) {
  // Same subject and date only. Ambiguous repeated measurements are not paired.
  const byDate=new Map<string,HealthObservation[]>();
  for(const row of rows) {
    if(row.observedDate===incompleteOldestDate||row.subjectPersonId!==personId||!validDate(row.observedDate)||![heightId,weightId].includes(row.metricId))continue;
    const list=byDate.get(row.observedDate)??[];list.push(row);byDate.set(row.observedDate,list);
  }
  for(const date of [...byDate.keys()].sort().reverse()) {
    const entries=byDate.get(date)!;
    const h=entries.filter(r=>r.metricId===heightId),w=entries.filter(r=>r.metricId===weightId);
    if(h.length!==1||w.length!==1||h[0].unit!=='cm'||w[0].unit!=='kg')continue;
    const height=h[0].valueNumber,weight=w[0].valueNumber;
    if(typeof height!=='number'||typeof weight!=='number'||!Number.isFinite(height)||!Number.isFinite(weight)||height<=0||weight<=0)continue;
    const bmi=weight/((height/100)**2);
    if(Number.isFinite(bmi))return {date,value:Math.round(bmi*10)/10};
  }
  return null;
}
