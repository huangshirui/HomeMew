import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Gift, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, UserRound, X } from 'lucide-react';
import { useHousehold } from '../components/household-provider';
import { RecordIconField, RecordIconMark, emptyIconDraft, iconDraftFor, presentationToSave, type RecordIcon, type RecordIconDraft } from '../components/record-icon';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/ui/page-header';
import { ModalScrollLock, showScrollbarWhileScrolling } from '../components/ui/modal-behavior';
import { Card } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { ApiError, apiRequest } from '../lib/api-client';
import { queryModelRecords, type CanonicalQueryPage } from '../lib/canonical-query';

type WishStatus = 'open' | 'fulfilled';
type WishRecord = {
  id: string;
  spaceId: string;
  modelKey: 'wish';
  presentation?: { icon: RecordIcon | null };
  modelVersion: number;
  title: string;
  description: string | null;
  desiredDate: string | null;
  status: WishStatus;
  ownerPersonId: string;
  fulfilledAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type WishDraft = { title: string; description: string; desiredDate: string; icon: RecordIconDraft };
type Tab = 'open' | 'fulfilled';

const inputClass = 'h-10 w-full rounded-2xl border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
const textareaClass = 'min-h-28 w-full resize-y rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';

function messageOf(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) return `${cause.message}${cause.requestId ? ` · ${cause.requestId}` : ''}`;
  return cause instanceof Error ? cause.message : fallback;
}

function draftFromWish(wish: WishRecord): WishDraft {
  return { title: wish.title, description: wish.description ?? '', desiredDate: wish.desiredDate ?? '', icon: iconDraftFor(wish.presentation?.icon) };
}

function payload(draft: WishDraft) {
  const title = draft.title.trim();
  if (!title) throw new Error('请输入愿望');
  return { title, description: draft.description.trim() || null, desiredDate: draft.desiredDate || null };
}

