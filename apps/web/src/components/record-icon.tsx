import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, Plus, Search, X } from 'lucide-react';
import { EMOJI_GROUPS } from '../../../miniprogram/miniprogram/components/record-icon-picker/emoji-data';

export type IconModel = 'day_record' | 'event' | 'task' | 'wish' | 'activity' | 'goal' | 'habit' | 'anniversary' | 'person_group';
export type RecordIcon = { type: 'emoji'; value: string } | { type: 'image'; fileId: string };
export type RecordIconDraft = {
  iconEmoji: string;
  iconFileId: string;
  iconFile: File | null;
};

const PAGE_SIZE = 72;
const POPULAR = ['🎉', '❤️', '🏠', '⚽', '📅', '📚', '🎂', '🎁', '✈️', '🎯', '💡', '✅', '⭐', '🍀', '🎵', '💻', '🏆', '🏃', '🍎', '🐱', '🌻', '🚗', '🏫', '👨‍👩‍👧', '🎮', '💰', '🔔', '🧹'];
const CATEGORIES = [{ key: 'popular', title: '常用' }, ...EMOJI_GROUPS.map(({ key, title }) => ({ key, title }))];
const SEARCH_ALIASES: Record<string, string> = {
  '足球': 'soccer', '篮球': 'basketball', '排球': 'volleyball', '运动': 'sport',
  '生日': 'birthday', '派对': 'party', '蛋糕': 'cake', '礼物': 'gift',
  '书': 'book', '阅读': 'book', '学习': 'school', '学校': 'school',
  '旅游': 'travel', '旅行': 'airplane', '飞机': 'airplane', '汽车': 'car',
  '猫': 'cat', '狗': 'dog', '花': 'flower', '树': 'tree', '食物': 'food',
  '吃饭': 'meal', '汉堡': 'hamburger', '咖啡': 'coffee', '爱心': 'heart',
  '开心': 'smile', '哭': 'crying', '笑': 'laugh', '星星': 'star',
  '旗': 'flag', '国旗': 'flag', '工作': 'office', '电脑': 'computer',
  '手机': 'mobile phone', '家庭': 'family', '房子': 'house',
  '完成': 'check mark', '提醒': 'bell', '金钱': 'money',
  '医生': 'doctor', '音乐': 'music', '奖杯': 'trophy',
  '天气': 'weather', '太阳': 'sun', '月亮': 'moon',
};

export function findRecordEmojis(category: string, search: string): readonly (readonly [string, string])[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) {
    if (category === 'popular') return POPULAR.map(emoji => [emoji, ''] as const);
    return EMOJI_GROUPS.find(group => group.key === category)?.entries ?? [];
  }
  const term = SEARCH_ALIASES[query] ?? query;
  return EMOJI_GROUPS.flatMap(group => group.entries.filter(([emoji, name]) =>
    emoji.includes(query) || name.toLocaleLowerCase().includes(term) || group.title.includes(query),
  ));
}

export function emptyIconDraft(): RecordIconDraft {
  return { iconEmoji: '', iconFileId: '', iconFile: null };
}

export function iconDraftFor(icon?: RecordIcon | null): RecordIconDraft {
  return {
    iconEmoji: icon?.type === 'emoji' ? icon.value : '',
    iconFileId: icon?.type === 'image' ? icon.fileId : '',
    iconFile: null,
  };
}

export function recordIconSrc(spaceId: string, modelKey: IconModel, recordId: string): string {
  return `/api/record-icons/spaces/${encodeURIComponent(spaceId)}/models/${modelKey}/records/${encodeURIComponent(recordId)}/image`;
}

const MAX_ICON_BYTES = 256 * 1024;
const MAX_ICON_DIMENSION = 512;

async function prepareIconImage(file: File): Promise<Blob> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('只支持 PNG、JPEG、WebP 图片');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('无法读取图片，请选择有效的 PNG、JPEG 或 WebP 文件');
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (!longest) throw new Error('图片尺寸无效');
    if (longest <= MAX_ICON_DIMENSION && file.size > 0 && file.size <= MAX_ICON_BYTES) return file;
    const ratio = Math.min(1, MAX_ICON_DIMENSION / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.floor(bitmap.height * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法处理图片');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // WebP retains transparency and is within the Core's allowed static formats.
    for (const quality of [0.82, 0.66, 0.5]) {
      const blob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(resolve, 'image/webp', quality),
      );
      if (blob?.type === 'image/webp' && blob.size > 0 && blob.size <= MAX_ICON_BYTES) return blob;
    }
    throw new Error('图片压缩后仍超过 256 KiB，请裁剪后重试');
  } finally {
    bitmap.close();
  }
}

