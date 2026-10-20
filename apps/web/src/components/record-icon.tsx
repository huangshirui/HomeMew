import type { ReactNode } from 'react';

export type IconModel = 'day_record' | 'event' | 'task' | 'wish';
export type RecordIcon = { type: 'emoji'; value: string } | { type: 'image'; fileId: string };
export type RecordIconDraft = {
  iconEmoji: string;
  iconFileId: string;
  iconFile: File | null;
};

const CHOICES = ['📅', '🎉', '📚', '⚽', '🏠', '✈️', '🎁', '💡', '❤️', '⭐', '🍀', '✅'];

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

async function uploadIcon(spaceId: string, modelKey: IconModel, file: File): Promise<string> {
  if (!file.size || file.size > 256 * 1024) throw new Error('图标图片不能超过 256 KiB，请先压缩');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('只支持 PNG、JPEG 和 WebP');
  const response = await fetch(
    `/api/record-icons/spaces/${encodeURIComponent(spaceId)}/models/${modelKey}/image`, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': file.type }, body: file,
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
  return <div className="grid gap-2 text-sm font-medium text-stone-700">
    图标（选填）
    <div className="flex flex-wrap items-center gap-2">
      {CHOICES.map(emoji => <button key={emoji} type="button" disabled={disabled}
        aria-label={`使用 ${emoji} 图标`}
        className={`rounded-lg border px-2 py-1 text-xl ${icon.iconEmoji === emoji ? 'border-emerald-500 bg-emerald-50' : 'border-stone-200'}`}
        onClick={() => onChange({ iconEmoji: emoji, iconFileId: '', iconFile: null })}>{emoji}</button>)}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
        className="min-w-0 flex-1 text-xs font-normal text-stone-500"
        onChange={event => {
          const file = event.currentTarget.files?.[0] ?? null;
          if (file) onChange({ iconEmoji: '', iconFileId: '', iconFile: file });
        }} />
      {icon.iconFileId && recordId && original?.type === 'image' ? <img alt="当前图标"
        src={recordIconSrc(spaceId, modelKey, recordId)} className="size-10 rounded-md object-contain" /> : null}
      {icon.iconFile ? <span className="text-xs font-normal text-stone-500">{icon.iconFile.name}</span> : null}
      {(icon.iconEmoji || icon.iconFile || icon.iconFileId) ? <button disabled={disabled} type="button"
        className="text-xs text-stone-500 underline" onClick={() => onChange(emptyIconDraft())}>清除</button> : null}
    </div>
    <span className="text-xs font-normal text-stone-400">图片限定 256 KiB、512×512；留空不会新增图标</span>
  </div>;
}
