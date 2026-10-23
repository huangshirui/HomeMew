import { type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { FamilyMember } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { FootballPersonPicker } from './football-person-picker';
import {
  type FootballPerformanceDraft, type PerformanceSchema,
  enumOptions, goalMethods, entryModes, performanceTitle,
} from './football-domain';

type Props = {
  spaceId: string; members: FamilyMember[];
  matchTitle: string; schema: PerformanceSchema;
  draft: FootballPerformanceDraft;
  onChange: (draft: FootballPerformanceDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void; saving: boolean; error: string; editing: boolean;
};
const input = 'h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-500';
const label = 'block space-y-1.5 text-sm font-medium text-stone-700';

export function FootballPerformanceSheet({
  spaceId, members, matchTitle, schema, draft, onChange,
  onSubmit, onClose, saving, error, editing,
}: Props) {
  const patch = (updates: Partial<FootballPerformanceDraft>) => onChange({ ...draft, ...updates });
  const types = enumOptions(schema, 'performanceType');
  const methods = enumOptions(schema, 'goalMethod');
  const modes = enumOptions(schema, 'entryMode');
  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-950/45 sm:items-center sm:p-6">
    <form role="dialog" aria-modal="true" aria-label={editing ? '编辑比赛表现' : '新增比赛表现'}
      onSubmit={onSubmit} className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:max-h-[86dvh] sm:rounded-3xl">
      <header className="flex shrink-0 items-center justify-between border-b border-stone-100 px-5 py-4">
        <div><h2 className="text-base font-semibold">{editing ? '编辑表现' : '新增比赛表现'}</h2>
          <p className="mt-1 text-xs text-stone-500">{matchTitle}</p></div>
        <Button type="button" size="icon" variant="ghost" disabled={saving} onClick={onClose} aria-label="关闭"><X className="size-4"/></Button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
        <FootballPersonPicker spaceId={spaceId} members={members} selected={draft.playerPersonId ? [draft.playerPersonId] : []}
          onChange={ids => patch({ playerPersonId: ids[0] ?? '' })} label="表现球员 *" disabled={saving}/>
        <label className={label}>表现类型 *
          <select required className={input} value={draft.performanceType} disabled={saving}
            onChange={e => onChange({ ...draft, performanceType: e.target.value, goalMethod: '', minutesPlayed: '', position: '', entryMode: '' })}>
            {types.map(key => <option key={key} value={key}>{performanceTitle(key)}</option>)}
          </select>
        </label>
        {draft.performanceType === 'goal' && <label className={label}>进球方式（可选）
          <select className={input} value={draft.goalMethod} disabled={saving} onChange={e => patch({ goalMethod: e.target.value })}>
            <option value="">未填写</option>
            {methods.map(key => <option key={key} value={key}>{goalMethods[key] ?? key}</option>)}
          </select>
        </label>}
        {draft.performanceType === 'appearance' && <>
          <label className={label}>本段上场时间（分钟，可选）
            <input className={input} type="number" min="0" step="1" disabled={saving}
              placeholder="可稍后填写" value={draft.minutesPlayed} onChange={e => patch({ minutesPlayed: e.target.value })}/>
          </label>
          <label className={label}>本段位置（可选）
            <input className={input} maxLength={80} disabled={saving}
              placeholder="如：左边锋、中前卫" value={draft.position} onChange={e => patch({ position: e.target.value })}/>
          </label>
          <label className={label}>进入方式（可选）
            <select className={input} value={draft.entryMode} disabled={saving} onChange={e => patch({ entryMode: e.target.value })}>
              <option value="">未填写</option>
              {modes.map(key => <option key={key} value={key}>{entryModes[key] ?? key}</option>)}
            </select>
          </label>
          <p className="text-xs text-stone-400">换下后再次登场、场内换位可以记录多段；每段只填写该段时长。</p>
        </>}
        <label className={label}>备注（可选）
          <textarea className="min-h-20 w-full rounded-xl border border-stone-200 bg-white p-3 text-sm outline-none focus:border-emerald-500"
            value={draft.notes} disabled={saving} maxLength={3000} onChange={e => patch({ notes: e.target.value })} placeholder="可补充表现细节"/>
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-stone-100 bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="text-xs text-stone-400">可选信息可以以后补充</p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={saving || !draft.playerPersonId || !types.includes(draft.performanceType)}>
            {saving ? '保存中…' : '确认保存'}
          </Button>
        </div>
      </footer>
    </form>
  </div>;
}