async function uploadIcon(spaceId: string, modelKey: IconModel, file: File): Promise<string> {
  // File upload is separate, but optional presentation is committed with the
  // business fields in a single governed Record Create/Update.
  const image = await prepareIconImage(file);
  const response = await fetch(
    `/api/record-icons/spaces/${encodeURIComponent(spaceId)}/models/${modelKey}/image`, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': image.type }, body: image,
    },
  );
  const result = await response.json().catch(() => ({})) as { data?: { fileId?: string }, error?: { message?: string } };
  if (!response.ok || !result.data?.fileId) throw new Error(result.error?.message || '上传图标失败');
  return result.data.fileId;
}

/** Omit metadata entirely unless a newly selected/changed Icon exists. */
export async function presentationToSave(
  spaceId: string, modelKey: IconModel, draft: RecordIconDraft,
  existing?: RecordIcon | null,
): Promise<{ presentation?: { icon: RecordIcon | null } }> {
  let icon: RecordIcon | null = draft.iconEmoji.trim() ? { type: 'emoji', value: draft.iconEmoji.trim() } : null;
  if (draft.iconFileId) icon = { type: 'image', fileId: draft.iconFileId };
  if (draft.iconFile) icon = { type: 'image', fileId: await uploadIcon(spaceId, modelKey, draft.iconFile) };
  const unchanged = JSON.stringify(icon) === JSON.stringify(existing ?? null);
  return unchanged ? {} : { presentation: { icon } };
}

export function RecordIconMark({ icon, spaceId, modelKey, recordId, className = '' }: {
  icon?: RecordIcon | null;
  spaceId: string;
  modelKey: IconModel;
  recordId: string;
  className?: string;
}): ReactNode {
  if (icon?.type === 'emoji') return <span aria-hidden="true" className={className}>{icon.value}</span>;
  if (icon?.type === 'image') return <img alt="" aria-hidden="true"
    src={recordIconSrc(spaceId, modelKey, recordId)}
    className={`inline size-5 shrink-0 rounded-md object-contain ${className}`} />;
  return null;
}


