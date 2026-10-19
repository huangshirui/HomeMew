import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, CheckSquare2, Circle, Clock3, Plus, RefreshCw, RotateCcw, Search, Trash2, Users, X } from 'lucide-react';
import { useHousehold } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { ApiError, apiRequest } from '../lib/api-client';
import { queryModelRecords, type CanonicalQueryPage } from '../lib/canonical-query';

type TaskRecord = {
  id: string;
  spaceId: string;
  modelKey: 'task';
  modelVersion: number;
  name: string;
  description: string | null;
  dueDate: string | null;
  status: 'pending' | 'completed' | 'cancelled';
  assigneePersonIds: string[];
  completedAt: string | null;
  completedByType: 'user' | 'service' | 'device' | null;
  completedById: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type TaskDraft = { name: string; description: string; dueDate: string; assigneePersonIds: string[] };
type Tab = 'pending' | 'completed';

const inputClass = 'h-10 w-full rounded-2xl border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
const textareaClass = 'min-h-24 w-full resize-y rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';

function dateInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function messageOf(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) return `${cause.message}${cause.requestId ? ` · ${cause.requestId}` : ''}`;
  return cause instanceof Error ? cause.message : fallback;
}

function draftFromTask(task: TaskRecord): TaskDraft {
  return {
    name: task.name,
    description: task.description ?? '',
    dueDate: task.dueDate ?? '',
    assigneePersonIds: task.assigneePersonIds ?? [],
  };
}

function taskPayload(draft: TaskDraft) {
  const name = draft.name.trim();
  if (!name) throw new Error('请输入待办名称');
  return {
    name,
    description: draft.description.trim() || null,
    dueDate: draft.dueDate || null,
    assigneePersonIds: draft.assigneePersonIds,
  };
}

function dueLabel(task: TaskRecord, today: string) {
  if (!task.dueDate) return { text: '无截止日期', tone: 'muted' as const };
  if (task.status === 'pending' && task.dueDate < today) return { text: `已逾期 · ${task.dueDate}`, tone: 'danger' as const };
  if (task.dueDate === today) return { text: '今天截止', tone: 'today' as const };
  return { text: task.dueDate, tone: 'normal' as const };
}

