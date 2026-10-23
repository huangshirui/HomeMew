import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, Check, Clock3, Gift, Pause, Play, Plus, RefreshCw, Target, Trash2, X } from 'lucide-react';
import { useHousehold } from '../components/household-provider';
import { ContainerRelations } from '../components/container-relations';
import { RecordIconField, RecordIconMark, emptyIconDraft, iconDraftFor, presentationToSave, type IconModel, type RecordIcon, type RecordIconDraft } from '../components/record-icon';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { showScrollbarWhileScrolling } from '../components/ui/modal-behavior';
import { useModalScrollLock } from '../lib/modal-scroll';
import { apiRequest } from '../lib/api-client';
import { householdErrorMessage } from '../lib/user-facing-error';
import { queryModelRecords } from '../lib/canonical-query';

type ModelKey = 'activity' | 'goal' | 'anniversary' | 'habit';
type Status = 'active' | 'paused' | 'achieved' | 'abandoned' | 'ended';
type DomainRecord = {
  id: string; spaceId: string; version: number; name: string; description?: string | null;
  presentation?: { icon?: RecordIcon | null }; status?: Status;
  attendeePersonIds?: string[]; subjectPersonIds?: string[]; personIds?: string[];
  startDate?: string | null; endDate?: string | null; targetDate?: string | null;
  subjectPersonId?: string; intervalDays?: number;
  month?: number; day?: number; year?: number | null;
  lastCheckInDate?: string | null;
  computed?: { checkIn?: { today: string; streakDays: number; checkedInToday: boolean } };
};
type Draft = {
  name: string; description: string; icon: RecordIconDraft;
  personIds: string[]; subjectPersonId: string; intervalDays: number;
  startDate: string; endDate: string; targetDate: string;
  month: string; day: string; year: string;
};
type HistoryItem = { id: string; checkedOn?: string; checkedOnDate?: string; recordedByNameSnapshot?: string };
const settings = {
  activity: { title: '活动', icon: CalendarDays, people: '参与人员', description: '组织家庭旅行、兴趣活动、比赛等持续性事项。' },
  goal: { title: '目标', icon: Target, people: '目标相关成员', description: '记录希望达成的结果，并跟踪状态。' },
  anniversary: { title: '纪念日', icon: Gift, people: '相关成员', description: '每年的特别日子，也会显示在日程中。' },
  habit: { title: '习惯', icon: Clock3, people: '习惯所属人', description: '为家人建立习惯；只有所属人可以打卡和管理。' },
} as const;
const statusText: Record<Status, string> = {
  active: '进行中', paused: '已暂停', achieved: '已达成', abandoned: '已放弃', ended: '已结束',
};
const inputClass = 'h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
const field = 'space-y-1.5 text-sm font-medium text-stone-700';
const blank = (): Draft => ({
  name: '', description: '', icon: emptyIconDraft(), personIds: [], subjectPersonId: '',
  intervalDays: 1, startDate: '', endDate: '', targetDate: '', month: '', day: '', year: '',
});
function draftFor(record: DomainRecord, key: ModelKey): Draft {
  return {
    name: record.name, description: record.description ?? '', icon: iconDraftFor(record.presentation?.icon),
    personIds: key === 'activity' ? record.attendeePersonIds ?? [] : key === 'goal' ? record.subjectPersonIds ?? [] : record.personIds ?? [],
    subjectPersonId: record.subjectPersonId ?? '', intervalDays: record.intervalDays ?? 1,
    startDate: record.startDate ?? '', endDate: record.endDate ?? '', targetDate: record.targetDate ?? '',
    month: record.month ? String(record.month) : '', day: record.day ? String(record.day) : '',
    year: record.year ? String(record.year) : '',
  };
}
export function validateAnniversary(month: number, day: number, year: number | null): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) return false;
  if (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999)) return false;
  // An unspecified original year must still allow February 29.
  const validationYear = year ?? 2024;
  const date = new Date(Date.UTC(validationYear, month - 1, day));
  return date.getUTCFullYear() === validationYear && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}