export function WishesPage() {
  const { currentFamily, members, user, loading: householdLoading } = useHousehold();
  const [tab, setTab] = useState<Tab>('open');
  const [wishes, setWishes] = useState<WishRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [editing, setEditing] = useState<WishRecord | null>(null);
  const [draft, setDraft] = useState<WishDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const currentPersonId = members.find((member) => member.userId === user?.id)?.personId ?? null;
  const canWrite = Boolean(currentFamily && currentFamily.role !== 'viewer' && currentPersonId);

  const loadWishes = useCallback(async () => {
    if (!currentFamily) {
      setWishes([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items: WishRecord[] = [];
      let cursor: string | null = null;
      do {
        const page: CanonicalQueryPage<WishRecord> = await queryModelRecords<WishRecord>(currentFamily.id, 'wish', {
          filter: { field: 'status', op: 'eq', value: tab },
          sort: [{
            field: tab === 'fulfilled' ? 'updatedAt' : 'desiredDate',
            direction: tab === 'fulfilled' ? 'desc' : 'asc',
          }],
          page: { limit: 200, cursor },
        });
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      setWishes(items);
    } catch (cause) {
      setWishes([]);
      setError(messageOf(cause, '无法加载许愿池'));
    } finally {
      setLoading(false);
    }
  }, [currentFamily, tab]);

  useEffect(() => {
    void refreshToken;
    void loadWishes();
  }, [loadWishes, refreshToken]);

  useEffect(() => {
    setEditing(null);
    setDraft(null);
  }, [currentFamily?.id]);

  function personName(personId: string | null) {
    if (!personId) return null;
    const member = members.find((item) => item.personId === personId);
    return member?.displayName || member?.userId || '家庭成员';
  }

  function openCreate() {
    if (!canWrite) return;
    setEditing(null);
    setDraft({ title: '', description: '', desiredDate: '', icon: emptyIconDraft() });
    setError(null);
  }

  function openEdit(wish: WishRecord) {
    setEditing(wish);
    setDraft(draftFromWish(wish));
    setError(null);
  }

  function closeEditor() {
    if (saving) return;
    setEditing(null);
    setDraft(null);
  }

  async function saveWish(event: FormEvent) {
    event.preventDefault();
    if (!currentFamily || !draft || !currentPersonId || !canWrite) return;
    setSaving(true);
    setError(null);
    try {
      const fields = { ...payload(draft), ...await presentationToSave(currentFamily.id, 'wish', draft.icon, editing?.presentation?.icon) };
      if (editing) {
        await apiRequest<WishRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/wish/records/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH', body: JSON.stringify({ ...fields, version: editing.version }),
        });
      } else {
        await apiRequest<WishRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/wish/records`, {
          method: 'POST', body: JSON.stringify({ ...fields, ownerPersonId: currentPersonId }),
        });
      }
      setEditing(null);
      setDraft(null);
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, '保存愿望失败'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteWish() {
    if (!currentFamily || !editing || !canWrite || editing.ownerPersonId !== currentPersonId) return;
    if (!window.confirm(`删除“${editing.title}”？`)) return;
    setSaving(true);
    try {
      await apiRequest<void>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/wish/records/${encodeURIComponent(editing.id)}`, {
        method: 'DELETE', body: JSON.stringify({ version: editing.version }),
      });
      setEditing(null);
      setDraft(null);
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, '删除愿望失败'));
    } finally {
      setSaving(false);
    }
  }

  async function action(wish: WishRecord, actionKey: 'fulfill' | 'reopen') {
    if (!currentFamily || !canWrite) return;
    setActingId(wish.id);
    setError(null);
    try {
      await apiRequest<WishRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/wish/records/${encodeURIComponent(wish.id)}/actions/${actionKey}`, {
        method: 'POST', body: JSON.stringify({ version: wish.version }),
      });
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, '操作愿望失败'));
    } finally {
      setActingId(null);
    }
  }

  if (householdLoading) return <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">正在加载许愿池…</Card>;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader title="许愿池"><Button variant="primary" disabled={!canWrite} onClick={openCreate}><Plus className="size-4" /> 写下愿望</Button></PageHeader>

      {!currentFamily ? <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">请先创建或加入一个家庭。</Card> : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-2xl bg-stone-100 p-1">
              <button type="button" className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === 'open' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`} onClick={() => setTab('open')}>愿望</button>
              <button type="button" className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === 'fulfilled' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`} onClick={() => setTab('fulfilled')}>已实现</button>
            </div>
            <Button variant="ghost" size="icon" aria-label="刷新" disabled={loading} onClick={() => setRefreshToken((value) => value + 1)}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /></Button>
          </div>

          {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{error}</div> : null}
          {!currentPersonId ? <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">当前 LifeSpace 用户尚未映射到这个家庭的 Space Person，暂时只能浏览。</div> : null}
          {!loading && !wishes.length ? (
            <EmptyState
              icon={<Gift className="size-5" />}
              title={tab === 'open' ? '还没有等待实现的愿望' : '还没有实现的愿望'}
              description={tab === 'open' ? '把想做、想要或想一起经历的小愿望先放进来。' : '愿望成真后，会作为一段家庭记忆留在这里。'}
              actionLabel={tab === 'open' && canWrite ? '写下第一个愿望' : undefined}
              onAction={tab === 'open' && canWrite ? openCreate : undefined}
            />
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {wishes.map((wish) => (
              <WishCard
                key={wish.id}
                wish={wish}
                currentPersonId={currentPersonId}
                canWrite={canWrite}
                acting={actingId === wish.id}
                ownerName={personName(wish.ownerPersonId) ?? '家庭成员'}
                onOpen={() => openEdit(wish)}
                onAction={(key) => void action(wish, key)}
              />
            ))}
          </div>
        </>
      )}

      {draft ? (
        <WishEditor
          draft={draft}
          spaceId={currentFamily?.id || ''}
          editing={editing}
          currentPersonId={currentPersonId}
          canWrite={canWrite}
          saving={saving}
          onChange={setDraft}
          onClose={closeEditor}
          onSave={saveWish}
          onDelete={editing ? deleteWish : undefined}
        />
      ) : null}
    </div>
  );
}

function WishCard({ wish, currentPersonId, canWrite, acting, ownerName, onOpen, onAction }: {
  wish: WishRecord;
  currentPersonId: string | null;
  canWrite: boolean;
  acting: boolean;
  ownerName: string;
  onOpen: () => void;
  onAction: (key: 'fulfill' | 'reopen') => void;
}) {
  const isOwner = wish.ownerPersonId === currentPersonId;
  const busy = acting;
  const fulfilled = wish.status === 'fulfilled';

  return (
    <Card className={`p-5 ${fulfilled ? 'border-amber-100 bg-gradient-to-br from-white to-amber-50/70' : ''}`}>
      <button type="button" className="block w-full text-left" onClick={onOpen}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="truncate font-semibold text-stone-900"><RecordIconMark icon={wish.presentation?.icon}
              spaceId={wish.spaceId} modelKey="wish" recordId={wish.id} className="mr-1" />{wish.title}</p><p className="mt-1 text-xs text-stone-400"><UserRound className="mr-1 inline size-3" />{ownerName}</p></div>
          {fulfilled ? <Sparkles className="size-5 shrink-0 text-amber-500" /> : <Gift className="size-5 shrink-0 text-pink-400" />}
        </div>
        {wish.description ? <p className="mt-4 line-clamp-3 text-sm leading-6 text-stone-500">{wish.description}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {wish.desiredDate ? <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600">希望 {wish.desiredDate}</span> : null}
          {fulfilled ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">愿望成真</span> : <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">等待实现</span>}
        </div>
      </button>
      {canWrite ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-stone-100 pt-3">
          {!fulfilled ? <Button variant="secondary" disabled={busy} onClick={() => onAction('fulfill')}><Sparkles className="size-4" /> 实现这个愿望</Button> : null}
          {fulfilled ? <Button variant="ghost" disabled={busy} onClick={() => onAction('reopen')}><RotateCcw className="size-4" /> 撤销实现</Button> : null}
          {isOwner ? <span className="ml-auto self-center text-[11px] text-stone-400">愿望主人可编辑内容</span> : null}
        </div>
      ) : null}
    </Card>
  );
}

function WishEditor({ draft, spaceId, editing, currentPersonId, canWrite, saving, onChange, onClose, onSave, onDelete }: {
  draft: WishDraft;
  spaceId: string;
  editing: WishRecord | null;
  currentPersonId: string | null;
  canWrite: boolean;
  saving: boolean;
  onChange: (draft: WishDraft) => void;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
  onDelete?: () => void;
}) {
  const isOwner = !editing || editing.ownerPersonId === currentPersonId;
  const editable = canWrite && isOwner;
  const set = <K extends keyof WishDraft>(key: K, value: WishDraft[K]) => onChange({ ...draft, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/30 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <ModalScrollLock />
      <form onScroll={showScrollbarWhileScrolling} onSubmit={onSave} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto overscroll-contain scrollbar-overlay rounded-t-3xl bg-stone-50 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-lg font-semibold text-stone-950">{editing ? (editable ? '编辑愿望' : '愿望详情') : '写下愿望'}</p>{editing ? <p className="mt-1 text-xs text-stone-500">{editing.status === 'fulfilled' ? '愿望成真' : '等待实现'} · 版本 {editing.version}</p> : null}</div>
          <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}><X className="size-4" /></Button>
        </div>
        <div className="mt-5 grid gap-4">
          <RecordIconField icon={draft.icon} onChange={icon => set('icon', icon)} disabled={!editable}
            original={editing?.presentation?.icon} spaceId={spaceId} modelKey="wish" recordId={editing?.id} />
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">愿望<input className={inputClass} maxLength={100} disabled={!editable} value={draft.title} onChange={(event) => set('title', event.target.value)} autoFocus={!editing} /></label>
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">希望日期（可空）<input type="date" className={inputClass} disabled={!editable} value={draft.desiredDate} onChange={(event) => set('desiredDate', event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">说明<textarea className={textareaClass} maxLength={5000} disabled={!editable} value={draft.description} onChange={(event) => set('description', event.target.value)} /></label>
          {editing && !isOwner ? <p className="rounded-2xl bg-stone-100 px-4 py-3 text-xs leading-5 text-stone-500">只有愿望主人可以编辑内容；愿望是否实现由拥有写权限的家庭成员共同维护。</p> : null}
        </div>
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-stone-200 pt-4">
          <div>{onDelete && canWrite && isOwner ? <Button variant="ghost" disabled={saving} onClick={onDelete}><Trash2 className="size-4" /> 删除</Button> : null}</div>
          <div className="flex gap-2"><Button variant="secondary" disabled={saving} onClick={onClose}>{editable ? '取消' : '关闭'}</Button>{editable ? <Button type="submit" variant="primary" disabled={saving}>{saving ? '保存中…' : '保存'}</Button> : null}</div>
        </div>
      </form>
    </div>
  );
}
