import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, CalendarClock, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, Users, X } from 'lucide-react';
import { useHousehold } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ApiError, apiRequest } from '../lib/api-client';

type DayKind = 'elapsed' | 'countdown' | 'cycle';
type DayStatus = 'active' | 'archived';
type DayRecord = {
  id: string; name: string; description: string | null; kind: DayKind; anchorDate: string;
  subjectPersonId: string | null; icon: string | null; attentionAfterDays: number | null;
  attentionBeforeDays: number | null; cycleDays: number | null; status: DayStatus; version: number;
  computed?: { temporal?: { state: string; isAttentionRequired: boolean; elapsedDays?: number; remainingDays?: number | null; nextDueDate?: string } };
};
type DayList = { items: DayRecord[]; nextCursor: string | null };
type DayDraft = { name: string; description: string; kind: DayKind; anchorDate: string; subjectPersonId: string; icon: string; attentionDays: string; cycleDays: string };

const inputClass = 'h-10 w-full rounded-2xl border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
const textareaClass = 'min-h-24 w-full resize-y rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
const KINDS: Record<DayKind, string> = { elapsed: '已经多久', countdown: '还有多久', cycle: '周期' };

function todayInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function message(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) return `${cause.message}${cause.requestId ? ` · ${cause.requestId}` : ''}`;
  return cause instanceof Error ? cause.message : fallback;
}
function integer(raw: string, minimum: number, label: string) {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${label}必须是不小于 ${minimum} 的整数`);
  return value;
}
function newDraft(today: string): DayDraft {
  return { name: '', description: '', kind: 'elapsed', anchorDate: today, subjectPersonId: '', icon: '', attentionDays: '', cycleDays: '' };
}
function editDraft(record: DayRecord): DayDraft {
  return {
    name: record.name, description: record.description ?? '', kind: record.kind, anchorDate: record.anchorDate,
    subjectPersonId: record.subjectPersonId ?? '', icon: record.icon ?? '',
    attentionDays: String(record.kind === 'elapsed' ? record.attentionAfterDays ?? '' : record.attentionBeforeDays ?? ''),
    cycleDays: String(record.cycleDays ?? ''),
  };
}
function common(draft: DayDraft): Record<string, unknown> {
  const name = draft.name.trim();
  if (!name) throw new Error('请输入名称');
  return { name, description: draft.description.trim() || null, subjectPersonId: draft.subjectPersonId || null, icon: draft.icon.trim() || null };
}
function createPayload(draft: DayDraft): Record<string, unknown> {
  if (!draft.anchorDate) throw new Error('请选择日期');
  const base = { ...common(draft), kind: draft.kind, anchorDate: draft.anchorDate };
  if (draft.kind === 'elapsed') return { ...base, attentionAfterDays: integer(draft.attentionDays, 1, '提醒天数') };
  if (draft.kind === 'countdown') return { ...base, attentionBeforeDays: integer(draft.attentionDays, 0, '提前提醒天数') };
  const cycleDays = integer(draft.cycleDays, 1, '周期天数');
  if (cycleDays === null) throw new Error('周期类型必须填写周期天数');
  return { ...base, cycleDays, attentionBeforeDays: integer(draft.attentionDays, 0, '提前提醒天数') };
}
function updatePayload(record: DayRecord, draft: DayDraft): Record<string, unknown> {
  const base = common(draft);
  if (record.kind === 'elapsed') return { ...base, attentionAfterDays: integer(draft.attentionDays, 1, '提醒天数') };
  if (record.kind === 'countdown') return { ...base, anchorDate: draft.anchorDate, attentionBeforeDays: integer(draft.attentionDays, 0, '提前提醒天数') };
  const cycleDays = integer(draft.cycleDays, 1, '周期天数');
  if (cycleDays === null) throw new Error('周期天数不能为空');
  return { ...base, cycleDays, attentionBeforeDays: integer(draft.attentionDays, 0, '提前提醒天数') };
}
function valueText(record: DayRecord) {
  const c = record.computed?.temporal;
  if (!c) return '—';
  if (record.kind === 'elapsed') return `${c.elapsedDays ?? 0} 天`;
  const days = c.remainingDays ?? 0;
  if (!days) return record.kind === 'countdown' ? '就是今天' : '今天到期';
  return days > 0 ? `还有 ${days} 天` : `${record.kind === 'countdown' ? '已过去' : '已超'} ${Math.abs(days)} 天`;
}

export function DaysPage() {
  const { currentFamily, members, loading: householdLoading } = useHousehold();
  const [status, setStatus] = useState<DayStatus>('active');
  const [records, setRecords] = useState<DayRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<DayRecord | null>(null);
  const [draft, setDraft] = useState<DayDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const canWrite = Boolean(currentFamily && currentFamily.role !== 'viewer');
  const today = currentFamily ? todayInZone(currentFamily.timezone) : '';

  const load = useCallback(async () => {
    if (!currentFamily) return setRecords([]);
    setLoading(true); setError(null);
    try {
      const all: DayRecord[] = []; let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ status, sort: status === 'active' ? 'attention:desc' : 'effectiveDate:desc', limit: '200' });
        if (cursor) params.set('cursor', cursor);
        const page = await apiRequest<DayList>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/day-records?${params}`);
        all.push(...page.items); cursor = page.nextCursor;
      } while (cursor);
      setRecords(all);
    } catch (cause) { setRecords([]); setError(message(cause, '无法加载日子')); }
    finally { setLoading(false); }
  }, [currentFamily, status]);
  useEffect(() => { void refresh; void load(); }, [load, refresh]);
  useEffect(() => { setEditing(null); setDraft(null); }, [currentFamily?.id]);
  const attention = useMemo(() => records.filter((record) => record.computed?.temporal?.isAttentionRequired).length, [records]);

  async function save(event: FormEvent) {
    event.preventDefault(); if (!currentFamily || !draft || !canWrite) return;
    setSaving(true); setError(null);
    try {
      if (editing) await apiRequest(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/day-records/${encodeURIComponent(editing.id)}`, { method: 'PATCH', body: JSON.stringify({ ...updatePayload(editing, draft), version: editing.version }) });
      else await apiRequest(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/day-records`, { method: 'POST', body: JSON.stringify(createPayload(draft)) });
      setEditing(null); setDraft(null); setRefresh((v) => v + 1);
    } catch (cause) { setError(message(cause, '保存失败')); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!currentFamily || !editing || !canWrite || !window.confirm(`删除“${editing.name}”？`)) return;
    setSaving(true);
    try {
      await apiRequest(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/day-records/${encodeURIComponent(editing.id)}`, { method: 'DELETE', body: JSON.stringify({ version: editing.version }) });
      setEditing(null); setDraft(null); setRefresh((v) => v + 1);
    } catch (cause) { setError(message(cause, '删除失败')); }
    finally { setSaving(false); }
  }
  async function run(record: DayRecord, key: 'archive' | 'restore' | 'record-occurrence') {
    if (!currentFamily || !canWrite) return;
    const occurredOn = key === 'record-occurrence' ? window.prompt('记录发生日期（YYYY-MM-DD）', today) : null;
    if (key === 'record-occurrence' && !occurredOn) return;
    setActing(record.id); setError(null);
    try {
      await apiRequest(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/day-records/${encodeURIComponent(record.id)}/actions/${key}`, { method: 'POST', body: JSON.stringify(key === 'record-occurrence' ? { version: record.version, occurredOn, note: null } : { version: record.version }) });
      setRefresh((v) => v + 1);
    } catch (cause) { setError(message(cause, '操作失败')); }
    finally { setActing(null); }
  }

  if (householdLoading) return <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">正在加载日子…</Card>;
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><span className="grid size-11 place-items-center rounded-2xl bg-amber-100 text-amber-700"><CalendarClock className="size-5" /></span><h1 className="mt-4 text-3xl font-semibold tracking-tight">日子</h1><p className="mt-2 text-sm text-stone-500">直接使用 LifeSpace Temporal capability。</p></div>
      <Button variant="primary" disabled={!canWrite} onClick={() => { setEditing(null); setDraft(newDraft(today)); }}><Plus className="size-4" /> 新建</Button>
    </div>
    {!currentFamily ? <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">请先创建或加入一个家庭。</Card> : <>
      <div className="flex items-center justify-between gap-3"><div className="inline-flex rounded-2xl bg-stone-100 p-1"><button type="button" className={`rounded-xl px-4 py-2 text-sm font-medium ${status === 'active' ? 'bg-white shadow-sm' : 'text-stone-500'}`} onClick={() => setStatus('active')}>进行中</button><button type="button" className={`rounded-xl px-4 py-2 text-sm font-medium ${status === 'archived' ? 'bg-white shadow-sm' : 'text-stone-500'}`} onClick={() => setStatus('archived')}>已归档</button></div><div className="flex items-center gap-3 text-xs text-stone-500">{status === 'active' && attention ? <span>{attention} 项需要关注</span> : null}<Button variant="ghost" size="icon" disabled={loading} onClick={() => setRefresh((v) => v + 1)}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /></Button></div></div>
      {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {!loading && !records.length ? <Card className="grid min-h-52 place-items-center p-8 text-sm text-stone-500">暂无记录。</Card> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{records.map((record) => {
        const c = record.computed?.temporal; const person = members.find((m) => m.personId === record.subjectPersonId);
        return <Card key={record.id} className={`p-5 ${c?.isAttentionRequired ? 'ring-amber-200' : ''}`}>
          <button type="button" className="block w-full text-left" onClick={() => { setEditing(record); setDraft(editDraft(record)); }}><div className="flex justify-between gap-3"><div><p className="font-semibold text-stone-900">{record.icon ? `${record.icon} ` : ''}{record.name}</p><p className="mt-1 text-xs text-stone-400">{KINDS[record.kind]} · {record.anchorDate}</p></div>{c?.isAttentionRequired ? <Sparkles className="size-4 text-amber-500" /> : null}</div><p className="mt-5 text-2xl font-semibold text-stone-900">{valueText(record)}</p><div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-400">{c?.nextDueDate ? <span>下次 {c.nextDueDate}</span> : null}{person ? <span><Users className="mr-1 inline size-3" />{person.displayName || person.userId}</span> : null}</div></button>
          {canWrite ? <div className="mt-4 flex gap-2 border-t border-stone-100 pt-3">{record.status === 'active' && record.kind !== 'countdown' ? <Button variant="secondary" disabled={acting === record.id} onClick={() => void run(record, 'record-occurrence')}>记录一次</Button> : null}<Button variant="ghost" disabled={acting === record.id} onClick={() => void run(record, record.status === 'active' ? 'archive' : 'restore')}>{record.status === 'active' ? <Archive className="size-4" /> : <RotateCcw className="size-4" />}{record.status === 'active' ? '归档' : '恢复'}</Button></div> : null}
        </Card>;
      })}</div>
    </>}
    {draft ? <DayEditor draft={draft} editing={editing} members={members.filter((m) => m.personId)} canWrite={canWrite} saving={saving} onChange={setDraft} onClose={() => { if (!saving) { setEditing(null); setDraft(null); } }} onSave={save} onDelete={editing ? remove : undefined} /> : null}
  </div>;
}

function DayEditor({ draft, editing, members, canWrite, saving, onChange, onClose, onSave, onDelete }: { draft: DayDraft; editing: DayRecord | null; members: ReturnType<typeof useHousehold>['members']; canWrite: boolean; saving: boolean; onChange: (value: DayDraft) => void; onClose: () => void; onSave: (event: FormEvent) => void; onDelete?: () => void }) {
  const readOnly = !canWrite || editing?.status === 'archived'; const set = <K extends keyof DayDraft>(key: K, value: DayDraft[K]) => onChange({ ...draft, [key]: value });
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/30 backdrop-blur-[2px] sm:items-center sm:p-6"><form onSubmit={onSave} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-stone-50 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
    <div className="flex justify-between"><div><p className="text-lg font-semibold">{editing ? (readOnly ? '日子详情' : '编辑日子') : '新建日子'}</p>{editing ? <p className="mt-1 text-xs text-stone-500">版本 {editing.version}</p> : null}</div><Button variant="ghost" size="icon" onClick={onClose}><X className="size-4" /></Button></div>
    <div className="mt-5 grid gap-4"><label className="grid gap-1.5 text-sm font-medium">名称<input className={inputClass} disabled={readOnly} value={draft.name} maxLength={100} onChange={(e) => set('name', e.target.value)} /></label><div className="grid grid-cols-3 gap-2">{(Object.keys(KINDS) as DayKind[]).map((kind) => <button key={kind} type="button" disabled={readOnly || Boolean(editing)} onClick={() => set('kind', kind)} className={`rounded-2xl px-3 py-3 text-sm ring-1 ${draft.kind === kind ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-white text-stone-600 ring-stone-200'}`}>{KINDS[kind]}</button>)}</div><label className="grid gap-1.5 text-sm font-medium">基准日期<input type="date" className={inputClass} disabled={readOnly || Boolean(editing && editing.kind !== 'countdown')} value={draft.anchorDate} onChange={(e) => set('anchorDate', e.target.value)} /></label>{draft.kind === 'cycle' ? <label className="grid gap-1.5 text-sm font-medium">周期天数<input type="number" min="1" className={inputClass} disabled={readOnly} value={draft.cycleDays} onChange={(e) => set('cycleDays', e.target.value)} /></label> : null}<label className="grid gap-1.5 text-sm font-medium">{draft.kind === 'elapsed' ? '经过多少天后提醒' : '提前多少天提醒'}<input type="number" min={draft.kind === 'elapsed' ? 1 : 0} className={inputClass} disabled={readOnly} value={draft.attentionDays} onChange={(e) => set('attentionDays', e.target.value)} /></label><label className="grid gap-1.5 text-sm font-medium">图标<input className={inputClass} disabled={readOnly} value={draft.icon} maxLength={50} onChange={(e) => set('icon', e.target.value)} /></label><label className="grid gap-1.5 text-sm font-medium">关联成员<select className={inputClass} disabled={readOnly} value={draft.subjectPersonId} onChange={(e) => set('subjectPersonId', e.target.value)}><option value="">不关联</option>{members.map((m) => <option key={m.personId} value={m.personId}>{m.displayName || m.userId}</option>)}</select></label><label className="grid gap-1.5 text-sm font-medium">说明<textarea className={textareaClass} disabled={readOnly} value={draft.description} maxLength={5000} onChange={(e) => set('description', e.target.value)} /></label></div>
    <div className="mt-6 flex justify-between border-t border-stone-200 pt-4"><div>{onDelete && canWrite ? <Button variant="ghost" disabled={saving} onClick={onDelete}><Trash2 className="size-4" /> 删除</Button> : null}</div><div className="flex gap-2"><Button variant="secondary" disabled={saving} onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>{!readOnly ? <Button type="submit" variant="primary" disabled={saving}>{saving ? '保存中…' : '保存'}</Button> : null}</div></div>
  </form></div>;
}
