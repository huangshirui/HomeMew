import { useEffect, useRef } from 'react';
import { MoreHorizontal } from 'lucide-react';

export type LifecycleModel = 'goal' | 'habit';
export type LifecycleStatus = 'active' | 'paused' | 'achieved' | 'abandoned' | 'ended';
export type LifecycleAction = 'pause' | 'resume' | 'achieve' | 'abandon' | 'end' | 'reopen';

type MenuAction = { key: LifecycleAction; label: string; confirmation: string; danger?: boolean };

export function lifecycleOptions(model: LifecycleModel, status: LifecycleStatus): MenuAction[] {
  if (status === 'active') return [
    { key: 'pause', label: '暂停', confirmation: '暂停后可以随时恢复。' },
    ...(model === 'goal' ? [
      { key: 'achieve' as const, label: '标记为已达成', confirmation: '确定这个目标已经达成了吗？' },
      { key: 'abandon' as const, label: '放弃目标', confirmation: '放弃后会退出进行中的目标列表，仍可重新开始。', danger: true },
    ] : [
      { key: 'end' as const, label: '结束习惯', confirmation: '结束后将不能继续打卡，仍可重新开始。', danger: true },
    ]),
  ];
  if (status === 'paused') return [
    { key: 'resume', label: '恢复进行', confirmation: '恢复后可以继续使用。' },
    ...(model === 'goal' ? [
      { key: 'achieve' as const, label: '标记为已达成', confirmation: '确定这个目标已经达成了吗？' },
      { key: 'abandon' as const, label: '放弃目标', confirmation: '放弃后仍可重新开始。', danger: true },
    ] : [
      { key: 'end' as const, label: '结束习惯', confirmation: '结束后将不能继续打卡，仍可重新开始。', danger: true },
    ]),
  ];
  if ((model === 'goal' && (status === 'achieved' || status === 'abandoned')) ||
      (model === 'habit' && status === 'ended'))
    return [{ key: 'reopen', label: '重新开始', confirmation: '重新开始后状态将恢复为进行中。' }];
  return [];
}

/** Status display belongs outside; only deliberate lifecycle changes live in this menu. */
export function RecordLifecycleMenu({ model, status, recordName, disabled, onAction, onEdit }: {
  model: LifecycleModel;
  status: LifecycleStatus;
  recordName: string;
  disabled?: boolean;
  onAction: (action: LifecycleAction) => void;
  onEdit?: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const options = lifecycleOptions(model, status);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.removeAttribute('open');
    }
    function closeEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') menu.current?.removeAttribute('open');
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, []);
  useEffect(() => { if (disabled) menu.current?.removeAttribute('open'); }, [disabled]);
  if (!onEdit && !options.length) return null;

  function choose(action: MenuAction) {
    menu.current?.removeAttribute('open');
    if (!window.confirm(`${action.label}「${recordName}」？\n${action.confirmation}`)) return;
    onAction(action.key);
  }

  return <details ref={menu} className="relative shrink-0">
    <summary aria-label={`更多操作：${recordName}`} aria-disabled={disabled}
      onClick={event => { if (disabled) event.preventDefault(); }}
      onKeyDown={event => { if (disabled && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); }}
      className={`flex size-9 cursor-pointer list-none items-center justify-center rounded-xl text-stone-600 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 [&::-webkit-details-marker]:hidden ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <MoreHorizontal className="size-5" />
    </summary>
    <div className="absolute right-0 top-full z-30 mt-1 min-w-40 rounded-xl border border-stone-200 bg-white p-1 shadow-xl">
      {onEdit ? <button type="button" disabled={disabled} onClick={() => { menu.current?.removeAttribute('open'); onEdit(); }}
        className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-50 disabled:opacity-50">编辑</button> : null}
      {options.map(option => <button key={option.key} type="button" disabled={disabled}
        className={`w-full rounded-lg px-3 py-2 text-left text-sm disabled:opacity-50 ${option.danger ? 'text-rose-700 hover:bg-rose-50' : 'text-stone-700 hover:bg-stone-50'}`}
        onClick={() => choose(option)}>{option.label}</button>)}
    </div>
  </details>;
}
