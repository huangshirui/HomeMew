import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ChevronRight, FileText, HeartPulse, Ruler, Scale, Plus, Settings2, RefreshCw, CalendarDays, Stethoscope, Upload, X, Ellipsis, Download } from 'lucide-react';
import { PageHeader } from '../components/ui/page-header';
import { MemberAvatar } from '../components/app-shell';
import { useHousehold } from '../components/household-provider';
import { ModalScrollLock } from '../components/ui/modal-behavior';
import { growthMetrics, derivedBmi, healthSince, healthMonth } from './health-values';
import { HealthEventLinks } from './health-event-links';
import { ApiError, apiRequest } from '../lib/api-client';
import { checkMetricName, verifyDocumentEvent, deleteHealthRecord, eventPayload, familyToday, measurementPayload, observationValue, readHealthPage, readHealthRuntime, readGrowthObservations, saveHealthBatch, saveHealthRecord, type HealthDocument, type HealthEvent, type HealthMetric, type HealthModel, type HealthObservation, type HealthRecord, type HealthRuntimeModel, type HealthQueryOptions } from './health-domain';

const tabs = ['概览', '健康指标', '健康事件', '健康档案'] as const;
type Tab = typeof tabs[number];
const tabLabels: Record<Tab,string> = { 概览: '概览', 健康指标: '指标', 健康事件: '事件', 健康档案: '档案' };
const control = 'min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm';
const button = 'min-h-10 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-50';
const primary = 'min-h-10 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const panel = 'rounded-2xl bg-white p-4 sm:p-5 ring-1 ring-stone-200/80';
const muted='text-xs text-stone-500';
const EMPTY_HEALTH_ROWS:never[]=[];
const FILE_EXTENSIONS:Record<string,string>={'application/pdf':'.pdf','image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
const iconButton=button+' inline-flex items-center justify-center gap-1.5';
function message(error: unknown) {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return '当前健康模型未开放或没有访问权限。';
  if (error instanceof ApiError && error.status === 409) return '记录已更新，请刷新后再操作。';
  return '操作未完成，请重试或检查当前权限。';
}
function useHealthList<T extends HealthRecord>(spaceId: string, model: HealthModel, personId: string, metricId?: string, timezone = 'UTC', options:HealthQueryOptions={}, enabled=true) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const pending=useRef<{key:string;promise:ReturnType<typeof readHealthPage<T>>}|null>(null);
  const scope=JSON.stringify([spaceId,model,model==='health_metric'?'':personId,metricId,timezone,options.limit,options.since,options.documentType]);
  const [loadedScope,setLoadedScope]=useState('');
  const request = async (next: string | null, append: boolean) => {
    if(!enabled)return;
    const id = ++generation.current;
    setLoading(true); setError('');
    if (!append) { setItems([]); setCursor(null); }
    const key=scope+':'+(next??'first');
    const promise=pending.current?.key===key?pending.current.promise:readHealthPage<T>(spaceId, model, personId, next, metricId, timezone,options);
    pending.current={key,promise};
    try {
      const result = await promise;
      if (id !== generation.current) return;
      if (model !== 'health_metric' && result.items.some(item => item.subjectPersonId !== personId)) throw Error('成员记录范围不匹配');
      setItems(previous => append ? [...previous, ...result.items.filter(item => !previous.some(p => p.id === item.id))] : result.items);
      setCursor(result.nextCursor);setLoadedScope(scope);
    } catch (cause) {
      if (id === generation.current) {setItems([]);setCursor(null);setLoadedScope(scope);setError(message(cause));}
    } finally {
      if(pending.current?.promise===promise)pending.current=null;
      if (id === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    if(enabled)void request(null, false);
    else {setItems([]);setCursor(null);setLoading(false);setError('');}
    return () => { generation.current += 1; };
  }, [scope,enabled]);
  const ready=enabled&&loadedScope===scope;
  return { items:ready?items:EMPTY_HEALTH_ROWS, loading:enabled&&(!ready||loading), error:ready?error:'', cursor:ready?cursor:null, reload: () => request(null, false), more: () => !loading&&cursor?request(cursor, true):undefined };
}
type MetricList=ReturnType<typeof useHealthList<HealthMetric>>;
function modelAccess(models:HealthRuntimeModel[],model:HealthModel,access:'read'|'write') {return models.some(m=>m.key===model&&m.access.includes(access));}
function Empty({children}:{children:ReactNode}) {return <div className="rounded-xl bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">{children}</div>;}
function RecordMenu({edit,remove,disabled}:{edit:()=>void;remove:()=>void;disabled:boolean}) {
  const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[open]);
  return <div ref={root} className="relative shrink-0"><button type="button" aria-label="更多操作" aria-expanded={open} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" disabled={disabled} onClick={()=>setOpen(v=>!v)}><Ellipsis className="size-5"/></button>{open?<div className="absolute right-0 z-10 w-28 rounded-xl border border-stone-200 bg-white p-1 shadow-lg"><button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-50" onClick={()=>{setOpen(false);edit();}}>编辑</button><button className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={()=>{setOpen(false);remove();}}>删除</button></div>:null}</div>;
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
  return <dialog ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); if (!busy) close(); }} className="m-auto max-h-[88dvh] w-[min(38rem,calc(100%-2rem))] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl backdrop:bg-black/40">
    <ModalScrollLock />
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold">{title}</h2><button type="button" aria-label="关闭" className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" disabled={busy} onClick={close}><X className="size-5"/></button></div>
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
function MetricDialog({ spaceId, record, close, saved }: { spaceId: string; record?: HealthMetric; close: () => void; saved: () => void }) {
  const [name, setName] = useState(record?.name ?? ''); const [unit, setUnit] = useState(record?.defaultUnit ?? ''); const [type, setType] = useState<HealthMetric['valueType']>(record?.valueType ?? 'number');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Dialog title={record ? "编辑家庭健康指标" : "添加家庭健康指标"} close={close} busy={busy}>
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault(); if (busy || !name.trim()) return; setBusy(true); setError('');
      try { await checkMetricName(spaceId,name.trim(),record?.id); await saveHealthRecord(spaceId, 'health_metric', record ? {name:name.trim()} : { name: name.trim(), valueType: type, defaultUnit: unit.trim() || null },record); saved(); }
      catch (cause) { setError(cause instanceof ApiError ? message(cause) : cause instanceof Error && ['已存在同名指标，请复用。','同名指标检查未完成，请缩小搜索范围。'].includes(cause.message) ? cause.message : message(cause)); } finally { setBusy(false); }
    }}>
      {!record ? <label className="block text-sm">常用指标<select className={control} value="" onChange={e => { const [n,u] = e.target.value.split('|'); if(n) { setName(n); setUnit(u); setType('number'); } }}><option value="">选择预设或自定义</option>{['身高|cm','体重|kg','体温|°C','收缩压|mmHg','舒张压|mmHg','心率|次/分','血氧|%','左眼裸眼视力|','右眼裸眼视力|','体脂率|%','骨骼肌量|kg'].map(p => <option key={p} value={p}>{p.split('|')[0]}</option>)}</select></label> : null}
      <label className="block text-sm">名称<input required maxLength={160} className={control} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="block text-sm">值类型<select disabled={!!record} className={control} value={type} onChange={e => setType(e.target.value as HealthMetric['valueType'])}><option value="number">数值</option><option value="text">文本</option><option value="boolean">是/否</option></select></label>
      <label className="block text-sm">默认单位<input disabled={!!record} className={control} value={unit} onChange={e => setUnit(e.target.value)} /></label>
      <p className="text-xs text-stone-500">{record ? '指标由整个家庭共享。为保护已有测量，暂只允许修改名称；类型和单位保持不变。' : '指标定义由整个家庭共享，请勿重复添加已有指标。'}</p>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button type="submit" className={primary} disabled={busy}>保存指标</button>
    </form>
  </Dialog>;
}
function Trend({ rows }: { rows: HealthObservation[] }) {
  const points = rows.filter(r => typeof r.valueNumber === 'number' && Number.isFinite(r.valueNumber) && Number.isFinite(Date.parse(r.observedDate))).slice().sort((a,b) => a.observedDate.localeCompare(b.observedDate));
  if (points.length < 2) return <Empty>至少两次数值记录后显示趋势</Empty>;
  if (new Set(points.map(p => p.unit ?? '')).size !== 1) return <Empty>记录单位不同，暂不合并趋势</Empty>;
  const xs=points.map(p=>Date.parse(p.observedDate)),ys=points.map(p=>p.valueNumber as number);
  const x0=Math.min(...xs),x1=Math.max(...xs),low=Math.min(...ys),high=Math.max(...ys),pad=(high-low)*.12||Math.max(Math.abs(high)*.05,.1);
  const y0=low-pad,y1=high+pad;
  const coords=points.map((_,i)=>[62+(x1===x0 ? .5 :(xs[i]-x0)/(x1-x0))*470,154-(ys[i]-y0)/(y1-y0)*132]);
  const unit=points[0].unit??'';
  return <div className="rounded-xl border border-stone-100 bg-stone-50/60 p-2 sm:p-4">
    <svg viewBox="0 0 560 190" role="img" aria-label="已加载测量记录的趋势，纵轴为实际测量值" className="w-full max-h-64">
      {[0,1,2,3].map(i=>{const y=22+i*44;const val=y1-(y1-y0)*i/3;return <g key={i}><line x1="62" x2="532" y1={y} y2={y} stroke="#e7e5e4"/><text x="54" y={y+4} textAnchor="end" fontSize="11" fill="#78716c">{Number(val.toPrecision(4))}</text></g>;})}
      <text x="8" y="13" fontSize="10" fill="#78716c">{unit}</text>
      <polyline points={coords.map(c=>c.join(',')).join(' ')} stroke="#047857" strokeWidth="2.5" fill="none" strokeLinejoin="round"/>
      {coords.map((c,i)=><circle key={points[i].id} cx={c[0]} cy={c[1]} r="4" fill="#047857" stroke="white" strokeWidth="1.5"><title>{points[i].observedDate+' · '+ys[i]+' '+unit}</title></circle>)}
      <text x="62" y="177" fontSize="11" fill="#78716c">{points[0].observedDate}</text><text x="532" y="177" textAnchor="end" fontSize="11" fill="#78716c">{points.at(-1)?.observedDate}</text>
    </svg><p className={muted}>已加载 {points.length} 次测量 · 纵轴按实际数值缩放</p>
  </div>;
}
function Measurements({ spaceId, personId, metric, timezone, writable }: { spaceId: string; personId: string; metric: HealthMetric; timezone: string; writable: boolean }) {
  const [range,setRange]=useState(365);
  const since=range?healthSince(familyToday(timezone),range):undefined;
  const list=useHealthList<HealthObservation>(spaceId,'health_observation',personId,metric.id,timezone,{since,limit:30});
  const [editing,setEditing]=useState<HealthObservation|'new'|null>(null);
  const [deleting,setDeleting]=useState(false);const [mutationError,setMutationError]=useState('');
  const latest=list.items[0],previous=list.items[1];
  const delta=latest&&previous&&typeof latest.valueNumber==='number'&&typeof previous.valueNumber==='number'&&latest.unit===previous.unit?latest.valueNumber-previous.valueNumber:null;
  async function remove(r:HealthObservation) {if(deleting||!window.confirm('确认删除这条测量记录？'))return;setDeleting(true);setMutationError('');try{await deleteHealthRecord(spaceId,'health_observation',r);await list.reload();}catch(cause){setMutationError(message(cause));}finally{setDeleting(false);}}
  return <section className={panel+' space-y-4'}>
    <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-stone-500">{metric.name} · 最近一次（所选时段）</p><div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{latest?observationValue(latest):'—'} <span className="text-sm font-normal text-stone-500">{latest?.unit??metric.defaultUnit??''}</span></div><p className={muted}>{latest?.observedDate??'暂无测量'}{delta!==null?' · 较上次 '+(delta>0?'+':'')+Number(delta.toPrecision(5))+' '+(latest?.unit??''):''}</p></div>{writable&&!list.error&&!list.loading?<button className={primary+' flex shrink-0 items-center gap-1'} onClick={()=>setEditing('new')}><Plus className="size-4"/>记录测量</button>:null}</div>
    <div className="flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1">{[[90,'近90天'],[365,'近一年'],[0,'全部']].map(([n,label])=><button key={n} aria-pressed={range===n} className={'flex-1 rounded-lg px-2 py-2 text-xs '+(range===n?'bg-white font-semibold text-emerald-800 shadow-sm':'text-stone-500')} onClick={()=>setRange(Number(n))}>{label}</button>)}</div>
    {!list.loading&&!list.error&&metric.valueType==='number'?<Trend rows={list.items}/>:null}
    <div className="flex items-center justify-between border-b border-stone-100 pb-2"><h3 className="font-semibold">测量记录</h3><span className={muted}>已加载 {list.items.length} 条{list.cursor?' · 还有更多':''}</span></div>
    {list.items.map(r=><div key={r.id} className="flex items-center gap-3 border-b border-stone-100 py-2 text-sm"><div className="min-w-0 flex-1"><p className="text-stone-600">{r.observedDate}</p>{r.notes?<p className="truncate text-xs text-stone-500">{r.notes}</p>:null}</div><strong className="tabular-nums">{observationValue(r)} {r.unit}</strong>{writable&&r.subjectPersonId===personId?<RecordMenu disabled={deleting} edit={()=>setEditing(r)} remove={()=>void remove(r)}/>:null}</div>)}
    {mutationError?<p role="alert" className="text-sm text-red-700">{mutationError}</p>:null}
    <ListStatus {...list} empty={!list.items.length} retry={list.reload}/>
    {editing?<MeasurementDialog spaceId={spaceId} personId={personId} metric={metric} timezone={timezone} record={editing==='new'?undefined:editing} close={()=>setEditing(null)} saved={()=>{setEditing(null);void list.reload();}}/>:null}
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
      <p className="text-xs text-stone-500">可以只填一项；两项同时填写会一起保存。</p>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button className={primary} disabled={busy} type="submit">保存</button>
    </form>
  </Dialog>;
}
function Metrics({spaceId,personId,timezone,metrics,selected,setSelected,canMeasure,canManage}:{spaceId:string;personId:string;timezone:string;metrics:MetricList;selected:string;setSelected:(id:string)=>void;canMeasure:boolean;canManage:boolean}) {
  const [managing,setManaging]=useState(false),[adding,setAdding]=useState(false),[editingMetric,setEditingMetric]=useState<HealthMetric|null>(null),[growth,setGrowth]=useState(false),[revision,setRevision]=useState(0);
  const ordered=[...metrics.items].sort((a,b)=>{const rank=(m:HealthMetric)=>m.name==='身高'?0:m.name==='体重'?1:2;return rank(a)-rank(b);});
  const metric=ordered.find(m=>m.id===selected)??ordered[0];
  const {height,weight}=growthMetrics(metrics.items,!metrics.cursor&&!metrics.loading&&!metrics.error);
  return <div className="space-y-3">
    <section className={panel+' space-y-3'}><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">选择指标</h2><div className="flex flex-wrap justify-end gap-2">{canMeasure&&height&&weight?<button className={iconButton} onClick={()=>setGrowth(true)}><Ruler className="size-4"/>身高体重</button>:null}{canManage&&!metrics.error&&!metrics.loading?<button className={iconButton} onClick={()=>setManaging(true)}><Settings2 className="size-4"/>指标管理</button>:null}</div></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{ordered.map(m=><button key={m.id} aria-pressed={m.id===metric?.id} className={'min-h-14 rounded-xl border px-3 py-2 text-left text-sm '+(m.id===metric?.id?'border-emerald-500 bg-emerald-50 text-emerald-900':'border-stone-200 hover:bg-stone-50')} onClick={()=>setSelected(m.id)}><span className="block font-medium">{m.name}</span><span className={muted}>{m.defaultUnit||'健康记录'}</span></button>)}</div>
      <ListStatus {...metrics} empty={!metrics.items.length} retry={metrics.reload}/>
    </section>
    {metric?<Measurements key={metric.id+':'+revision} spaceId={spaceId} personId={personId} metric={metric} timezone={timezone} writable={canMeasure}/>:null}
    {managing?<Dialog title="家庭指标管理" close={()=>setManaging(false)} busy={false}><div className="space-y-3"><p className="text-sm text-stone-500">同一家人的指标定义共享，测量记录按成员分别保存。</p><button className={primary+' w-full'} onClick={()=>{setManaging(false);setAdding(true);}}>＋ 新增指标</button>{ordered.map(m=><button key={m.id} className="flex w-full items-center justify-between border-b border-stone-100 py-3 text-left text-sm" onClick={()=>{setManaging(false);setEditingMetric(m);}}><span>{m.name} <span className={muted}>{m.defaultUnit}</span></span><ChevronRight className="size-4 text-stone-400"/></button>)}</div></Dialog>:null}
    {growth&&height&&weight?<GrowthDialog spaceId={spaceId} personId={personId} timezone={timezone} height={height} weight={weight} close={()=>setGrowth(false)} saved={()=>{setGrowth(false);setRevision(v=>v+1);}}/>:null}
    {editingMetric?<MetricDialog spaceId={spaceId} record={editingMetric} close={()=>{setEditingMetric(null);setManaging(true);}} saved={()=>{setEditingMetric(null);setManaging(true);void metrics.reload();}}/>:null}
    {adding?<MetricDialog spaceId={spaceId} close={()=>{setAdding(false);setManaging(true);}} saved={()=>{setAdding(false);setManaging(true);void metrics.reload();}}/>:null}
  </div>;
}
const eventLabels: Record<string,string> = { symptom: '不适症状', injury: '受伤', visit: '就诊', examination: '检查', procedure: '医疗操作', treatment: '治疗', medication_intake: '服药记录', vaccination: '疫苗接种', rehabilitation: '康复', other: '其他' };
function EventDialog({ spaceId, personId, timezone, record, schema, close, saved }: { spaceId: string; personId: string; timezone: string; record?: HealthEvent; schema:HealthRuntimeModel; close: () => void; saved: () => void }) {
  const [summary, setSummary] = useState(record?.summary ?? '');
  const types=schema.fields.find(f=>f.key==='eventType')?.values??[];
  const [type,setType]=useState(record?.eventType??(types.includes('visit')?'visit':types[0]??''));
  const [date, setDate] = useState(record?.when?.kind === 'date' ? record.when.start : familyToday(timezone));
  const [location, setLocation] = useState(record?.location?.name ?? ''); const [description, setDescription] = useState(record?.description ?? '');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <Dialog title={record ? '编辑健康事件' : '记录健康事件'} close={close} busy={busy}>
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
      <button className={primary} disabled={busy || !types.includes(type)} type="submit">保存</button>
    </form>
  </Dialog>;
}
function eventDate(r:HealthEvent,timezone:string) {
  if(r.when?.kind!=='instant')return r.when?.start??'';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(r.when.start));
  return ['year','month','day'].map(key=>parts.find(p=>p.type===key)?.value).join('-');
}
function Events({spaceId,personId,timezone,writable,schema}:{spaceId:string;personId:string;timezone:string;writable:boolean;schema:HealthRuntimeModel}) {
  const list=useHealthList<HealthEvent>(spaceId,'health_event',personId,undefined,timezone);
  const [editing,setEditing]=useState<HealthEvent|'new'|null>(null),[detail,setDetail]=useState<HealthEvent|null>(null),[linking,setLinking]=useState<HealthEvent|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function remove(r:HealthEvent){if(busy||!window.confirm('确认删除这条健康事件？'))return;setBusy(true);setError('');try{await deleteHealthRecord(spaceId,'health_event',r);setDetail(null);await list.reload();}catch(cause){setError(message(cause));}finally{setBusy(false);}}
  return <section className={panel+' space-y-4'}><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">健康时间线</h2>{writable&&!list.error&&!list.loading?<button className={primary+' flex items-center gap-1'} onClick={()=>setEditing('new')}><Plus className="size-4"/>记录事件</button>:null}</div>
    <p className="text-xs text-stone-500">记录已经发生的健康情况；未来的预约和提醒请使用日程、待办。</p>
    {list.items.map((r,i)=>{const date=eventDate(r,timezone),month=healthMonth(date),previous=i?healthMonth(eventDate(list.items[i-1],timezone)):'';return <div key={r.id}>{month!==previous?<h3 className="mb-3 text-sm font-semibold text-stone-500">{month}</h3>:null}<div className="relative ml-4 border-l border-stone-200 pl-5"><span className="absolute -left-4 top-3 grid size-8 place-items-center rounded-full bg-emerald-50 text-emerald-700 ring-4 ring-white">{r.eventType==='visit'?<Stethoscope className="size-4"/>:<HeartPulse className="size-4"/>}</span><button className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-stone-50" onClick={()=>setDetail(r)}><div className="min-w-0 flex-1"><p className="font-medium">{r.summary}</p><p className={muted}>{date} · {eventLabels[r.eventType]??r.eventType}{r.status==='cancelled'?' · 已取消':''}{r.location?.name?' · '+r.location.name:''}</p>{r.description?<p className="mt-1 line-clamp-2 break-words text-sm text-stone-600">{r.description}</p>:null}</div><ChevronRight className="size-4 shrink-0 text-stone-400"/></button></div></div>;})}
    {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}<ListStatus {...list} empty={!list.items.length} retry={list.reload}/>
    {detail?<Dialog title={detail.summary} close={()=>setDetail(null)} busy={busy}><div className="space-y-4"><p className="text-sm text-stone-500">{detail.when?.kind==='instant'?new Date(detail.when.start).toLocaleString('zh-CN',{timeZone:timezone}):eventDate(detail,timezone)} · {eventLabels[detail.eventType]??detail.eventType}{detail.status==='cancelled'?' · 已取消':''}</p>{detail.location?.name?<p className="text-sm">{detail.location.name}</p>:null}{detail.description?<p className="whitespace-pre-wrap break-words text-sm">{detail.description}</p>:null}<button className={button+' w-full text-left'} onClick={()=>{setLinking(detail);setDetail(null);}}>相关日程与待办 <ChevronRight className="float-right size-4"/></button>{writable?<div className="flex justify-end gap-2"><button className={button} onClick={()=>{setEditing(detail);setDetail(null);}}>编辑</button><button className={button+' text-red-700'} disabled={busy} onClick={()=>void remove(detail)}>删除</button></div>:null}</div></Dialog>:null}
    {linking?<Dialog title="相关日程与待办" close={()=>setLinking(null)} busy={false}><HealthEventLinks spaceId={spaceId} eventId={linking.id} writable={writable} timezone={timezone}/></Dialog>:null}
    {editing?<EventDialog spaceId={spaceId} personId={personId} timezone={timezone} schema={schema} record={editing==='new'?undefined:editing} close={()=>setEditing(null)} saved={()=>{setEditing(null);void list.reload();}}/>:null}
  </section>;
}
const documentLabels: Record<string,string> = {lab_report:'化验报告',imaging_report:'影像报告',physical_exam:'体检报告',prescription:'处方',visit_note:'门诊病历',discharge_summary:'出院记录',rehabilitation_plan:'康复方案',other:'其他'};
const documentPath = (spaceId: string, personId: string) => '/api/health/spaces/' + encodeURIComponent(spaceId) + '/persons/' + encodeURIComponent(personId) + '/documents';
function DocumentDialog({ spaceId, personId, timezone, record, schema, close, saved }: { spaceId: string; personId: string; timezone:string; record?: HealthDocument; schema:HealthRuntimeModel; close: () => void; saved: () => void }) {
  const types=(schema.fields.find(f=>f.key==='documentType')?.values??[]).filter(t=>Object.hasOwn(documentLabels,t));
  const [title,setTitle]=useState(record?.title??'');const [type,setType]=useState(record?.documentType??types[0]??'');
  const [date,setDate] = useState(record?.issuedDate ?? ''); const [issuer,setIssuer] = useState(record?.issuerName ?? ''); const [notes,setNotes] = useState(record?.notes ?? '');
  const [eventId,setEventId]=useState(record?.eventId??'');
  const [chooseEvent,setChooseEvent]=useState(false);
  const events=useHealthList<HealthEvent>(spaceId,'health_event',personId,undefined,timezone,{limit:20},chooseEvent);
  const [file,setFile] = useState<File | null>(null); const [shared,setShared] = useState(false);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <Dialog title={record?'编辑档案':'上传健康档案'} close={close} busy={busy}>
    <form className="space-y-3" onSubmit={async e=>{
      e.preventDefault(); if(busy || !title.trim() || !types.includes(type) || (!record && (!file || !shared)))return;
      setBusy(true);setError('');
      try {
        if(record&&eventId!== (record.eventId??'')) await verifyDocumentEvent(spaceId,personId,eventId);
        if(record) {
          if(record.subjectPersonId!==personId)throw Error('成员不匹配');
          // artifactRef is immutable; metadata edits never replace it or the existing event.
          await saveHealthRecord(spaceId,'health_document',{title:title.trim(),documentType:type,issuedDate:date||null,issuerName:issuer.trim()||null,notes:notes.trim()||null,...(eventId!==(record.eventId??'')?{eventId:eventId||null}:{})},record);
        } else if(file) {
          if(file.size>15*1024*1024 || !file.size)throw Error('文件大小无效');
          const form=new FormData();
          form.set('file',file);form.set('title',title.trim());form.set('documentType',type);form.set('issuedDate',date);form.set('issuerName',issuer.trim());form.set('notes',notes.trim());form.set('eventId',eventId);
          await apiRequest<HealthDocument>(documentPath(spaceId,personId),{method:'POST',body:form});
        }
        saved();
      } catch(cause){setError(message(cause));} finally{setBusy(false);}
    }}>
      <label className="block text-sm">名称<input required maxLength={200} className={control} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="block text-sm">类型<select required className={control} value={type} onChange={e=>setType(e.target.value)}><option value="">请选择</option>{types.map(t=><option key={t} value={t}>{documentLabels[t]??t}</option>)}</select></label>
      <label className="block text-sm">报告日期<input type="date" className={control} value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label className="block text-sm">出具机构<input maxLength={200} className={control} value={issuer} onChange={e=>setIssuer(e.target.value)}/></label>
      <label className="block text-sm">说明<textarea maxLength={4000} className={control} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      <button type="button" className={button+" w-full text-left"} onClick={()=>setChooseEvent(v=>!v)}>{chooseEvent?"收起关联事件":eventId?"已关联健康事件 · 更改":"＋ 关联健康事件（可选）"}</button>
      {chooseEvent?<><label className="block text-sm">选择事件<select className={control} value={eventId} onChange={e=>setEventId(e.target.value)}><option value="">不关联</option>{eventId&&!events.items.some(e=>e.id===eventId)?<option value={eventId}>保留已有事件</option>:null}{events.items.map(e=><option key={e.id} value={e.id}>{e.summary} · {e.when?.start.slice(0,10)}</option>)}</select></label>
      {events.cursor&&!events.loading&&!events.error?<button type="button" className={button} onClick={()=>void events.more()}>加载更多事件</button>:null}
      {events.error?<p className="text-xs text-stone-500">健康事件暂不可读取，可保留已有关系。</p>:null}</>:null}
      {!record ? <><label className="block text-sm">附件（PDF 或图片，最大 15 MB）<input required type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className={control} onChange={e=>{const f=e.target.files?.[0]??null;setFile(f);if(f&&!title.trim())setTitle(f.name.replace(/\.[^.]+$/u,''));}}/></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" required checked={shared} onChange={e=>setShared(e.target.checked)}/>确认该档案适合在当前家庭共享</label></> : <p className="text-xs text-stone-500">已有附件不随资料信息编辑而替换。</p>}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p>:null}
      <button type="submit" className={primary} disabled={busy||!types.includes(type)||(!record&&(!file||!shared))}>{busy?'保存中…':'保存'}</button>
    </form>
  </Dialog>;
}
function DocumentPreview({url,title}:{url:string;title:string}) {
  const [file,setFile]=useState<{url:string;type:string}|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true,objectUrl='';const abort=new AbortController();
    void (async()=>{try{const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:abort.signal});if(!response.ok||!response.body)throw Error('file');const type=(response.headers.get('content-type')??'').split(';')[0];const reader=response.body.getReader();const chunks:BlobPart[]=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>15*1024*1024){await reader.cancel();throw Error('file size');}chunks.push(new Uint8Array(value));}}finally{reader.releaseLock();}if(!active)return;objectUrl=URL.createObjectURL(new Blob(chunks,{type:['application/pdf','image/png','image/jpeg','image/webp'].includes(type)?type:'application/octet-stream'}));setFile({url:objectUrl,type});}catch{if(active)setError('文件暂时无法预览，请关闭后重试。');}})();
    return()=>{active=false;abort.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[url]);
  if(error)return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if(!file)return <p role="status" className="p-6 text-center text-sm text-stone-500">正在安全读取档案…</p>;
  return <div className="space-y-3">{file.type==='application/pdf'?<><iframe sandbox="" src={file.url} title="PDF 档案预览" className="h-[50dvh] w-full rounded-xl border border-stone-200"/><p className={muted}>浏览器不支持内嵌 PDF 时，可下载原始资料查看。</p></>:['image/png','image/jpeg','image/webp'].includes(file.type)?<img src={file.url} alt={title} className="max-h-[55dvh] w-full rounded-xl object-contain"/>:<p className={muted}>此文件类型仅支持下载。</p>}<a className={iconButton} href={file.url} download={title+(FILE_EXTENSIONS[file.type]??'')}><Download className="size-4"/>下载原始资料</a></div>;
}
function Documents({spaceId,personId,timezone,writable,schema}:{spaceId:string;personId:string;timezone:string;writable:boolean;schema:HealthRuntimeModel}) {
  const [filter,setFilter]=useState('');
  const list=useHealthList<HealthDocument>(spaceId,'health_document',personId,undefined,timezone,{documentType:filter||undefined});
  const [editing,setEditing]=useState<HealthDocument|'new'|null>(null),[detail,setDetail]=useState<HealthDocument|null>(null),[preview,setPreview]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const types=(schema.fields.find(f=>f.key==='documentType')?.values??[]).filter(t=>Object.hasOwn(documentLabels,t));
  async function remove(r:HealthDocument){if(busy||!window.confirm('确认删除这条健康档案？'))return;setBusy(true);setError('');try{await deleteHealthRecord(spaceId,'health_document',r);setDetail(null);await list.reload();}catch(cause){setError(message(cause));}finally{setBusy(false);}}
  return <section className={panel+' space-y-4'}><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">健康档案</h2>{writable&&!list.loading&&!list.error?<button className={primary+' flex items-center gap-1'} onClick={()=>setEditing('new')}><Upload className="size-4"/>上传档案</button>:null}</div>
    <div className="flex flex-wrap gap-2">{['',...types].map(t=><button key={t} aria-pressed={t===filter} className={'rounded-full px-3 py-1.5 text-xs '+(t===filter?'bg-emerald-100 font-semibold text-emerald-800':'bg-stone-100 text-stone-600 hover:bg-stone-200')} onClick={()=>setFilter(t)}>{documentLabels[t]??'全部'}</button>)}</div>
    {list.items.map(r=><button key={r.id} className="flex w-full items-center gap-3 border-b border-stone-100 py-3 text-left hover:bg-stone-50" onClick={()=>{setPreview(false);setDetail(r);}}><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><FileText className="size-5"/></span><div className="min-w-0 flex-1"><p className="truncate font-medium">{r.title}</p><p className={muted}>{r.issuedDate||'日期未记录'} · {documentLabels[r.documentType]??r.documentType}{r.issuerName?' · '+r.issuerName:''}</p></div><ChevronRight className="size-4 shrink-0 text-stone-400"/></button>)}
    {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}<ListStatus {...list} empty={!list.items.length} retry={list.reload}/>
    {detail?<Dialog title={detail.title} close={()=>{setDetail(null);setPreview(false);}} busy={busy}><div className="space-y-3"><p className="text-sm text-stone-500">{detail.issuedDate||'日期未记录'} · {documentLabels[detail.documentType]??detail.documentType}{detail.issuerName?' · '+detail.issuerName:''}</p>{detail.notes?<p className="whitespace-pre-wrap break-words text-sm">{detail.notes}</p>:null}{detail.eventId?<p className={muted}>已关联健康事件</p>:null}{detail.artifactRef?(preview?<DocumentPreview url={documentPath(spaceId,personId)+'/'+encodeURIComponent(detail.id)+'/file'} title={detail.title}/>:<button className={primary+' w-full'} onClick={()=>setPreview(true)}>查看原始资料</button>):<Empty>暂无附件</Empty>}{writable?<div className="flex justify-end gap-2"><button className={button} onClick={()=>{setEditing(detail);setDetail(null);setPreview(false);}}>编辑</button><button className={button+' text-red-700'} disabled={busy} onClick={()=>void remove(detail)}>删除</button></div>:null}</div></Dialog>:null}
    {editing?<DocumentDialog spaceId={spaceId} personId={personId} timezone={timezone} schema={schema} record={editing==='new'?undefined:editing} close={()=>setEditing(null)} saved={()=>{setEditing(null);void list.reload();}}/>:null}
  </section>;
}

