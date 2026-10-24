import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarDays } from 'lucide-react';

const selectClass = 'h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-500';

/** Only a few useful recent years; older/future years can be entered explicitly. */
export function footballYearOptions(currentYear: number, selectedYear = ''): string[] {
  const recent = Array.from({ length: 5 }, (_, index) => String(currentYear - index));
  return [...new Set([...recent, ...( /^\d{4}$/.test(selectedYear) ? [selectedYear] : [] )])]
    .sort((left, right) => Number(right) - Number(left));
}

export function FootballYearFilter({ year, onChange }: {
  year: string; onChange: (year: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => footballYearOptions(currentYear, year), [currentYear, year]);

  useEffect(() => {
    if (!customOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setCustomOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCustomOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [customOpen]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(draft) || Number(draft) < 1900 || Number(draft) > 9999) return;
    onChange(draft);
    setCustomOpen(false);
  };
  return <div ref={root} className={'relative min-w-32 flex-1 text-sm text-stone-600' + (customOpen ? ' z-40' : '')}>
    <label htmlFor={id} className="mb-1 block">年份</label>
    <select id={id} aria-label="按年份筛选" className={selectClass}
      value={customOpen ? '__custom__' : year}
      onChange={event => {
        if (event.target.value === '__custom__') {
          setDraft(year && /^\d{4}$/.test(year) ? year : '');
          setCustomOpen(true);
        } else {
          setCustomOpen(false);
          onChange(event.target.value);
        }
      }}>
      <option value="">全部年份</option>
      {years.map(item => <option key={item} value={item}>{item}年</option>)}
      <option value="__custom__">其他年份…</option>
    </select>
    {customOpen && <form onSubmit={submit} role="group" aria-label="输入其他年份"
      className="absolute left-0 top-full z-50 mt-2 w-52 rounded-2xl border border-stone-200 bg-white p-3 shadow-xl">
      <div className="flex items-center gap-2 text-xs text-stone-500">
        <CalendarDays aria-hidden="true" className="size-4"/> 输入年份
      </div>
      <input autoFocus type="number" inputMode="numeric" min={1900} max={9999} step={1} required
        aria-label="自定义比赛年份" placeholder="例如 2018"
        className={selectClass + ' mt-2'} value={draft}
        onChange={event => setDraft(event.target.value)}/>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="rounded-lg px-2 py-1.5 text-sm text-stone-600"
          onClick={() => setCustomOpen(false)}>取消</button>
        <button type="submit" disabled={!/^\d{4}$/.test(draft) || Number(draft) < 1900 || Number(draft) > 9999}
          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">应用</button>
      </div>
    </form>}
  </div>;
}