export function RecordIconField({ icon, onChange, disabled, original, spaceId, modelKey, recordId }: {
  icon: RecordIconDraft;
  onChange: (value: RecordIconDraft) => void;
  disabled?: boolean;
  original?: RecordIcon | null;
  spaceId: string;
  modelKey: IconModel;
  recordId?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('popular');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [preview, setPreview] = useState<string | null>(null);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedEmoji = icon.iconEmoji;
  const results = useMemo(() => findRecordEmojis(category, search), [category, search]);
  const currentImage = icon.iconFileId && original?.type === 'image' && recordId
    ? recordIconSrc(spaceId, modelKey, recordId) : null;

  useEffect(() => {
    if (!icon.iconFile) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(icon.iconFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [icon.iconFile]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('keydown', escape, true);
      triggerRef.current?.focus();
    };
  }, [open]);

  function pick(next: RecordIconDraft) {
    onChange(next);
    setOpen(false);
  }

  function selectCategory(key: string) {
    setCategory(key);
    setSearch('');
    setShown(PAGE_SIZE);
  }

  return <>
    <button ref={triggerRef} type="button" disabled={disabled}
      aria-label={selectedEmoji || icon.iconFile || icon.iconFileId ? '更换记录图标' : '添加记录图标'}
      title={selectedEmoji || icon.iconFile || icon.iconFileId ? '更换图标' : '添加图标'}
      onClick={() => { setCategory('popular'); setSearch(''); setShown(PAGE_SIZE); setOpen(true); }}
      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-emerald-200 bg-emerald-50 text-2xl text-emerald-700 transition hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
      {preview || currentImage
        ? <img src={preview || currentImage || ''} alt="" className="size-full object-contain" />
        : selectedEmoji || (icon.iconFileId ? <ImagePlus className="size-5" /> : <Plus className="size-5" />)}
    </button>

    {open && typeof document !== 'undefined' ? createPortal(
      <div className="fixed inset-0 z-[100] flex items-end justify-center bg-stone-950/55 p-0 sm:items-center sm:p-6"
        onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div role="dialog" aria-modal="true" aria-labelledby={titleId}
          className="flex h-[min(78dvh,650px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          onMouseDown={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled])',
            ));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}>
          <div className="flex items-start justify-between border-b border-stone-100 px-5 py-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold text-stone-900">选择图标</h2>
              <p className="mt-1 text-xs text-stone-500">Emoji 或图片 · 选填</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭图标选择器"
              className="rounded-xl p-2 text-stone-500 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-500">
              <X className="size-4" />
            </button>
          </div>
          <div role="tablist" aria-label="Emoji 分类" className="flex shrink-0 gap-1 overflow-x-auto border-b border-stone-100 px-3">
            {CATEGORIES.map(item => <button key={item.key} type="button" role="tab"
              aria-selected={!search && category === item.key}
              onClick={() => selectCategory(item.key)}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-xs font-medium transition ${!search && category === item.key
                ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-stone-500 hover:text-stone-800'}`}>
              {item.title}
            </button>)}
          </div>
          <div className="px-4 pt-3">
            <label className="flex items-center gap-2 rounded-xl bg-stone-100 px-3 py-2">
              <Search className="size-4 text-stone-400" />
              <input ref={searchRef} type="search" value={search}
                onChange={event => { setSearch(event.target.value); setShown(PAGE_SIZE); }}
                placeholder="搜索 Emoji，例如 足球 / soccer" aria-label="搜索 Emoji"
                className="w-full bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-400" />
            </label>
            <div className="flex justify-between px-1 py-3 text-xs text-stone-500">
              <span>{search ? '搜索结果' : CATEGORIES.find(item => item.key === category)?.title}</span>
              <span>{Math.min(shown, results.length)} / {results.length}</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
            onScroll={event => {
              const el = event.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 140 && shown < results.length) {
                setShown(value => Math.min(value + PAGE_SIZE, results.length));
              }
            }}>
            {results.length ? <div className="grid grid-cols-7 gap-1 sm:grid-cols-8">
              {results.slice(0, shown).map(([emoji, name]) =>
                <button key={emoji} type="button" title={name || emoji}
                  aria-label={name ? `选择 ${name}` : `选择 ${emoji}`}
                  aria-pressed={emoji === selectedEmoji}
                  onClick={() => pick({ iconEmoji: emoji, iconFileId: '', iconFile: null })}
                  className={`flex aspect-square items-center justify-center rounded-xl text-2xl hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-500 ${emoji === selectedEmoji ? 'bg-emerald-100 ring-1 ring-emerald-400' : ''}`}>
                  {emoji}
                </button>)}
            </div> : <p className="py-10 text-center text-sm text-stone-500">没有找到匹配的 Emoji</p>}
            {shown < results.length && <button type="button"
              className="my-3 w-full rounded-xl py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
              onClick={() => setShown(value => Math.min(value + PAGE_SIZE, results.length))}>
              显示更多（剩余 {results.length - shown}）
            </button>}
          </div>
          <div className="shrink-0 space-y-1 border-t border-stone-100 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl p-2 hover:bg-stone-50">
              <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><ImagePlus className="size-5" /></span>
              <span className="flex-1">
                <span className="block text-sm font-medium text-stone-800">上传图片</span>
                <span className="block text-xs text-stone-500">PNG / JPEG / WebP，自动缩放至 512×512 以内、最大 256 KiB</span>
              </span>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
                onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  if (file) pick({ iconEmoji: '', iconFileId: '', iconFile: file });
                }} />
            </label>
            <button type="button" onClick={() => pick(emptyIconDraft())}
              className="w-full rounded-xl px-4 py-2 text-center text-sm text-rose-600 hover:bg-rose-50">
              移除图标
            </button>
          </div>
        </div>
      </div>, document.body) : null}
  </>;
}
