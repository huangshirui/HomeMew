import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, CalendarClock, Clock3, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, Users, X } from 'lucide-react';
import { useHousehold } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/ui/page-header';
import { ModalScrollLock, showScrollbarWhileScrolling } from '../components/ui/modal-behavior';
import { Card } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { apiRequest } from '../lib/api-client';
import { householdErrorMessage } from '../lib/user-facing-error';
import { RecordIconField, emptyIconDraft, iconDraftFor, presentationToSave, type RecordIcon, type RecordIconDraft } from '../components/record-icon';

type DayKind = 'elapsed' | 'countdown' | 'cycle';
type DayStatus = 'active' | 'archived';
type DayRecord = {
  id: string;
  spaceId: string;
  modelKey: 'day_record';
  modelVersion: number;
  name: string;
  description: string | null;
  kind: DayKind;
  anchorDate: string;
  subjectPersonId: string | null;
  presentation?: { icon: RecordIcon | null };
  attentionAfterDays: number | null;
  attentionBeforeDays: number | null;
  cycleDays: number | null;
  status: DayStatus;
  computed?: {
    temporal?: {
      today: string;
      state: string;
      attentionLevel: 'none' | 'info' | 'warning' | 'critical';
      isAttentionRequired: boolean;
      elapsedDays?: number;
      remainingDays?: number | null;
      progressRatio?: number;
      nextDueDate?: string;
    };
  };
  version: number;
  createdAt: string;
  updatedAt: string;
};

type DayList = { items: DayRecord[]; nextCursor: string | null };
type DayDraft = {
  name: string;
  description: string;
  kind: DayKind;
  anchorDate: string;
  subjectPersonId: string;
  icon: RecordIconDraft;
  attentionDays: string;
  cycleDays: string;
};
type OccurrenceDraft = {
  record: DayRecord;
  occurredOn: string;
  note: string;
};

const inputClass = 'h-10 w-full rounded-2xl border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
const textareaClass = 'min-h-24 w-full resize-y rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
const KIND_COPY: Record<DayKind, { label: string; hint: string }> = {
  elapsed: { label: '已经多久', hint: '从某一天开始累计天数' },
  countdown: { label: '还有多久', hint: '倒数到某一天' },
  cycle: { label: '周期', hint: '按固定天数循环记录' },
};

function dateInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function messageOf(cause: unknown, fallback: string) {
  return householdErrorMessage(cause, fallback);
}

const iconImagePath = (spaceId: string, recordId: string, fileId: string) =>
  `/api/record-icons/spaces/${encodeURIComponent(spaceId)}/models/day_record/records/${encodeURIComponent(recordId)}/image?fileId=${encodeURIComponent(fileId)}`;

function recordIconEmoji(icon: RecordIcon | null | undefined): string {
  return icon?.type === 'emoji' ? icon.value : '';
}

function defaultDraft(today: string): DayDraft {
  return { name: '', description: '', kind: 'elapsed', anchorDate: today, subjectPersonId: '', icon: emptyIconDraft(), attentionDays: '', cycleDays: '' };
}

function draftFromRecord(record: DayRecord): DayDraft {
  return {
    name: record.name,
    description: record.description ?? '',
    kind: record.kind,
    anchorDate: record.anchorDate,
    subjectPersonId: record.subjectPersonId ?? '',
    icon: iconDraftFor(record.presentation?.icon),
    attentionDays: String(record.kind === 'elapsed' ? record.attentionAfterDays ?? '' : record.attentionBeforeDays ?? ''),
    cycleDays: String(record.cycleDays ?? ''),
  };
}

