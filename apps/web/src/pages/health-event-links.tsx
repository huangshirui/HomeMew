import { useEffect,useRef,useState } from 'react';
import { listHealthRelations,linkHealthEvent,unlinkHealthEvent,searchHealthTargets,type HealthRelation,type RelatedHealthTarget } from './health-domain';
const button='min-h-10 rounded-xl border border-stone-200 px-3 py-2 text-sm disabled:opacity-50';
function title(r:RelatedHealthTarget|undefined,label?:string) {return r?.summary||r?.name||(label&&!label.startsWith('rec_')?label:'名称暂不可用');}
function date(r:RelatedHealthTarget|undefined,timezone:string) {
  if(r?.when?.kind==='instant')return new Date(r.when.start).toLocaleString('zh-CN',{timeZone:timezone});
  return r?.when?.start||r?.dueDate||'';
}
export function HealthEventLinks({spaceId,eventId,writable,timezone}:{spaceId:string;eventId:string;writable:boolean;timezone:string}) {
  const [edges,setEdges]=useState<HealthRelation[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [model,setModel]=useState<'event'|'task'>('event'),[query,setQuery]=useState(''),[results,setResults]=useState<RelatedHealthTarget[]>([]),[next,setNext]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false);
  const generation=useRef(0);
  async function refresh(more=false) {
    const page=await listHealthRelations(spaceId,eventId,more?cursor:null);
    const visible=page.items.filter(e=>['event','task'].includes(e.target.modelKey));
    setEdges(old=>more?[...old,...visible.filter(e=>!old.some(x=>x.id===e.id))]:visible);setCursor(page.nextCursor);setReady(true);
  }
  useEffect(()=>{let active=true;void listHealthRelations(spaceId,eventId,null).then(p=>{if(active){setEdges(p.items.filter(e=>['event','task'].includes(e.target.modelKey)));setCursor(p.nextCursor);setReady(true);}}).catch(()=>{if(active)setError('关联读取失败，请关闭后重试。');});return()=>{active=false;generation.current++;};},[spaceId,eventId]);
  async function search(more=false) {
    if(!query.trim()||busy)return;
    const id=++generation.current;setBusy(true);setError('');
    try{const p=await searchHealthTargets(spaceId,model,query.trim(),more?next:null);if(id===generation.current){setResults(old=>more?[...old,...p.items.filter(r=>!old.some(x=>x.id===r.id))]:p.items);setNext(p.nextCursor);}}
    catch{if(id===generation.current)setError('搜索失败，请检查权限。');}
    finally{if(id===generation.current)setBusy(false);}
  }
  async function mutate(operation:()=>Promise<unknown>) {
    if(busy||!writable)return;setBusy(true);setError('');
    try{await operation();await refresh();}catch{setError('关联操作未完成或刷新失败，请重新打开确认结果。');}finally{setBusy(false);}
  }
  return <div className="space-y-3">
    {!ready&&!error?<p className="text-sm text-stone-500">正在加载关联…</p>:null}
    {ready&&!edges.length?<p className="text-sm text-stone-500">暂无已关联的日程或待办</p>:null}
    {edges.map(e=><div key={e.id} className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2"><div><p className="text-sm font-medium">{title(e.targetRecord,e.targetLabel)}</p><p className="text-xs text-stone-500">{e.target.modelKey==='event'?'日程':'待办'} · {date(e.targetRecord,timezone)}</p></div>{writable?<button className={button} disabled={busy} onClick={()=>{if(window.confirm('仅解除关联，不删除原记录。'))void mutate(()=>unlinkHealthEvent(spaceId,e.id));}}>解除</button>:null}</div>)}
    {cursor?<button className={button} disabled={busy} onClick={()=>{setBusy(true);void refresh(true).catch(()=>setError('加载失败')).finally(()=>setBusy(false));}}>加载更多关联</button>:null}
    {writable&&ready?<><form className="space-y-2" onSubmit={e=>{e.preventDefault();void search();}}><label className="block text-sm">关联类型<select disabled={busy} className={button+' w-full'} value={model} onChange={e=>{setModel(e.target.value as 'event'|'task');setResults([]);setNext(null);}}><option value="event">日程</option><option value="task">待办</option></select></label><label className="block text-sm">搜索已有内容<input className={button+' w-full'} disabled={busy} value={query} onChange={e=>{setQuery(e.target.value);setResults([]);setNext(null);}}/></label><button className={button} disabled={busy||!query.trim()} type="submit">搜索</button></form>{results.map(r=><div key={r.id} className="flex items-center justify-between gap-2"><div><p className="text-sm">{title(r)}</p><p className="text-xs text-stone-500">{date(r,timezone)}</p></div><button className={button} disabled={busy||edges.some(e=>e.target.modelKey===model&&e.target.recordId===r.id)} onClick={()=>void mutate(()=>linkHealthEvent(spaceId,eventId,model,r.id))}>关联</button></div>)}{next?<button className={button} disabled={busy} onClick={()=>void search(true)}>更多搜索结果</button>:null}</>:null}
    {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}
  </div>;
}
