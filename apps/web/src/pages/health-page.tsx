import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PageHeader } from '../components/ui/page-header';
import { useHousehold } from '../components/household-provider';
import { ModalScrollLock } from '../components/ui/modal-behavior';
import { ApiError } from '../lib/api-client';
import { deleteHealthRecord, eventPayload, familyToday, measurementPayload, observationValue, readHealthPage, readHealthSchema, saveHealthBatch, saveHealthRecord, type HealthDocument, type HealthEvent, type HealthMetric, type HealthModel, type HealthObservation, type HealthRecord } from './health-domain';

const tabs = ['概览', '健康指标', '健康事件', '健康档案'] as const;
type Tab = typeof tabs[number];
const control = 'min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm';
const button = 'min-h-10 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-50';
const primary = 'min-h-10 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const panel = 'rounded-2xl bg-white p-4 ring-1 ring-stone-200/80';
function message(error: unknown) {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return '当前健康模型未开放或没有访问权限。';
  if (error instanceof ApiError && error.status === 409) return '记录已更新，请刷新后再操作。';
  return '操作未完成，请重试或检查当前权限。';
}
function useHealthList<T extends HealthRecord>(spaceId: string, model: HealthModel, personId: string, metricId?: string) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const request = async (next: string | null, append: boolean) => {
    const id = ++generation.current;
    setLoading(true); setError('');
    if (!append) { setItems([]); setCursor(null); }
    try {
      const result = await readHealthPage<T>(spaceId, model, personId, next, metricId);
      if (id !== generation.current) return;
      // Defense in depth: the server query is still authoritative. Never display a
      // mis-scoped response under the selected person if the response contract drifts.
      if (model !== 'health_metric' && result.items.some(item => item.subjectPersonId !== personId)) throw Error('成员记录范围不匹配');
      setItems(previous => append ? [...previous, ...result.items.filter(item => !previous.some(p => p.id === item.id))] : result.items);
      setCursor(result.nextCursor);
    } catch (cause) {
      if (id === generation.current) setError(message(cause));
    } finally {
      if (id === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    void request(null, false);
    return () => { generation.current += 1; };
    // The list is remounted for a new family, subject, model or metric.
  }, [spaceId, model, personId, metricId]);
  return { items, loading, error, cursor, reload: () => request(null, false), more: () => request(cursor, true) };
}
function ListStatus({ loading, error, empty, retry, more, cursor }: {
  loading: boolean; error: string; empty: boolean; retry: () => void; more?: () => void; cursor?: string | null;
}) {
  return <div className="space-y-2 text-sm text-stone-500">
    {error ? <p role="alert">{error} <button className={button} onClick={retry}>重试</button></p> : null}
    {loading ? <p role="status">正在加载…</p> : null}
    {!loading && !error && empty ? <p>暂无记录</p> : null}
    {!loading && !error && cursor && more ? <button className={button} onClick={more}>加载更多</button> : null}
  </div>;
}
function Dialog({ title, children, close, busy }: { title: string; children: ReactNode; close: () => void; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = ref.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); if (!busy) close(); }} className="m-auto max-h-[85dvh] w-[min(28rem,calc(100%-2rem))] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl backdrop:bg-black/40">
    <ModalScrollLock />
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold">{title}</h2><button type="button" className={button} disabled={busy} onClick={close}>关闭</button></div>
    {children}
  </dialog>;
}
function MeasurementDialog({ spaceId, personId, metric, record, timezone, close, saved }: {
  spaceId: string; personId: string; metric: HealthMetric; record?: HealthObservation; timezone: string; close: () => void; saved: () => void;
}) {
  const [date, setDate] = useState(record?.observedDate ?? familyToday(timezone));
  const [value, setValue] = useState(record ? metric.valueType === 'boolean' ? String(record.valueBoolean) : observationValue(record) : '');
  const [unit, setUnit] = useState(record?.unit ?? metric.defaultUnit ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const payload = measurementPayload(personId, metric, date, value, unit, notes);
      if (record && record.subjectPersonId !== personId) throw Error('成员不匹配');
      await saveHealthRecord(spaceId, 'health_observation', payload, record);
      saved();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <Dialog title={record ? '编辑测量' : '记录 · ' + metric.name} close={close} busy={busy}>
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">日期<input required type="date" className={control} value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="block text-sm">测量值{metric.valueType === 'boolean' ? <select required className={control} value={value} onChange={e => setValue(e.target.value)}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select> : <input required type={metric.valueType === 'number' ? 'number' : 'text'} step="any" className={control} value={value} onChange={e => setValue(e.target.value)} />}</label>
      <label className="block text-sm">单位<input className={control} value={unit} onChange={e => setUnit(e.target.value)} /></label>
      <label className="block text-sm">备注<textarea className={control} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button className={primary} disabled={busy} type="submit">{busy ? '保存中…' : '保存'}</button>
    </form>
  </Dialog>;
}
function MetricDialog({ spaceId, close, saved }: { spaceId: string; close: () => void; saved: () => void }) {
  const [name, setName] = useState(''); const [unit, setUnit] = useState(''); const [type, setType] = useState<HealthMetric['valueType']>('number');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Dialog title="添加家庭健康指标" close={close} busy={busy}>
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault(); if (busy || !name.trim()) return; setBusy(true); setError('');
      try { await saveHealthRecord(spaceId, 'health_metric', { name: name.trim(), valueType: type, defaultUnit: unit.trim() || null }); saved(); }
      catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }}>
      <label className="block text-sm">常用指标<select className={control} value="" onChange={e => { const [n,u] = e.target.value.split('|'); if(n) { setName(n); setUnit(u); setType('number'); } }}><option value="">选择预设或自定义</option>{['身高|cm','体重|kg','体温|°C','收缩压|mmHg','舒张压|mmHg','心率|次/分','血氧|%','左眼裸眼视力|','右眼裸眼视力|','体脂率|%','骨骼肌量|kg'].map(p => <option key={p} value={p}>{p.split('|')[0]}</option>)}</select></label>
      <label className="block text-sm">名称<input required className={control} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="block text-sm">值类型<select className={control} value={type} onChange={e => setType(e.target.value as HealthMetric['valueType'])}><option value="number">数值</option><option value="text">文本</option><option value="boolean">是/否</option></select></label>
      <label className="block text-sm">默认单位<input className={control} value={unit} onChange={e => setUnit(e.target.value)} /></label>
      <p className="text-xs text-stone-500">指标定义由整个家庭共享，请勿重复添加已有指标。</p>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button type="submit" className={primary} disabled={busy}>保存指标</button>
    </form>
  </Dialog>;
}
function Trend({ rows }: { rows: HealthObservation[] }) {
  const points = rows.filter(r => typeof r.valueNumber === 'number' && Number.isFinite(r.valueNumber) && Number.isFinite(Date.parse(r.observedDate))).slice().sort((a,b) => a.observedDate.localeCompare(b.observedDate));
  if (points.length < 2) return null;
  if (new Set(points.map(p => p.unit ?? '')).size !== 1) return <p className="text-xs text-stone-500">记录单位不同，暂不合并趋势。</p>;
  const xs = points.map(p => Date.parse(p.observedDate)); const ys = points.map(p => p.valueNumber as number);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const coords = points.map((_,i) => [16 + (xs[i]-x0)/(x1-x0 || 1)*288, 92 - (ys[i]-y0)/(y1-y0 || 1)*76]);
  return <div className="rounded-xl bg-stone-50 p-3">
    <svg viewBox="0 0 320 108" role="img" aria-label="当前已加载记录的测量趋势" className="w-full max-h-40">
      <polyline points={coords.map(c => c.join(',')).join(' ')} stroke="currentColor" className="text-emerald-700" strokeWidth="2" fill="none" />
      {coords.map((c,i) => <circle key={i} cx={c[0]} cy={c[1]} r="3" fill="currentColor" className="text-emerald-700" />)}
    </svg><p className="text-xs text-stone-500">已加载记录 · {points[0].observedDate} 至 {points[points.length-1].observedDate} · {y0}–{y1} {points[0].unit ?? ''}</p>
  </div>;
}
function Measurements({ spaceId, personId, metric, timezone, writable }: { spaceId: string; personId: string; metric: HealthMetric; timezone: string; writable: boolean }) {
  const list = useHealthList<HealthObservation>(spaceId, 'health_observation', personId, metric.id);
  const [editing, setEditing] = useState<HealthObservation | 'new' | null>(null);
  const [deleting, setDeleting] = useState(false); const [mutationError, setMutationError] = useState('');
  return <section className={panel + ' space-y-3'}>
    <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{metric.name}</h2>{writable && !list.error && !list.loading ? <button className={primary} onClick={() => setEditing('new')}>记录</button> : null}</div>
    <Trend rows={list.items} />
    {list.items.map(r => <div key={r.id} className="flex flex-wrap items-center gap-2 border-b border-stone-100 py-2 text-sm">
      <div className="min-w-0 flex-1"><p className="font-medium">{observationValue(r)} {r.unit}</p><p className="text-xs text-stone-500">{r.observedDate}</p>{r.notes ? <p className="break-words text-xs text-stone-600">{r.notes}</p> : null}</div>
      {writable && r.subjectPersonId === personId ? <><button className={button} disabled={deleting} onClick={() => setEditing(r)}>编辑</button><button className={button} disabled={deleting} onClick={async () => {
        if (deleting || !window.confirm('确认删除这条测量记录？')) return;
        setDeleting(true); setMutationError('');
        try { await deleteHealthRecord(spaceId, 'health_observation', r); await list.reload(); }
        catch (cause) { setMutationError(message(cause)); } finally { setDeleting(false); }
      }}>删除</button></> : null}
    </div>)}
    {mutationError ? <p role="alert" className="text-sm text-red-700">{mutationError}</p> : null}
    <ListStatus {...list} empty={!list.items.length} retry={list.reload} />
    {editing ? <MeasurementDialog spaceId={spaceId} personId={personId} metric={metric} timezone={timezone} record={editing === 'new' ? undefined : editing} close={() => setEditing(null)} saved={() => { setEditing(null); void list.reload(); }} /> : null}
  </section>;
}
function GrowthDialog({ spaceId, personId, height, weight, timezone, close, saved }: {
  spaceId: string; personId: string; height: HealthMetric; weight: HealthMetric; timezone: string; close: () => void; saved: () => void;
}) {
  const [date, setDate] = useState(familyToday(timezone));
  const [h, setH] = useState(''); const [w, setW] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Dialog title="记录身高体重" close={close} busy={busy}>
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setError('');
      try {
        const payloads = [[height, h], [weight, w]] as const;
        const selected = payloads.filter(([,value]) => value.trim());
        if (!selected.length || selected.some(([,value]) => !Number.isFinite(Number(value)) || Number(value) <= 0)) throw Error('请输入有效的正数身高或体重');
        await saveHealthBatch(spaceId, selected.map(([metric,value]) => measurementPayload(personId, metric, date, value, metric.defaultUnit ?? '', '')));
        saved();
      } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }}>
      <label className="block text-sm">测量日期<input type="date" required className={control} value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="block text-sm">身高（cm）<input type="number" min="0.01" step="any" className={control} value={h} onChange={e => setH(e.target.value)} /></label>
      <label className="block text-sm">体重（kg）<input type="number" min="0.01" step="any" className={control} value={w} onChange={e => setW(e.target.value)} /></label>
      <p className="text-xs text-stone-500">可以只填一项。两项同时提交时，由 LifeSpace 原子批处理保存。</p>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button className={primary} disabled={busy} type="submit">保存</button>
    </form>
  </Dialog>;
}
function Metrics({ spaceId, personId, timezone, writable }: { spaceId: string; personId: string; timezone: string; writable: boolean }) {
  const list = useHealthList<HealthMetric>(spaceId, 'health_metric', personId);
  const [selected, setSelected] = useState(''); const [adding, setAdding] = useState(false); const [growth, setGrowth] = useState(false); const [revision, setRevision] = useState(0);
  const metric = list.items.find(m => m.id === selected) ?? list.items[0];
  const heights = list.items.filter(m => m.name === '身高' && m.valueType === 'number' && m.defaultUnit === 'cm');
  const weights = list.items.filter(m => m.name === '体重' && m.valueType === 'number' && m.defaultUnit === 'kg');
  const height = !list.cursor && heights.length === 1 ? heights[0] : undefined;
  const weight = !list.cursor && weights.length === 1 ? weights[0] : undefined;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <label className="min-w-40 flex-1 text-sm">指标<select className={control} value={metric?.id ?? ''} onChange={e => setSelected(e.target.value)}><option value="" disabled>请选择指标</option>{list.items.map(m => <option key={m.id} value={m.id}>{m.name}{m.defaultUnit ? ' · '+m.defaultUnit : ''}</option>)}</select></label>
      {writable && !list.error && !list.loading ? <button className={button} onClick={() => setAdding(true)}>添加指标</button> : null}
      {writable && height && weight && !list.error && !list.loading ? <button className={primary} onClick={() => setGrowth(true)}>记录身高体重</button> : null}
    </div>
    <ListStatus {...list} empty={!list.items.length} retry={list.reload} />
    {metric ? <Measurements key={metric.id + ':' + revision} spaceId={spaceId} personId={personId} metric={metric} timezone={timezone} writable={writable} /> : null}
    {growth && height && weight ? <GrowthDialog spaceId={spaceId} personId={personId} timezone={timezone} height={height} weight={weight} close={() => setGrowth(false)} saved={() => { setGrowth(false); setRevision(v => v + 1); }} /> : null}
    {adding ? <MetricDialog spaceId={spaceId} close={() => setAdding(false)} saved={() => { setAdding(false); void list.reload(); }} /> : null}
  </div>;
}
const eventLabels: Record<string,string> = { symptom: '不适症状', injury: '受伤', visit: '就诊', examination: '检查', procedure: '医疗操作', treatment: '治疗', medication_intake: '服药记录', vaccination: '疫苗接种', rehabilitation: '康复', other: '其他' };
function EventDialog({ spaceId, personId, timezone, record, close, saved }: { spaceId: string; personId: string; timezone: string; record?: HealthEvent; close: () => void; saved: () => void }) {
  const [summary, setSummary] = useState(record?.summary ?? '');
  const [type, setType] = useState(record?.eventType ?? '');
  const [date, setDate] = useState(record?.when?.kind === 'date' ? record.when.start : familyToday(timezone));
  const [location, setLocation] = useState(record?.location?.name ?? ''); const [description, setDescription] = useState(record?.description ?? '');
  const [types, setTypes] = useState<string[]>([]); const [schemaLoading, setSchemaLoading] = useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void readHealthSchema(spaceId, 'health_event').then(schema => {
      if (!active) return;
      const values = schema.fields.find(f => f.key === 'eventType')?.values ?? [];
      setTypes(values); setType(old => values.includes(old) ? old : record ? '' : values.includes('visit') ? 'visit' : values[0] ?? '');
      if (!values.length) setError('当前健康事件类型契约不可用。');
    }).catch(cause => { if(active) setError(message(cause)); }).finally(() => { if(active) setSchemaLoading(false); });
    return () => { active = false; };
  }, [spaceId, record]);
  return <Dialog title={record ? '编辑健康事件' : '添加健康事件'} close={close} busy={busy}>
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault(); if(busy || !types.includes(type)) return; setBusy(true); setError('');
      try { await saveHealthRecord(spaceId, 'health_event', eventPayload(personId, summary, type, date, location, description, record), record); saved(); }
      catch(cause) { setError(message(cause)); } finally { setBusy(false); }
    }}>
      <label className="block text-sm">标题<input required className={control} value={summary} onChange={e => setSummary(e.target.value)} /></label>
      <label className="block text-sm">类型<select required className={control} value={type} onChange={e => setType(e.target.value)}><option value="">请选择</option>{types.map(t => <option key={t} value={t}>{eventLabels[t] ?? t}</option>)}</select></label>
      {record?.when?.kind === 'instant' ? <p className="text-xs text-stone-500">保留已有精确时间：{new Date(record.when.start).toLocaleString('zh-CN', { timeZone: timezone })}</p> : <label className="block text-sm">日期<input required type="date" className={control} value={date} onChange={e => setDate(e.target.value)} /></label>}
      <label className="block text-sm">地点/机构<input className={control} value={location} onChange={e => setLocation(e.target.value)} /></label>
      <label className="block text-sm">说明<textarea className={control} value={description} onChange={e => setDescription(e.target.value)} /></label>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button className={primary} disabled={busy || schemaLoading || !types.includes(type)} type="submit">{schemaLoading ? '读取类型…' : '保存'}</button>
    </form>
  </Dialog>;
}
function Events({ spaceId, personId, timezone, writable }: { spaceId: string; personId: string; timezone: string; writable: boolean }) {
  const list = useHealthList<HealthEvent>(spaceId, 'health_event', personId);
  const [editing, setEditing] = useState<HealthEvent | 'new' | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <section className={panel + ' space-y-3'}><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">健康事件</h2>{writable && !list.error && !list.loading ? <button className={primary} onClick={() => setEditing('new')}>添加事件</button> : null}</div>
    {list.items.map(r => <article key={r.id} className="border-b border-stone-100 pb-3"><p className="font-medium">{r.summary}</p><p className="text-xs text-stone-500">{r.when?.kind === 'instant' ? new Date(r.when.start).toLocaleString('zh-CN', { timeZone: timezone }) : r.when?.start} · {eventLabels[r.eventType] ?? r.eventType} {r.status === 'cancelled' ? '已取消' : ''}</p>{r.location?.name ? <p className="text-xs text-stone-500">{r.location.name}</p> : null}{r.description ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.description}</p> : null}
      {writable && r.subjectPersonId === personId ? <div className="mt-2 flex gap-2"><button className={button} disabled={busy} onClick={() => setEditing(r)}>编辑</button><button className={button} disabled={busy} onClick={async () => {
        if (busy || !window.confirm('确认删除这条健康事件？')) return;
        setBusy(true); setError('');
        try { await deleteHealthRecord(spaceId, 'health_event', r); await list.reload(); }
        catch(cause) { setError(message(cause)); } finally { setBusy(false); }
      }}>删除</button></div> : null}
    </article>)}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    <ListStatus {...list} empty={!list.items.length} retry={list.reload} />
    {editing ? <EventDialog spaceId={spaceId} personId={personId} timezone={timezone} record={editing === 'new' ? undefined : editing} close={() => setEditing(null)} saved={() => { setEditing(null); void list.reload(); }} /> : null}
  </section>;
}
function Documents({ spaceId, personId }: { spaceId: string; personId: string }) {
  const list = useHealthList<HealthDocument>(spaceId, 'health_document', personId);
  return <section className={panel + ' space-y-3'}><h2 className="font-semibold">健康档案</h2>
    {list.items.map(r => <article key={r.id} className="border-b border-stone-100 pb-3"><p className="font-medium">{r.title}</p><p className="text-xs text-stone-500">{r.issuedDate || '日期未记录'} · {r.issuerName || r.documentType}</p>{r.notes ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.notes}</p> : null}</article>)}
    <ListStatus {...list} empty={!list.items.length} retry={list.reload} />
  </section>;
}
function Overview({ spaceId, personId, go }: { spaceId: string; personId: string; go: (tab: Tab) => void }) {
  const metrics = useHealthList<HealthMetric>(spaceId, 'health_metric', personId);
  const obs = useHealthList<HealthObservation>(spaceId, 'health_observation', personId);
  const known = new Map(metrics.items.map(m => [m.id,m.name]));
  return <div className="space-y-3">
    <section className={panel + ' space-y-3'}><div className="flex justify-between gap-2"><h2 className="font-semibold">最近测量</h2><button className={button} onClick={() => go('健康指标')}>记录与趋势</button></div>
      {obs.items.slice(0,6).map(r => <div key={r.id} className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2 text-sm"><span>{known.get(r.metricId) ?? '健康指标'}<span className="ml-2 text-xs text-stone-500">{r.observedDate}</span></span><strong>{observationValue(r)} {r.unit}</strong></div>)}
      <ListStatus {...obs} empty={!obs.items.length} retry={obs.reload} />
      {metrics.error ? <p role="alert" className="text-xs text-stone-500">{metrics.error}</p> : null}
    </section>
    <div className="grid grid-cols-2 gap-3">{(['健康事件','健康档案'] as const).map(t => <button key={t} className={panel + ' text-left font-medium hover:bg-stone-50'} onClick={() => go(t)}>{t} →</button>)}</div>
  </div>;
}
export function HealthPage() {
  const { currentFamily, members, user, loading } = useHousehold();
  const [personId, setPersonId] = useState(''); const [tab, setTab] = useState<Tab>('概览');
  const choices = members.filter(m => !!m.personId && /^per_[A-Za-z0-9_-]+$/.test(m.personId));
  const selected = choices.find(m => m.personId === personId) ?? choices.find(m => m.userId === user?.id) ?? choices[0];
  return <div className="space-y-4"><PageHeader title="健康" />
    {!currentFamily || !selected?.personId ? <p className={panel + ' text-sm text-stone-500'}>{loading ? '正在加载家庭成员…' : '请选择有有效成员身份的家庭。'}</p> : <>
      <label className="block max-w-xs text-sm font-medium">家庭成员<select className={control} value={selected.personId} onChange={e => setPersonId(e.target.value)}>{choices.map(m => <option key={m.id} value={m.personId}>{m.displayName || '家庭成员'}</option>)}</select></label>
      <p className="text-xs text-stone-500">仅记录适合家庭共享的健康资料；访问权限由 LifeSpace 决定。</p>
      <nav aria-label="健康模块" className="grid grid-cols-4 gap-1 border-b border-stone-200">{tabs.map(t => <button key={t} type="button" aria-current={t === tab ? 'page' : undefined} className={'min-h-11 border-b-2 px-1 text-sm '+(t === tab ? 'border-emerald-700 font-semibold text-emerald-800' : 'border-transparent text-stone-500')} onClick={() => setTab(t)}>{t}</button>)}</nav>
      <div key={currentFamily.id + ':' + selected.personId + ':' + tab}>
        {tab === '概览' ? <Overview spaceId={currentFamily.id} personId={selected.personId} go={setTab} />
        : tab === '健康指标' ? <Metrics spaceId={currentFamily.id} personId={selected.personId} timezone={currentFamily.timezone} writable={currentFamily.role !== 'viewer'} />
        : tab === '健康事件' ? <Events spaceId={currentFamily.id} personId={selected.personId} timezone={currentFamily.timezone} writable={currentFamily.role !== 'viewer'} />
        : <Documents spaceId={currentFamily.id} personId={selected.personId} />}
      </div>
    </>}
  </div>;
}