function Overview({spaceId,personId,timezone,metrics,models,go,selectMetric}:{spaceId:string;personId:string;timezone:string;metrics:MetricList;models:HealthRuntimeModel[];go:(tab:Tab)=>void;selectMetric:(id:string)=>void}) {
  const readable=modelAccess(models,'health_observation','read');
  const obs=useHealthList<HealthObservation>(spaceId,'health_observation',personId,undefined,timezone,{limit:12},readable);
  const known=new Map(metrics.items.map(m=>[m.id,m.name]));
  const {height,weight}=growthMetrics(metrics.items,!metrics.loading&&!metrics.error&&!metrics.cursor);
  const heightId=height?.id,weightId=weight?.id;
  const boundary=obs.cursor?obs.items.at(-1)?.observedDate:undefined;
  const localBmi=heightId&&weightId?derivedBmi(obs.items,heightId,weightId,personId,boundary):null;
  const [extra,setExtra]=useState<HealthObservation[]>([]),[extraBmi,setExtraBmi]=useState<{date:string;value:number}|null>(null),[growth,setGrowth]=useState(false);
  const [event,setEvent]=useState(false),[doc,setDoc]=useState(false);
  useEffect(()=>{let active=true;setExtra([]);setExtraBmi(null);
    if(readable&&heightId&&weightId&&!obs.loading&&!obs.error&&obs.cursor&&!localBmi)void readGrowthObservations(spaceId,personId,heightId,weightId).then(page=>{
      if(!active||page.items.some(r=>r.subjectPersonId!==personId||![heightId,weightId].includes(r.metricId)))return;
      const boundary=page.nextCursor?page.items.at(-1)?.observedDate:undefined;
      setExtra(page.items);setExtraBmi(derivedBmi(page.items,heightId,weightId,personId,boundary));
    }).catch(()=>{if(active){setExtra([]);setExtraBmi(null);}});
    return()=>{active=false;};
  },[spaceId,personId,heightId,weightId,readable,obs.loading,obs.error,obs.cursor,obs.items,localBmi?.date,localBmi?.value]);
  const rows=[...obs.items,...(!obs.loading&&!obs.error?extra:EMPTY_HEALTH_ROWS)].sort((a,b)=>b.observedDate.localeCompare(a.observedDate));
  const bmi=!obs.loading&&!obs.error?(localBmi??extraBmi):null;
  const measureWrite=modelAccess(models,'health_observation','write');
  const eventSchema=models.find(m=>m.key==='health_event'&&m.access.includes('write')),documentSchema=models.find(m=>m.key==='health_document'&&m.access.includes('write'));
  const cards=[{label:'身高',unit:'cm',metric:height,icon:Ruler},{label:'体重',unit:'kg',metric:weight,icon:Scale}];
  return <div className="space-y-4">
    {readable?<div className="grid grid-cols-3 gap-2 sm:gap-3">{cards.map(c=>{const latest=!obs.loading&&!obs.error&&c.metric?rows.find(r=>r.metricId===c.metric?.id&&r.unit===c.unit&&typeof r.valueNumber==='number'):undefined;return <button key={c.label} className={panel+' min-w-0 text-left hover:bg-stone-50'} onClick={()=>{if(c.metric)selectMetric(c.metric.id);go('健康指标');}}><div className="flex items-center gap-1 text-xs text-stone-500 sm:text-sm"><c.icon className="size-4 text-emerald-700"/>{c.label}</div><div className="mt-2 text-xl font-semibold tabular-nums sm:text-3xl">{latest?observationValue(latest):'—'} <span className="text-xs font-normal text-stone-500">{c.unit}</span></div><p className="mt-1 truncate text-[11px] text-stone-500">{latest?.observedDate??'近期未找到'}</p></button>;})}<div className={panel+' min-w-0'}><p className="flex items-center gap-1 text-xs text-stone-500 sm:text-sm"><Activity className="size-4 text-emerald-700"/>BMI</p><div className="mt-2 text-xl font-semibold tabular-nums sm:text-3xl">{bmi?.value??'—'} <span className="text-xs font-normal text-stone-500">kg/m²</span></div><p className="mt-1 truncate text-[11px] text-stone-500">{bmi?.date??'需同日身高体重'}</p></div></div>:null}
    <section className={panel+' space-y-3'}><h2 className="font-semibold">快速记录</h2><div className="grid grid-cols-3 gap-2">
      {measureWrite&&modelAccess(models,'health_metric','read')?<button className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl bg-emerald-50 p-2 text-xs font-medium text-emerald-800 sm:text-sm" onClick={()=>height&&weight?setGrowth(true):go('健康指标')}><Ruler className="size-6"/>身高体重</button>:null}
      {eventSchema?<button className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl bg-stone-50 p-2 text-xs font-medium text-stone-700 sm:text-sm" onClick={()=>setEvent(true)}><HeartPulse className="size-6 text-emerald-700"/>记录事件</button>:null}
      {documentSchema?<button className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl bg-stone-50 p-2 text-xs font-medium text-stone-700 sm:text-sm" onClick={()=>setDoc(true)}><Upload className="size-6 text-emerald-700"/>上传档案</button>:null}
    </div>{!measureWrite&&!eventSchema&&!documentSchema?<p className={muted}>当前仅可查看已授权内容。</p>:null}</section>
    {readable?<section className={panel+' space-y-2'}><div className="flex items-center justify-between"><h2 className="font-semibold">最近测量</h2><button className="flex items-center gap-1 text-sm font-medium text-emerald-700" onClick={()=>go('健康指标')}>全部指标<ChevronRight className="size-4"/></button></div>{obs.items.slice(0,6).map(r=><button key={r.id} className="flex w-full items-center justify-between gap-2 border-b border-stone-100 py-3 text-left text-sm hover:bg-stone-50" onClick={()=>{selectMetric(r.metricId);go('健康指标');}}><span className="min-w-0"><span className="block font-medium">{known.get(r.metricId)??'健康指标'}</span><span className={muted}>{r.observedDate}</span></span><strong className="tabular-nums">{observationValue(r)} {r.unit}</strong></button>)}<ListStatus loading={obs.loading} error={obs.error} empty={!obs.items.length} retry={obs.reload}/>{metrics.error?<p role="alert" className={muted}>{metrics.error}</p>:null}</section>:null}
    <div className="grid grid-cols-2 gap-3">{([{tab:'健康事件',icon:CalendarDays,sub:'就诊、受伤与健康记录'},{tab:'健康档案',icon:FileText,sub:'体检、化验与原始资料'}] as const).filter(x=>modelAccess(models,x.tab==='健康事件'?'health_event':'health_document','read')).map(x=><button key={x.tab} className={panel+' flex items-center gap-3 text-left hover:bg-stone-50'} onClick={()=>go(x.tab)}><x.icon className="size-6 shrink-0 text-emerald-700"/><span className="min-w-0 flex-1"><span className="block font-medium">{x.tab}</span><span className="hidden text-xs text-stone-500 sm:block">{x.sub}</span></span><ChevronRight className="size-4 text-stone-400"/></button>)}</div>
    {growth&&height&&weight?<GrowthDialog spaceId={spaceId} personId={personId} timezone={timezone} height={height} weight={weight} close={()=>setGrowth(false)} saved={()=>{setGrowth(false);void obs.reload();}}/>:null}
    {event&&eventSchema?<EventDialog spaceId={spaceId} personId={personId} timezone={timezone} schema={eventSchema} close={()=>setEvent(false)} saved={()=>{setEvent(false);go('健康事件');}}/>:null}
    {doc&&documentSchema?<DocumentDialog spaceId={spaceId} personId={personId} timezone={timezone} schema={documentSchema} close={()=>setDoc(false)} saved={()=>{setDoc(false);go('健康档案');}}/>:null}
  </div>;
}
function HealthWorkspace() {
  const {currentFamily,members,user,loading}=useHousehold();
  const spaceId=currentFamily?.id??'';
  const [personId,setPersonId]=useState(''),[tab,setTab]=useState<Tab>('概览'),[selectedMetric,setSelectedMetric]=useState('');
  const [models,setModels]=useState<HealthRuntimeModel[]>([]),[accessLoading,setAccessLoading]=useState(true),[accessError,setAccessError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setModels([]);setAccessLoading(true);setAccessError('');
    if(!spaceId){setAccessLoading(false);return;}
    void readHealthRuntime(spaceId).then(m=>{if(active)setModels(m);}).catch(cause=>{if(active)setAccessError(message(cause));}).finally(()=>{if(active)setAccessLoading(false);});
    return()=>{active=false;};
  },[spaceId,revision]);
  // Definitions are family-wide, not per Person; only one mounted list per workspace.
  const metrics=useHealthList<HealthMetric>(spaceId,'health_metric','',undefined,'UTC',{limit:40},!accessLoading&&!accessError&&modelAccess(models,'health_metric','read'));
  const choices=members.filter(m=>!!m.personId&&/^per_[A-Za-z0-9_-]+$/.test(m.personId));
  const selected=choices.find(m=>m.personId===personId)??choices.find(m=>m.userId===user?.id)??choices[0];
  const read=(model:HealthModel)=>modelAccess(models,model,'read'),write=(model:HealthModel)=>currentFamily?.role!=='viewer'&&modelAccess(models,model,'write');
  const eventSchema=models.find(m=>m.key==='health_event'),documentSchema=models.find(m=>m.key==='health_document');
  const effectiveModels=currentFamily?.role==='viewer'?models.map(m=>({...m,access:m.access.filter(a=>a!=='write'&&a!=='manage')})):models;
  return <div className="space-y-4"><PageHeader title="健康"><button className={iconButton} onClick={()=>setRevision(v=>v+1)} aria-label="刷新健康数据"><RefreshCw className="size-4"/>刷新</button></PageHeader>
    {!currentFamily||!selected?.personId?<Empty>{loading?'正在加载家庭成员…':'请选择有有效成员身份的家庭。'}</Empty>:<>
      <section aria-label="选择家庭成员" className="flex flex-wrap gap-2 sm:gap-3">{choices.map(m=><button key={m.id} aria-pressed={selected.personId===m.personId} className={'flex min-w-16 max-w-28 flex-col items-center gap-1.5 rounded-xl px-2 py-2 text-xs sm:text-sm '+(selected.personId===m.personId?'bg-emerald-50 font-semibold text-emerald-900':'text-stone-600 hover:bg-stone-100')} onClick={()=>setPersonId(m.personId??'')}><MemberAvatar member={m} className={'size-11 text-base '+(selected.personId===m.personId?'bg-emerald-100 ring-2 ring-emerald-600 ring-offset-2 ring-offset-emerald-50':'bg-stone-200 text-stone-600')}/><span className="max-w-full truncate">{m.userId===user?.id?'我':m.displayName||'家庭成员'}</span></button>)}</section>
      <nav aria-label="健康模块" className="flex gap-2 border-b border-stone-200 sm:gap-5">{tabs.map(t=><button key={t} type="button" aria-current={t===tab?'page':undefined} className={'min-h-11 whitespace-nowrap border-b-2 px-2 text-sm sm:px-4 '+(t===tab?'border-emerald-700 font-semibold text-emerald-800':'border-transparent text-stone-500 hover:text-stone-900')} onClick={()=>setTab(t)}>{tabLabels[t]}</button>)}</nav>
      {accessLoading?<Empty>正在读取健康权限…</Empty>:accessError?<Empty>{accessError} <button className={button} onClick={()=>setRevision(v=>v+1)}>重试</button></Empty>:<div key={currentFamily.id+':'+selected.personId+':'+tab+':'+revision}>
        {tab==='概览'?<Overview spaceId={spaceId} personId={selected.personId} timezone={currentFamily.timezone} metrics={metrics} models={effectiveModels} go={setTab} selectMetric={setSelectedMetric}/>
        :tab==='健康指标'?(read('health_metric')&&read('health_observation')?<Metrics spaceId={spaceId} personId={selected.personId} timezone={currentFamily.timezone} metrics={metrics} selected={selectedMetric} setSelected={setSelectedMetric} canMeasure={write('health_observation')} canManage={write('health_metric')}/>:<Empty>当前没有健康指标访问权限。</Empty>)
        :tab==='健康事件'?(eventSchema&&read('health_event')?<Events spaceId={spaceId} personId={selected.personId} timezone={currentFamily.timezone} writable={write('health_event')} schema={eventSchema}/>:<Empty>当前没有健康事件访问权限。</Empty>)
        :documentSchema&&read('health_document')?<Documents spaceId={spaceId} personId={selected.personId} timezone={currentFamily.timezone} writable={write('health_document')} schema={documentSchema}/>:<Empty>当前没有健康档案访问权限。</Empty>}
      </div>}
    </>}
  </div>;
}
export function HealthPage() {
  const {currentFamily,user}=useHousehold();
  return <HealthWorkspace key={(user?.id??'none')+':'+(currentFamily?.id??'none')+':'+(currentFamily?.role??'none')}/>;
}