export function TasksPage() {
  const { currentFamily, members, loading: householdLoading } = useHousehold();
  const [tab, setTab] = useState<Tab>('pending');
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<TaskRecord | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const canWrite = currentFamily ? currentFamily.role !== 'viewer' : false;
  const today = currentFamily ? dateInZone(currentFamily.timezone) : '';

  const loadTasks = useCallback(async () => {
    if (!currentFamily) {
      setTasks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items: TaskRecord[] = [];
      let cursor: string | null = null;
      do {
        const page: CanonicalQueryPage<TaskRecord> = await queryModelRecords<TaskRecord>(currentFamily.id, 'task', {
          ...(query ? { search: { text: query } } : {}),
          filter: { field: 'status', op: 'eq', value: tab },
          sort: [{
            field: tab === 'pending' ? 'dueDate' : 'updatedAt',
            direction: tab === 'pending' ? 'asc' : 'desc',
          }],
          page: { limit: 200, cursor },
        });
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      setTasks(items);
    } catch (cause) {
      setTasks([]);
      setError(messageOf(cause, '无法加载家庭待办'));
    } finally {
      setLoading(false);
    }
  }, [currentFamily, query, tab]);

  useEffect(() => {
    void refreshToken;
    void loadTasks();
  }, [loadTasks, refreshToken]);

  useEffect(() => {
    setEditing(null);
    setDraft(null);
    setQuery('');
    setQueryInput('');
  }, [currentFamily?.id]);

  const sections = useMemo(() => {
    if (tab === 'completed') return [{ key: 'completed', title: '已完成', items: tasks }];
    const overdue: TaskRecord[] = [];
    const todayTasks: TaskRecord[] = [];
    const upcoming: TaskRecord[] = [];
    const undated: TaskRecord[] = [];
    for (const task of tasks) {
      if (!task.dueDate) undated.push(task);
      else if (task.dueDate < today) overdue.push(task);
      else if (task.dueDate === today) todayTasks.push(task);
      else upcoming.push(task);
    }
    return [
      { key: 'overdue', title: '已逾期', items: overdue },
      { key: 'today', title: '今天', items: todayTasks },
      { key: 'upcoming', title: '接下来', items: upcoming },
      { key: 'undated', title: '没有日期', items: undated },
    ].filter((section) => section.items.length);
  }, [tab, tasks, today]);

  function openCreate() {
    setEditing(null);
    setDraft({ name: '', description: '', dueDate: '', assigneePersonIds: [] });
    setError(null);
  }

  function openEdit(task: TaskRecord) {
    setEditing(task);
    setDraft(draftFromTask(task));
    setError(null);
  }

  function closeEditor() {
    if (saving) return;
    setEditing(null);
    setDraft(null);
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault();
    if (!currentFamily || !draft || !canWrite) return;
    setSaving(true);
    setError(null);
    try {
      const payload = taskPayload(draft);
      if (editing) {
        await apiRequest<TaskRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/task/records/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, version: editing.version }),
        });
      } else {
        await apiRequest<TaskRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/task/records`, {
          method: 'POST',
          body: JSON.stringify({ ...payload, status: 'pending' }),
        });
      }
      setEditing(null);
      setDraft(null);
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, '保存待办失败'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask() {
    if (!currentFamily || !editing || !canWrite) return;
    if (!window.confirm(`删除“${editing.name}”？`)) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest<void>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/task/records/${encodeURIComponent(editing.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: editing.version }),
      });
      setEditing(null);
      setDraft(null);
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, '删除待办失败'));
    } finally {
      setSaving(false);
    }
  }

  async function runAction(task: TaskRecord, action: 'complete' | 'reopen') {
    if (!currentFamily || !canWrite) return;
    setActingId(task.id);
    setError(null);
    try {
      await apiRequest<TaskRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/task/records/${encodeURIComponent(task.id)}/actions/${action}`, {
        method: 'POST',
        body: JSON.stringify({ version: task.version }),
      });
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, action === 'complete' ? '完成待办失败' : '重新打开待办失败'));
    } finally {
      setActingId(null);
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery(queryInput.trim());
  }

  if (householdLoading) {
    return <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">正在加载家庭待办…</Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:items-end">
        <div>
          <div className="flex items-center gap-3 sm:block">
          <span className="grid size-10 shrink-0 sm:size-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><CheckSquare2 className="size-5" /></span>
          <h1 className="text-2xl sm:mt-4 sm:text-3xl font-semibold tracking-tight text-stone-950">家庭待办</h1>
        </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">直接使用 LifeSpace task 模型和 complete / reopen Actions。</p>
        </div>
        <Button variant="primary" disabled={!currentFamily || !canWrite} onClick={openCreate}><Plus className="size-4" /> 新建待办</Button>
      </div>

      {!currentFamily ? <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">请先创建或加入一个家庭。</Card> : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-2xl bg-stone-100 p-1">
              <button type="button" className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === 'pending' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`} onClick={() => setTab('pending')}>未完成</button>
              <button type="button" className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === 'completed' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`} onClick={() => setTab('completed')}>已完成</button>
            </div>
            <div className="flex gap-2">
              <form onSubmit={submitSearch} className="flex min-w-0 flex-1 items-center gap-2 sm:w-72">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                  <input className={`${inputClass} pl-9`} value={queryInput} maxLength={100} placeholder="搜索待办" onChange={(event) => setQueryInput(event.target.value)} />
                </div>
                <Button variant="secondary" type="submit">搜索</Button>
              </form>
              <Button variant="ghost" size="icon" aria-label="刷新" disabled={loading} onClick={() => setRefreshToken((value) => value + 1)}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /></Button>
            </div>
          </div>

          {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{error}</div> : null}

          {loading && !tasks.length ? <Card className="grid min-h-52 place-items-center p-8 text-sm text-stone-500">正在加载待办…</Card> : null}
          {!loading && !tasks.length ? (
            <EmptyState
              icon={<CheckSquare2 className="size-5" />}
              title={query ? '没有找到匹配的待办' : tab === 'pending' ? '暂时没有未完成待办' : '暂时没有已完成待办'}
              description={query ? '换个关键词试试，或者清除当前搜索。' : tab === 'pending' ? '现在没有需要处理的家庭待办。' : '完成过的待办会出现在这里。'}
              actionLabel={query ? '清除搜索' : tab === 'pending' && canWrite ? '新建待办' : undefined}
              onAction={query ? () => { setQueryInput(''); setQuery(''); } : tab === 'pending' && canWrite ? openCreate : undefined}
            />
          ) : null}

          <div className="space-y-5">
            {sections.map((section) => (
              <section key={section.key}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <h2 className="text-sm font-semibold text-stone-700">{section.title}</h2>
                  <span className="text-xs text-stone-400">{section.items.length}</span>
                </div>
                <Card className="divide-y divide-stone-100 overflow-hidden">
                  {section.items.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      today={today}
                      members={members}
                      canWrite={canWrite}
                      acting={actingId === task.id}
                      onOpen={() => openEdit(task)}
                      onAction={() => void runAction(task, task.status === 'completed' ? 'reopen' : 'complete')}
                    />
                  ))}
                </Card>
              </section>
            ))}
          </div>
        </>
      )}

      {draft ? (
        <TaskEditor
          draft={draft}
          editing={editing}
          members={members.filter((member) => member.personId)}
          canWrite={canWrite}
          saving={saving}
          onChange={setDraft}
          onClose={closeEditor}
          onSave={saveTask}
          onDelete={editing ? deleteTask : undefined}
        />
      ) : null}
    </div>
  );
}