function parseOptionalInteger(raw: string, minimum: number, label: string) {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${label}必须是不小于 ${minimum} 的整数`);
  return value;
}

function createPayload(draft: DayDraft): Record<string, unknown> {
  const name = draft.name.trim();
  if (!name) throw new Error('请输入名称');
  if (!draft.anchorDate) throw new Error('请选择日期');
  const common = {
    name,
    description: draft.description.trim() || null,
    kind: draft.kind,
    anchorDate: draft.anchorDate,
    subjectPersonId: draft.subjectPersonId || null,
  };
  if (draft.kind === 'elapsed') return { ...common, attentionAfterDays: parseOptionalInteger(draft.attentionDays, 1, '提醒天数') };
  if (draft.kind === 'countdown') return { ...common, attentionBeforeDays: parseOptionalInteger(draft.attentionDays, 0, '提前提醒天数') };
  return {
    ...common,
    cycleDays: parseOptionalInteger(draft.cycleDays, 1, '周期天数'),
    attentionBeforeDays: parseOptionalInteger(draft.attentionDays, 0, '提前提醒天数'),
  };
}

function updatePayload(record: DayRecord, draft: DayDraft) {
  const name = draft.name.trim();
  if (!name) throw new Error('请输入名称');
  const common: Record<string, unknown> = {
    name,
    description: draft.description.trim() || null,
    subjectPersonId: draft.subjectPersonId || null,
  };
  if (record.kind === 'elapsed') common.attentionAfterDays = parseOptionalInteger(draft.attentionDays, 1, '提醒天数');
  if (record.kind === 'countdown') {
    common.anchorDate = draft.anchorDate;
    common.attentionBeforeDays = parseOptionalInteger(draft.attentionDays, 0, '提前提醒天数');
  }
  if (record.kind === 'cycle') {
    common.cycleDays = parseOptionalInteger(draft.cycleDays, 1, '周期天数');
    common.attentionBeforeDays = parseOptionalInteger(draft.attentionDays, 0, '提前提醒天数');
  }
  return common;
}

function primaryValue(record: DayRecord) {
  const computed = record.computed?.temporal;
  if (!computed) return '—';
  if (record.kind === 'elapsed') return `${computed.elapsedDays ?? 0} 天`;
  if (record.kind === 'countdown') {
    const value = computed.remainingDays ?? 0;
    if (value === 0) return '就是今天';
    return value > 0 ? `还有 ${value} 天` : `已过去 ${Math.abs(value)} 天`;
  }
  const value = computed.remainingDays ?? 0;
  if (value === 0) return '今天到期';
  return value > 0 ? `还有 ${value} 天` : `已超 ${Math.abs(value)} 天`;
}

function stateLabel(record: DayRecord) {
  const state = record.computed?.temporal?.state;
  const labels: Record<string, string> = {
    normal: '正常', threshold_reached: '已达到提醒', future: '未来', upcoming: '临近', today: '今天', past: '已过去', due: '到期', overdue: '逾期',
  };
  return state ? labels[state] ?? state : '';
}

export function DaysPage() {
  const { currentFamily, members, loading: householdLoading } = useHousehold();
  const [status, setStatus] = useState<DayStatus>('active');
  const [records, setRecords] = useState<DayRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [editing, setEditing] = useState<DayRecord | null>(null);
  const [draft, setDraft] = useState<DayDraft | null>(null);
  const [occurrence, setOccurrence] = useState<OccurrenceDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const canWrite = currentFamily ? currentFamily.role !== 'viewer' : false;
  const today = currentFamily ? dateInZone(currentFamily.timezone) : '';

  const loadRecords = useCallback(async () => {
    if (!currentFamily) {
      setRecords([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items: DayRecord[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ status, sort: status === 'active' ? 'attention:desc' : 'effectiveDate:desc', limit: '200' });
        if (cursor) params.set('cursor', cursor);
        const page = await apiRequest<DayList>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/day_record/records?${params}`);
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      setRecords(items);
    } catch (cause) {
      setRecords([]);
      setError(messageOf(cause, '无法加载日子'));
    } finally {
      setLoading(false);
    }
  }, [currentFamily, status]);

  useEffect(() => {
    void refreshToken;
    void loadRecords();
  }, [loadRecords, refreshToken]);

  useEffect(() => {
    setEditing(null);
    setDraft(null);
    setOccurrence(null);
  }, [currentFamily?.id]);

  const attentionCount = useMemo(() => records.filter((record) => record.computed?.temporal?.isAttentionRequired).length, [records]);

  function openCreate() {
    setEditing(null);
    setDraft(defaultDraft(today));
    setError(null);
  }

  function openEdit(record: DayRecord) {
    setEditing(record);
    setDraft(draftFromRecord(record));
    setError(null);
  }

  function closeEditor() {
    if (saving) return;
    setEditing(null);
    setDraft(null);
  }

  function openOccurrence(record: DayRecord) {
    if (!canWrite || record.kind === 'countdown') return;
    setOccurrence({ record, occurredOn: today, note: '' });
    setError(null);
  }

  function closeOccurrence() {
    if (occurrence && actingId === occurrence.record.id) return;
    setOccurrence(null);
  }

  async function saveRecord(event: FormEvent) {
    event.preventDefault();
    if (!currentFamily || !draft || !canWrite) return;
    setSaving(true);
    setError(null);
    try {
      // Optional Icon and business fields are committed in one governed Record mutation.
      const presentation = await presentationToSave(currentFamily.id, 'day_record', draft.icon, editing?.presentation?.icon);
      if (editing) {
        await apiRequest<DayRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/day_record/records/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...updatePayload(editing, draft), ...presentation, version: editing.version }),
        });
      } else {
        const payload = createPayload(draft);
        if (draft.kind === 'cycle' && payload.cycleDays === null) throw new Error('周期类型必须填写周期天数');
        await apiRequest<DayRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/day_record/records`, {
          method: 'POST', body: JSON.stringify({ ...payload, ...presentation }),
        });
      }
      setEditing(null);
      setDraft(null);
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, '保存失败'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord() {
    if (!currentFamily || !editing || !canWrite) return;
    if (!window.confirm(`删除“${editing.name}”？`)) return;
    setSaving(true);
    try {
      await apiRequest<void>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/day_record/records/${encodeURIComponent(editing.id)}`, {
        method: 'DELETE', body: JSON.stringify({ version: editing.version }),
      });
      setEditing(null);
      setDraft(null);
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, '删除失败'));
    } finally {
      setSaving(false);
    }
  }

  async function action(record: DayRecord, actionKey: 'archive' | 'restore') {
    if (!currentFamily || !canWrite) return;
    setActingId(record.id);
    setError(null);
    try {
      await apiRequest<DayRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/day_record/records/${encodeURIComponent(record.id)}/actions/${actionKey}`, {
        method: 'POST', body: JSON.stringify({ version: record.version }),
      });
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, actionKey === 'archive' ? '归档失败' : '恢复失败'));
    } finally {
      setActingId(null);
    }
  }

  async function submitOccurrence(event: FormEvent) {
    event.preventDefault();
    if (!currentFamily || !canWrite || !occurrence || !occurrence.occurredOn) return;
    const record = occurrence.record;
    setActingId(record.id);
    setError(null);
    try {
      await apiRequest<DayRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/day_record/records/${encodeURIComponent(record.id)}/actions/record-occurrence`, {
        method: 'POST',
        body: JSON.stringify({ version: record.version, occurredOn: occurrence.occurredOn, note: occurrence.note.trim() || null }),
      });
      setOccurrence(null);
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, '记录发生日期失败'));
    } finally {
      setActingId(null);
    }
  }

  if (householdLoading) return <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">正在加载日子…</Card>;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader title="日子"><Button variant="primary" disabled={!currentFamily || !canWrite} onClick={openCreate}><Plus className="size-4" /> 新建</Button></PageHeader>

      {!currentFamily ? <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">请先创建或加入一个家庭。</Card> : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-2xl bg-stone-100 p-1">
              <button type="button" className={`rounded-xl px-4 py-2 text-sm font-medium ${status === 'active' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`} onClick={() => setStatus('active')}>进行中</button>
              <button type="button" className={`rounded-xl px-4 py-2 text-sm font-medium ${status === 'archived' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`} onClick={() => setStatus('archived')}>已归档</button>
            </div>
            <div className="flex items-center gap-3 text-xs text-stone-500">
              {status === 'active' && attentionCount ? <span className="rounded-full bg-amber-50 px-3 py-1.5 font-medium text-amber-700 ring-1 ring-amber-100">{attentionCount} 项需要关注</span> : null}
              <Button variant="ghost" size="icon" aria-label="刷新" disabled={loading} onClick={() => setRefreshToken((value) => value + 1)}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /></Button>
            </div>
          </div>

          {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{error}</div> : null}
          {!loading && !records.length ? (
            <EmptyState
              icon={<CalendarClock className="size-5" />}
              title={status === 'active' ? '还没有日子记录' : '没有已归档记录'}
              description={status === 'active' ? '记录已经多久、还有多久，或者需要按周期关注的家庭事项。' : '归档的日子会保留在这里，方便以后恢复。'}
              actionLabel={status === 'active' && canWrite ? '新建日子' : undefined}
              onAction={status === 'active' && canWrite ? openCreate : undefined}
            />
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {records.map((record) => {
              const computed = record.computed?.temporal;
              const person = record.subjectPersonId ? members.find((member) => member.personId === record.subjectPersonId) : null;
              const attention = computed?.isAttentionRequired;
              return (
                <Card key={record.id} className={`p-5 ${attention ? 'ring-amber-200' : ''}`}>
                  <button type="button" className="block w-full text-left" onClick={() => openEdit(record)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-stone-900">{record.presentation?.icon?.type === 'image'
                            ? <img alt="" src={iconImagePath(record.spaceId, record.id, record.presentation!.icon!.fileId)} className="mr-2 inline size-6 rounded-md object-contain" />
                            : recordIconEmoji(record.presentation?.icon) ? `${recordIconEmoji(record.presentation?.icon)} ` : ''}{record.name}</p>
                        <p className="mt-1 text-xs text-stone-400">{KIND_COPY[record.kind].label} · {record.anchorDate}</p>
                      </div>
                      {attention ? <Sparkles className="size-4 shrink-0 text-amber-500" /> : null}
                    </div>
                    <p className={`mt-5 text-2xl font-semibold tracking-tight ${attention ? 'text-amber-700' : 'text-stone-900'}`}>{primaryValue(record)}</p>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-400">
                      {stateLabel(record) ? <span>{stateLabel(record)}</span> : null}
                      {computed?.nextDueDate ? <span>下次 {computed.nextDueDate}</span> : null}
                      {person ? <span><Users className="mr-1 inline size-3" />{person.displayName || person.userId}</span> : null}
                    </div>
                  </button>
                  {canWrite ? (
                    <div className="mt-4 flex gap-2 border-t border-stone-100 pt-3">
                      {record.status === 'active' && record.kind !== 'countdown' ? <Button variant="secondary" disabled={actingId === record.id} onClick={() => openOccurrence(record)}>记录一次</Button> : null}
                      <Button variant="ghost" disabled={actingId === record.id} onClick={() => void action(record, record.status === 'active' ? 'archive' : 'restore')}>
                        {record.status === 'active' ? <Archive className="size-4" /> : <RotateCcw className="size-4" />}{record.status === 'active' ? '归档' : '恢复'}
                      </Button>
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {draft ? <DayEditor draft={draft} spaceId={currentFamily?.id || ''} editing={editing} members={members.filter((member) => member.personId)} canWrite={canWrite} saving={saving} onChange={setDraft} onClose={closeEditor} onSave={saveRecord} onDelete={editing ? deleteRecord : undefined} /> : null}
      {occurrence ? <OccurrenceEditor value={occurrence} saving={actingId === occurrence.record.id} onChange={setOccurrence} onClose={closeOccurrence} onSave={submitOccurrence} /> : null}
    </div>
  );
}

function OccurrenceEditor({ value, saving, onChange, onClose, onSave }: {
  value: OccurrenceDraft;
  saving: boolean;
  onChange: (value: OccurrenceDraft) => void;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/30 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`记录 ${value.record.name} 的发生日期`}>
      <ModalScrollLock />
      <form onSubmit={onSave} className="w-full max-w-md rounded-t-3xl bg-stone-50 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700"><Clock3 className="size-5" /></span>
            <div>
              <p className="text-lg font-semibold text-stone-950">记录一次</p>
              <p className="mt-1 text-sm text-stone-500">{recordIconEmoji(value.record.presentation?.icon) ? `${recordIconEmoji(value.record.presentation?.icon)} ` : ''}{value.record.name}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭" disabled={saving} onClick={onClose}><X className="size-4" /></Button>
        </div>
        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">发生日期<input type="date" required className={inputClass} disabled={saving} value={value.occurredOn} onChange={(event) => onChange({ ...value, occurredOn: event.target.value })} /></label>
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">备注（可选）<textarea className={textareaClass} maxLength={5000} disabled={saving} value={value.note} onChange={(event) => onChange({ ...value, note: event.target.value })} placeholder="例如：已更换滤芯、完成保养……" /></label>
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-stone-200 pt-4">
          <Button variant="secondary" disabled={saving} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={saving || !value.occurredOn}>{saving ? '记录中…' : '确认记录'}</Button>
        </div>
      </form>
    </div>
  );
}

function DayEditor({ draft, spaceId, editing, members, canWrite, saving, onChange, onClose, onSave, onDelete }: {
  draft: DayDraft;
  spaceId: string;
  editing: DayRecord | null;
  members: ReturnType<typeof useHousehold>['members'];
  canWrite: boolean;
  saving: boolean;
  onChange: (draft: DayDraft) => void;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
  onDelete?: () => void;
}) {
  const readOnly = !canWrite || editing?.status === 'archived';
  const set = <K extends keyof DayDraft>(key: K, value: DayDraft[K]) => onChange({ ...draft, [key]: value });
  const anchorReadOnly = Boolean(editing && editing.kind !== 'countdown');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/30 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <ModalScrollLock />
      <form onScroll={showScrollbarWhileScrolling} onSubmit={onSave} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto overscroll-contain scrollbar-overlay rounded-t-3xl bg-stone-50 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-lg font-semibold text-stone-950">{editing ? (readOnly ? '日子详情' : '编辑日子') : '新建日子'}</p></div>
          <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}><X className="size-4" /></Button>
        </div>
        <div className="mt-5 grid gap-4">
          <div className="flex items-end gap-3">
            <RecordIconField icon={draft.icon} onChange={icon => set('icon', icon)} disabled={readOnly || saving}
              original={editing?.presentation?.icon} spaceId={spaceId} modelKey="day_record" recordId={editing?.id} />
            <label className="grid min-w-0 flex-1 gap-1.5 text-sm font-medium text-stone-700">名称
              <input className={inputClass} maxLength={100} disabled={readOnly} value={draft.name}
                onChange={(event) => set('name', event.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(KIND_COPY) as DayKind[]).map((kind) => <button key={kind} type="button" disabled={readOnly || Boolean(editing)} onClick={() => set('kind', kind)} className={`rounded-2xl px-3 py-3 text-left ring-1 ${draft.kind === kind ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-white text-stone-600 ring-stone-200'}`}><span className="block text-sm font-medium">{KIND_COPY[kind].label}</span><span className="mt-1 block text-[10px] leading-4 opacity-70">{KIND_COPY[kind].hint}</span></button>)}
          </div>
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">基准日期<input type="date" className={inputClass} disabled={readOnly || anchorReadOnly} value={draft.anchorDate} onChange={(event) => set('anchorDate', event.target.value)} /></label>
          {draft.kind === 'cycle' ? <label className="grid gap-1.5 text-sm font-medium text-stone-700">周期天数<input type="number" min="1" className={inputClass} disabled={readOnly} value={draft.cycleDays} onChange={(event) => set('cycleDays', event.target.value)} /></label> : null}
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">{draft.kind === 'elapsed' ? '经过多少天后提醒（可空）' : '提前多少天提醒（可空）'}<input type="number" min={draft.kind === 'elapsed' ? 1 : 0} className={inputClass} disabled={readOnly} value={draft.attentionDays} onChange={(event) => set('attentionDays', event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">关联成员<select className={inputClass} disabled={readOnly} value={draft.subjectPersonId} onChange={(event) => set('subjectPersonId', event.target.value)}><option value="">不关联成员</option>{members.map((member) => <option key={member.personId} value={member.personId}>{member.displayName || member.userId}</option>)}</select></label>
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">说明<textarea className={textareaClass} maxLength={5000} disabled={readOnly} value={draft.description} onChange={(event) => set('description', event.target.value)} /></label>
        </div>
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-stone-200 pt-4">
          <div>{onDelete && canWrite ? <Button variant="ghost" disabled={saving} onClick={onDelete}><Trash2 className="size-4" /> 删除</Button> : null}</div>
          <div className="flex gap-2"><Button variant="secondary" disabled={saving} onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>{!readOnly ? <Button type="submit" variant="primary" disabled={saving}>{saving ? '保存中…' : '保存'}</Button> : null}</div>
        </div>
      </form>
    </div>
  );
}