function payloadFor(key: ModelKey, draft: Draft, editing: boolean): Record<string, unknown> {
  if (!draft.name.trim()) throw new Error('请输入名称');
  const common = { name: draft.name.trim(), description: draft.description.trim() || null };
  if (key === 'activity') {
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) throw new Error('结束日期不能早于开始日期');
    return { ...common, attendeePersonIds: draft.personIds, startDate: draft.startDate || null, endDate: draft.endDate || null };
  }
  if (key === 'goal') return { ...common, subjectPersonIds: draft.personIds, startDate: draft.startDate || null, targetDate: draft.targetDate || null };
  if (key === 'habit') {
    if (editing) return common; // Both interval and owner are immutable.
    if (!draft.subjectPersonId) throw new Error('请选择习惯所属人');
    if (!Number.isInteger(draft.intervalDays) || draft.intervalDays < 1 || draft.intervalDays > 365) throw new Error('打卡间隔必须为 1–365 天');
    return { ...common, subjectPersonId: draft.subjectPersonId, intervalDays: draft.intervalDays };
  }
  const month = Number(draft.month), day = Number(draft.day);
  const year = draft.year === '' ? null : Number(draft.year);
  if (!validateAnniversary(month, day, year)) throw new Error('请输入有效的纪念日（2月29日仅适用于闰年）');
  return { ...common, month, day, year, personIds: draft.personIds };
}
function message(error: unknown): string {
  return householdErrorMessage(error, '操作失败，请稍后再试。');
}
function url(spaceId: string, key: ModelKey, recordId?: string): string {
  return `/api/lifespace/core/v1/spaces/${encodeURIComponent(spaceId)}/models/${key}/records${recordId ? '/' + encodeURIComponent(recordId) : ''}`;
}
async function loadRecords(spaceId: string, key: ModelKey, statusFilter: Status): Promise<DomainRecord[]> {
  const collected: DomainRecord[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const result: { items: DomainRecord[]; nextCursor: string | null } = await queryModelRecords<DomainRecord>(spaceId, key, {
      ...(key === 'goal' || key === 'habit' ? { filter: { field: 'status' as const, op: 'eq' as const, value: statusFilter } } : {}),
      sort: key === 'anniversary' ? [{ field: 'month', direction: 'asc' }, { field: 'day', direction: 'asc' }]
        : key === 'activity' ? [{ field: 'startDate', direction: 'desc' }]
          : key === 'goal' ? [{ field: 'targetDate', direction: 'asc' }] : [{ field: 'name', direction: 'asc' }],
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    collected.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) return collected;
  }
  throw new Error('记录数量超过当前页面的安全加载上限，请缩小范围或联系管理员');
}
function memberNames(ids: string[], names: Map<string, string>) {
  return ids.map(id => names.get(id) ?? '家庭成员').join('、');
}

export function DomainPage({ modelKey }: { modelKey: ModelKey }) {
  const { currentFamily, members, user, loading: householdLoading } = useHousehold();
  const [records, setRecords] = useState<DomainRecord[]>([]);
  const requestGeneration = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [statusFilter, setStatusFilter] = useState<Status>('active');
  const [editing, setEditing] = useState<DomainRecord | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyFor, setHistoryFor] = useState<DomainRecord | null>(null);
  const [containerFor, setContainerFor] = useState<DomainRecord | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  useModalScrollLock(Boolean(draft || historyFor || containerFor));
  const myPersonId = members.find(member => member.userId === user?.id)?.personId;
  const canCreate = Boolean(currentFamily && currentFamily.role !== 'viewer');
  const names = useMemo(() => new Map(members.filter(m => m.personId).map(m => [m.personId!, m.displayName || '家庭成员'])), [members]);
  const spec = settings[modelKey];
  const Icon = spec.icon;
  const visible = records; // Goal/Habit status filtering is performed by the indexed LifeSpace query.

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!currentFamily) { setRecords([]); return; }
    setLoading(true); setRecords([]); setError('');
    try {
      const next = await loadRecords(currentFamily.id, modelKey, statusFilter);
      if (generation === requestGeneration.current) setRecords(next);
    } catch (cause) {
      if (generation === requestGeneration.current) { setRecords([]); setError(message(cause)); }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [currentFamily?.id, modelKey, statusFilter]);
  useEffect(() => { void refresh; void reload(); return () => { requestGeneration.current += 1; }; }, [reload, refresh]);
  useEffect(() => { setEditing(null); setDraft(null); setHistoryFor(null); setContainerFor(null); setStatusFilter('active'); }, [currentFamily?.id, modelKey]);

  function newRecord() {
    const next = blank();
    next.subjectPersonId = myPersonId ?? '';
    setEditing(null); setDraft(next); setError('');
  }
  function edit(record: DomainRecord) {
    if (!canManage(record)) return;
    setEditing(record); setDraft(draftFor(record, modelKey)); setError('');
  }
  function canManage(record: DomainRecord) {
    return canCreate && (modelKey !== 'habit' || Boolean(myPersonId && myPersonId === record.subjectPersonId));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentFamily || !draft || !canCreate || (editing && !canManage(editing))) return;
    setBusy(true); setError('');
    try {
      const value = payloadFor(modelKey, draft, Boolean(editing));
      const presentation = await presentationToSave(currentFamily.id, modelKey as IconModel, draft.icon, editing?.presentation?.icon);
      await apiRequest(url(currentFamily.id, modelKey, editing?.id), {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...value, ...presentation, ...(editing ? { version: editing.version } : {}) }),
      });
      setDraft(null); setEditing(null); setRefresh(v => v + 1);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function remove(record: DomainRecord) {
    if (!currentFamily || !canManage(record) || !window.confirm(`删除“${record.name}”？`)) return;
    setBusy(true); setError('');
    try {
      await apiRequest(url(currentFamily.id, modelKey, record.id), { method: 'DELETE', body: JSON.stringify({ version: record.version }) });
      setDraft(null); setEditing(null); setRefresh(v => v + 1);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function action(record: DomainRecord, key: string) {
    if (!currentFamily || !canManage(record) || busy) return;
    setBusy(true); setError('');
    try {
      await apiRequest(`${url(currentFamily.id, modelKey, record.id)}/actions/${key}`, {
        method: 'POST', body: JSON.stringify({ version: record.version }),
      });
      setRefresh(v => v + 1);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function loadHistory(record: DomainRecord, cursor: string | null, append: boolean) {
    if (!currentFamily) return;
    setHistoryLoading(true); setHistoryError('');
    try {
      const p = new URLSearchParams({ limit: '100' }); if (cursor) p.set('cursor', cursor);
      const result = await apiRequest<{ items: HistoryItem[]; nextCursor: string | null }>(`${url(currentFamily.id, 'habit', record.id)}/check-ins?${p}`);
      setHistory(existing => append ? [...existing, ...result.items] : result.items);
      setHistoryCursor(result.nextCursor);
    } catch (cause) { setHistoryError(message(cause)); } finally { setHistoryLoading(false); }
  }
  if (householdLoading) return <Card className="p-8 text-sm text-stone-500">正在加载家庭信息…</Card>;
  return <div className="space-y-4">
    <PageHeader title={spec.title}>{canCreate ? <Button variant="primary" onClick={newRecord}><Plus className="size-4" /> 新建{spec.title}</Button> : null}</PageHeader>
    <p className="text-sm text-stone-500">{spec.description}</p>
    {modelKey === 'goal' || modelKey === 'habit' ? <div className="flex flex-wrap items-center gap-2">
      {(['active','paused',...(modelKey === 'goal' ? ['achieved','abandoned'] : ['ended'])] as Status[]).map(key =>
        <button key={key} type="button" aria-pressed={statusFilter === key} onClick={() => setStatusFilter(key)}
          className={`rounded-xl px-3 py-2 text-xs font-medium ${statusFilter === key ? 'bg-emerald-700 text-white' : 'bg-white text-stone-500 ring-1 ring-stone-200'}`}>
          {statusText[key]}
        </button>)}
    </div> : null}
    {error ? <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
    {!currentFamily ? <Card className="p-6 text-sm text-stone-500">请先选择家庭。</Card>
      : loading ? <Card className="p-6 text-sm text-stone-500">正在加载{spec.title}…</Card>
      : !visible.length ? <Card className="p-8 text-center text-sm text-stone-500">{modelKey === 'goal' || modelKey === 'habit' ? `暂无${statusText[statusFilter]}的${spec.title}` : `还没有${spec.title}记录。`}</Card>
      : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(record => <Card key={record.id} className="space-y-3 p-4">
          <div className="flex items-start gap-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              {record.presentation?.icon ? <RecordIconMark icon={record.presentation.icon} spaceId={currentFamily.id} modelKey={modelKey as IconModel} recordId={record.id} /> : <Icon className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="break-words font-semibold text-stone-900">{record.name}</h2>
              {record.status ? <span className="mt-1 inline-block rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{statusText[record.status]}</span> : null}
            </div>
          </div>
          {record.description ? <p className="line-clamp-2 text-sm text-stone-500">{record.description}</p> : null}
          {modelKey === 'anniversary' ? <p className="text-sm text-violet-700">🎁 {record.month}月{record.day}日{record.year ? ` · 始于 ${record.year} 年` : ''}</p>
            : modelKey === 'habit' ? <>
              <p className="text-sm text-stone-600">所属人：{record.subjectPersonId ? names.get(record.subjectPersonId) ?? '家庭成员' : '未关联'}</p>
              <p className="text-sm text-stone-600">每 {record.intervalDays ?? 1} 天打卡 · 连续 {record.computed?.checkIn?.streakDays ?? 0} 天</p>
            </> : <p className="text-sm text-stone-500">{record.startDate || '未设开始日'} {modelKey === 'activity' ? '→ ' + (record.endDate || '未设结束日') : '→ ' + (record.targetDate || '未设目标日')}</p>}
          {modelKey !== 'habit' && memberNames(modelKey === 'activity' ? record.attendeePersonIds ?? [] : modelKey === 'goal' ? record.subjectPersonIds ?? [] : record.personIds ?? [], names) ?
            <p className="text-xs text-stone-500">{memberNames(modelKey === 'activity' ? record.attendeePersonIds ?? [] : modelKey === 'goal' ? record.subjectPersonIds ?? [] : record.personIds ?? [], names)}</p> : null}
          <div className="flex flex-wrap gap-2 border-t border-stone-100 pt-3">
            {modelKey !== 'anniversary' ? <Button variant="secondary" onClick={() => setContainerFor(record)}>查看内容</Button> : null}
             {modelKey === 'habit' ? <Button variant="secondary" onClick={() => { setHistoryFor(record); setHistory([]); setHistoryCursor(null); void loadHistory(record, null, false); }}>打卡历史</Button> : null}
            {canManage(record) ? <>
              <Button variant="secondary" onClick={() => edit(record)}>编辑</Button>
              {modelKey === 'habit' && record.status === 'active' ?
                <Button variant="primary" disabled={busy || record.computed?.checkIn?.checkedInToday} onClick={() => void action(record,'check-in')}>
                  <Check className="size-4" />{record.computed?.checkIn?.checkedInToday ? '今日已打卡' : '打卡'}
                </Button> : null}
              {record.status === 'active' ? <Button variant="ghost" disabled={busy} onClick={() => void action(record, 'pause')}><Pause className="size-4" /> 暂停</Button> : null}
              {record.status === 'paused' ? <Button variant="ghost" disabled={busy} onClick={() => void action(record,'resume')}><Play className="size-4" /> 恢复</Button> : null}
              {modelKey === 'goal' && record.status && ['active','paused'].includes(record.status) ? <>
                <Button variant="ghost" disabled={busy} onClick={() => void action(record,'achieve')}>达成</Button>
                <Button variant="ghost" disabled={busy} onClick={() => void action(record,'abandon')}>放弃</Button>
              </> : null}
              {modelKey === 'habit' && ['active','paused'].includes(record.status ?? '') ? <Button variant="ghost" disabled={busy} onClick={() => void action(record,'end')}>结束</Button> : null}
              {record.status && (['achieved','abandoned','ended'].includes(record.status)) ?
                <Button variant="ghost" disabled={busy} onClick={() => void action(record,'reopen')}>重新开始</Button> : null}
            </> : modelKey === 'habit' ? <span className="text-xs text-stone-400">仅所属人可管理及打卡</span> : null}
          </div>
        </Card>)}
      </div>}
    <div className="flex justify-end"><Button variant="ghost" disabled={loading} onClick={() => setRefresh(v => v + 1)}><RefreshCw className="size-4" /> 刷新</Button></div>

    {containerFor && currentFamily && modelKey !== 'anniversary' ? <ContainerRelations key={`${modelKey}:${containerFor.id}`}
      spaceId={currentFamily.id} modelKey={modelKey} record={containerFor} timezone={currentFamily.timezone}
      writable={canManage(containerFor)} onClose={() => setContainerFor(null)} /> : null}
    {draft && currentFamily ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/45 sm:items-center sm:p-6"
      role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDraft(null); }}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-label={editing ? '编辑' + spec.title : '新建' + spec.title}
        onScroll={showScrollbarWhileScrolling}
        className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto overscroll-contain scrollbar-overlay rounded-t-3xl bg-white p-5 sm:rounded-3xl sm:p-6">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{editing ? '编辑' : '新建'}{spec.title}</h2>
          <button type="button" aria-label="关闭" onClick={() => setDraft(null)} disabled={busy}><X className="size-5" /></button>
        </div>
        <div className="flex items-center gap-3">
          <RecordIconField icon={draft.icon} onChange={icon => setDraft(d => d ? { ...d, icon } : d)}
            spaceId={currentFamily.id} modelKey={modelKey as IconModel} recordId={editing?.id} original={editing?.presentation?.icon} disabled={busy} />
          <label className={`${field} flex-1`}>名称 *<input className={inputClass} required maxLength={150} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        </div>
        <label className={`${field} block`}>说明<textarea value={draft.description} maxLength={5000} onChange={e => setDraft({ ...draft, description: e.target.value })}
          className="min-h-20 w-full rounded-xl border border-stone-200 p-3 text-sm" /></label>
        {modelKey === 'habit' ? <>
          <label className={`${field} block`}>习惯所属人 *<select className={inputClass} required disabled={Boolean(editing)} value={draft.subjectPersonId}
            onChange={e => setDraft({ ...draft, subjectPersonId: e.target.value })}>
            <option value="">选择家庭成员</option>{members.filter(m => m.personId).map(m => <option key={m.personId} value={m.personId}>{m.displayName || '家庭成员'}</option>)}
          </select></label>
          <label className={`${field} block`}>打卡间隔（天）<input type="number" min={1} max={365} required className={inputClass}
            disabled={Boolean(editing)} value={draft.intervalDays} onChange={e => setDraft({ ...draft, intervalDays: Number(e.target.value) })} /></label>
          <p className="text-xs leading-5 text-stone-500">允许为别人创建习惯；创建后所属人和间隔不可修改，只有所属人可打卡和修改。若该成员未关联账号，暂时无法本人打卡。</p>
        </> : <>
          <fieldset className="space-y-2"><legend className="text-sm font-medium text-stone-700">{spec.people}</legend>
            <div className="grid grid-cols-2 gap-2">{members.filter(m => m.personId).map(m => <label key={m.personId} className="flex items-center gap-2 rounded-xl bg-stone-50 p-2 text-sm">
              <input type="checkbox" checked={draft.personIds.includes(m.personId!)} onChange={e => setDraft({ ...draft, personIds: e.target.checked ? [...draft.personIds, m.personId!] : draft.personIds.filter(id => id !== m.personId) })} />
              {m.displayName || '家庭成员'}</label>)}</div>
          </fieldset>
          {modelKey === 'anniversary' ? <div className="grid grid-cols-3 gap-2">
            {(['month','day','year'] as const).map(k => <label key={k} className={field}>{k === 'month' ? '月份 *' : k === 'day' ? '日期 *' : '原始年份'}
              <input type="number" className={inputClass} required={k !== 'year'} min={k === 'month' ? 1 : k === 'day' ? 1 : 1}
                max={k === 'month' ? 12 : k === 'day' ? 31 : 9999} value={draft[k]} onChange={e => setDraft({ ...draft, [k]: e.target.value })} /></label>)}
          </div> : <div className="grid grid-cols-2 gap-2">
            <label className={field}>开始日期<input type="date" className={inputClass} value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></label>
            <label className={field}>{modelKey === 'activity' ? '结束日期' : '目标日期'}<input type="date" className={inputClass}
              value={modelKey === 'activity' ? draft.endDate : draft.targetDate}
              onChange={e => setDraft({ ...draft, [modelKey === 'activity' ? 'endDate' : 'targetDate']: e.target.value })} /></label>
          </div>}
        </>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 pt-4">
          {editing && canManage(editing) ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove(editing)}><Trash2 className="size-4" /> 删除</Button> : null}
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setDraft(null)}>取消</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? '正在保存…' : '保存'}</Button>
        </div>
      </form>
    </div> : null}
    {historyFor && currentFamily ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/45 sm:items-center sm:p-6" role="presentation"
      onMouseDown={e => { if (e.target === e.currentTarget) setHistoryFor(null); }}>
      <div role="dialog" aria-modal="true" aria-label="打卡历史" className="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <div className="flex items-center justify-between"><h2 className="font-semibold">{historyFor.name} · 打卡历史</h2>
          <Button variant="ghost" size="icon" onClick={() => setHistoryFor(null)} aria-label="关闭"><X className="size-4" /></Button></div>
        {historyError ? <p role="alert" className="text-sm text-red-600">{historyError}</p> : null}
        {history.map(entry => <div key={entry.id} className="rounded-xl bg-stone-50 p-3 text-sm">{entry.checkedOn ?? entry.checkedOnDate ?? '日期未知'} {entry.recordedByNameSnapshot ? ' · ' + entry.recordedByNameSnapshot : ''}</div>)}
        {!history.length && !historyLoading && !historyError ? <p className="text-sm text-stone-500">暂无打卡记录</p> : null}
        {historyCursor ? <Button variant="secondary" disabled={historyLoading} onClick={() => void loadHistory(historyFor, historyCursor, true)}>加载更多</Button> : null}
      </div>
    </div> : null}
  </div>;
}