function TaskRow({
  task,
  today,
  members,
  canWrite,
  acting,
  onOpen,
  onAction,
}: {
  task: TaskRecord;
  today: string;
  members: ReturnType<typeof useHousehold>['members'];
  canWrite: boolean;
  acting: boolean;
  onOpen: () => void;
  onAction: () => void;
}) {
  const due = dueLabel(task, today);
  const assignees = task.assigneePersonIds
    .map((personId) => members.find((member) => member.personId === personId)?.displayName)
    .filter(Boolean) as string[];

  return (
    <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
      <button
        type="button"
        disabled={!canWrite || acting}
        aria-label={task.status === 'completed' ? `重新打开 ${task.name}` : `完成 ${task.name}`}
        onClick={onAction}
        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border transition ${task.status === 'completed' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300 bg-white text-transparent hover:border-emerald-500 hover:text-emerald-500'} disabled:opacity-60`}
      >
        {task.status === 'completed' ? <Check className="size-4" /> : acting ? <RefreshCw className="size-3.5 animate-spin text-stone-400" /> : <Circle className="size-3" />}
      </button>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <p className={`truncate font-medium ${task.status === 'completed' ? 'text-stone-400 line-through' : 'text-stone-900'}`}>{task.name}</p>
        {task.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{task.description}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={due.tone === 'danger' ? 'font-medium text-red-600' : due.tone === 'today' ? 'font-medium text-amber-700' : 'text-stone-400'}><Clock3 className="mr-1 inline size-3.5" />{due.text}</span>
          {assignees.length ? <span className="text-stone-400"><Users className="mr-1 inline size-3.5" />{assignees.join('、')}</span> : null}
        </div>
      </button>
      {task.status === 'completed' && canWrite ? <Button variant="ghost" size="icon" aria-label="重新打开" disabled={acting} onClick={onAction}><RotateCcw className="size-4" /></Button> : null}
    </div>
  );
}

function TaskEditor({
  draft,
  editing,
  members,
  canWrite,
  saving,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: TaskDraft;
  editing: TaskRecord | null;
  members: ReturnType<typeof useHousehold>['members'];
  canWrite: boolean;
  saving: boolean;
  onChange: (draft: TaskDraft) => void;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
  onDelete?: () => void;
}) {
  const readOnly = !canWrite;
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => onChange({ ...draft, [key]: value });

  function togglePerson(personId: string) {
    set('assigneePersonIds', draft.assigneePersonIds.includes(personId)
      ? draft.assigneePersonIds.filter((id) => id !== personId)
      : [...draft.assigneePersonIds, personId]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={editing ? '编辑待办' : '新建待办'}>
      <form onSubmit={onSave} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-stone-50 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-stone-950">{editing ? (readOnly ? '待办详情' : '编辑待办') : '新建待办'}</p>
            {editing ? <p className="mt-1 text-xs text-stone-500">版本 {editing.version}</p> : null}
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}><X className="size-4" /></Button>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">待办名称<input className={inputClass} disabled={readOnly} maxLength={100} value={draft.name} onChange={(event) => set('name', event.target.value)} autoFocus={!editing} /></label>
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">截止日期<input type="date" className={inputClass} disabled={readOnly} value={draft.dueDate} onChange={(event) => set('dueDate', event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">说明<textarea className={textareaClass} disabled={readOnly} maxLength={5000} value={draft.description} onChange={(event) => set('description', event.target.value)} /></label>
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-stone-700"><Users className="size-3.5" /> 负责人</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {members.length ? members.map((member) => {
                const personId = member.personId!;
                const selected = draft.assigneePersonIds.includes(personId);
                return (
                  <button key={personId} type="button" disabled={readOnly} onClick={() => togglePerson(personId)} className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${selected ? 'bg-emerald-100 text-emerald-800 ring-emerald-200' : 'bg-white text-stone-600 ring-stone-200 hover:bg-stone-50'}`}>{member.displayName || member.userId}</button>
                );
              }) : <span className="text-xs text-stone-400">暂无可选择成员</span>}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
          <div>{onDelete && canWrite ? <Button variant="ghost" disabled={saving} onClick={onDelete}><Trash2 className="size-4" /> 删除</Button> : null}</div>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={saving} onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>
            {!readOnly ? <Button type="submit" variant="primary" disabled={saving}>{saving ? '保存中…' : '保存'}</Button> : null}
          </div>
        </div>
      </form>
    </div>
  );
}
