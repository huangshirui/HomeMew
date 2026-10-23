import { useMemo, useState } from 'react';
import { buildFootballStats, type FootballMonth } from './football-stats';
import type { FootballMatch, FootballPerformance } from './football-domain';
import { Card } from '../components/ui/card';

type TrendKind = 'attack' | 'time' | 'defense';
type SeriesKey = 'goalsPerMatch' | 'assistsPerMatch' | 'minutesPerGoal' |
  'minutesPerAssist' | 'tacklesPerMatch' | 'interceptionsPerMatch';

const variants: Record<TrendKind, {
  title: string; unit: string; keys: readonly [SeriesKey, SeriesKey]; labels: readonly [string, string];
}> = {
  attack: { title: '进攻 · 场均表现', unit: '次／场', keys: ['goalsPerMatch', 'assistsPerMatch'],
    labels: ['场均进球', '场均助攻'] },
  time: { title: '进攻 · 时间效率', unit: '分钟／次', keys: ['minutesPerGoal', 'minutesPerAssist'],
    labels: ['平均每进球分钟数', '平均每助攻分钟数'] },
  defense: { title: '防守 · 场均表现', unit: '次／场',
    keys: ['tacklesPerMatch', 'interceptionsPerMatch'], labels: ['场均抢断', '场均拦截'] },
};
const colors = ['#059669', '#d97706'] as const;
const fmt = (n: number | null, places = 2) =>
  n === null ? '—' : Number(n.toFixed(places)).toLocaleString('zh-CN', { maximumFractionDigits: places });
const number = (value: number) => value.toLocaleString('zh-CN');
function linePath(months: FootballMonth[], key: SeriesKey, x: (index: number) => number,
  y: (value: number) => number): string {
  let started = false;
  return months.map((month, index) => {
    const value = month[key];
    if (value === null || !Number.isFinite(value)) { started = false; return ''; }
    const command = started ? 'L' : 'M';
    started = true;
    return command + x(index).toFixed(2) + ',' + y(value).toFixed(2);
  }).join(' ');
}
function MetricCard({ label, value, unit, hint }: {label: string; value: string; unit: string; hint?: string}) {
  return <div className="min-w-0 rounded-2xl bg-stone-50 p-3 sm:p-4">
    <p className="text-xs text-stone-500">{label}</p>
    <div className="mt-2 flex items-baseline gap-1">
      <strong className="truncate text-2xl font-semibold tabular-nums text-stone-900 sm:text-3xl">{value}</strong>
      <span className="text-xs text-stone-500">{unit}</span>
    </div>
    {hint && <p className="mt-2 text-xs text-stone-500">{hint}</p>}
  </div>;
}

export function FootballStatsDashboard({ matches, events, playerId, playerName }: {
  matches: FootballMatch[]; events: FootballPerformance[]; playerId: string; playerName: string;
}) {
  const [kind, setKind] = useState<TrendKind>('attack');
  const stats = useMemo(() => buildFootballStats(matches, events, playerId), [matches, events, playerId]);
  const variant = variants[kind];
  const months = stats.months;
  const chart = useMemo(() => {
    const width = Math.max(640, 88 * months.length + 95);
    const left = 54, right = 22, top = 24, lineBottom = 211;
    const barTop = 279, barBottom = 353;
    const columnWidth = (width - left - right) / Math.max(1, months.length);
    const x = (index: number) => left + columnWidth * (index + 0.5);
    const values = months.flatMap(month => variant.keys.map(key => month[key]))
      .filter((n): n is number => n !== null && Number.isFinite(n));
    const lineMax = Math.max(1, Math.max(0, ...values) * 1.1);
    const countMax = Math.max(2, Math.ceil(Math.max(0, ...months.map(m => m.matches)) / 2) * 2);
    const y = (v: number) => lineBottom - (v / lineMax) * (lineBottom - top);
    const barY = (v: number) => barBottom - (v / countMax) * (barBottom - barTop);
    return { width, left, right, top, lineBottom, barTop, barBottom,
      columnWidth, x, y, barY, lineMax, countMax, hasValues: values.length > 0 };
  }, [months, variant]);
  const availableTime = stats.completeMinutesMatches;
  return <div className="space-y-4">
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="font-semibold">总体数据</h2>
        <p className="mt-1 text-xs text-stone-500">{playerName} · 当前筛选范围内的比赛</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="参赛场次" value={number(stats.matches)} unit="场"/>
        <MetricCard label="进球" value={number(stats.goals)} unit="球"/>
        <MetricCard label="助攻" value={number(stats.assists)} unit="次"/>
        <MetricCard label="比赛时间" value={availableTime ? number(stats.knownMinutes) : '—'} unit="分钟"
          hint={'已记时长 ' + availableTime + ' / ' + stats.matches + ' 场'}/>
      </div>
      <p className="text-xs text-stone-500">比赛时间只统计填写了出场时长的比赛；未填写的内容不计入统计。</p>
    </Card>
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="font-semibold">专项趋势</h2>
        <p className="mt-1 text-xs text-stone-500">按自然月分组 · 场均按该月实际参赛场次计算</p>
      </div>
      <div role="group" aria-label="专项趋势类型" className="grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1">
        {([{id:'attack' as const,label:'进攻场均'}, {id:'time' as const,label:'进攻时间'},
          {id:'defense' as const,label:'防守场均'}]).map(entry =>
          <button key={entry.id} type="button" aria-pressed={kind === entry.id}
            onClick={() => setKind(entry.id)}
            className={'min-w-0 rounded-lg px-2 py-2 text-xs font-medium transition-colors sm:text-sm ' +
              (kind === entry.id ? 'bg-white text-emerald-800 shadow-sm' : 'text-stone-600 hover:bg-white/60')}>
            {entry.label}
          </button>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{variant.title}</h3>
        <span className="text-xs text-stone-500">{variant.unit}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-stone-600">
        {variant.keys.map((key, i) => <span className="inline-flex items-center gap-2" key={key}>
          <span className="h-0.5 w-6 rounded-full" style={{ backgroundColor: colors[i] }}/>
          {variant.labels[i]}
        </span>)}
      </div>
      {!months.length ? <p className="py-12 text-center text-sm text-stone-500">当前筛选范围暂无参赛数据</p> :
        <div className="overflow-x-auto pb-2" aria-label="按月统计趋势与比赛场次">
          <svg width={chart.width} height="399" viewBox={'0 0 ' + chart.width + ' 399'} role="img"
            aria-label={variant.title + '，按月趋势折线及每月参赛场次柱形图'}>
            {Array.from({length: 5}, (_, i) => {
              const tick = chart.lineMax * i / 4;
              const yy = chart.y(tick);
              return <g key={i}>
                <line x1={chart.left} x2={chart.width - chart.right} y1={yy} y2={yy}
                  stroke="#e7e5e4" strokeDasharray={i === 0 ? undefined : '3 4'}/>
                <text x={chart.left - 9} y={yy+4} textAnchor="end" fill="#78716c" fontSize="11">{fmt(tick, kind === 'time' ? 0 : 2)}</text>
              </g>;
            })}
            {chart.hasValues && variant.keys.map((key, index) =>
              <g key={key}>
                <path d={linePath(months, key, chart.x, chart.y)} fill="none"
                  stroke={colors[index]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                {months.map((month, i) => month[key] !== null &&
                  <circle key={month.month} cx={chart.x(i)} cy={chart.y(month[key]!)}
                    r="4" fill={colors[index]} stroke="white" strokeWidth="1.5">
                    <title>{month.month + ' · ' + variant.labels[index] + '：' + fmt(month[key]!, 2) + ' ' + variant.unit}</title>
                  </circle>)}
              </g>)}
            {!chart.hasValues && <text x={chart.width/2} y="111" textAnchor="middle" fontSize="14" fill="#78716c">
              {kind === 'time' ? '还没有足够的比赛时间和进球、助攻记录' : '暂无可计算的表现'}
            </text>}
            <line x1={chart.left} x2={chart.width - chart.right} y1={chart.barTop - 21} y2={chart.barTop - 21} stroke="#e7e5e4"/>
            <text x={chart.left} y={chart.barTop - 34} fill="#44403c" fontWeight="600" fontSize="13">每月参赛场次</text>
            {[0,1,2].map(i => {
              const value = chart.countMax * i / 2;
              const yy = chart.barY(value);
              return <g key={i}>
                <line x1={chart.left} x2={chart.width-chart.right} y1={yy} y2={yy} stroke="#f5f5f4"/>
                <text x={chart.left-9} y={yy+4} textAnchor="end" fill="#78716c" fontSize="11">{fmt(value, value % 1 ? 1 : 0)}</text>
              </g>;
            })}
            {months.map((month, i) => {
              const height = chart.barBottom - chart.barY(month.matches);
              return <g key={month.month}>
                <rect x={chart.x(i)-15} y={chart.barY(month.matches)}
                  width="30" height={height} rx="4" fill={month.matches ? '#a8a29e' : '#e7e5e4'}>
                  <title>{month.month + ' · ' + month.matches + ' 场比赛；出场时间完整 ' +
                    month.completeMinutesMatches + ' / ' + month.matches + ' 场'}</title>
                </rect>
                <text x={chart.x(i)} y={chart.barBottom-7} textAnchor="middle" fontSize="11" fill={month.matches ? '#44403c' : '#a8a29e'}>
                  {month.matches || ''}
                </text>
                <text x={chart.x(i)} y="379" textAnchor="middle" fontSize="11" fill="#57534e">{month.month}</text>
              </g>;
            })}
          </svg>
        </div>}
      {kind === 'time' ? <>
        <p className="text-xs text-stone-600">只计算已填写出场时间的比赛，以及这些比赛中的进球和助攻。分钟数越少，效率越高。</p>
        <div className="flex flex-wrap gap-2">
          {months.filter(m => m.matches > 0).map(month =>
            <span key={month.month} className="rounded-lg bg-stone-50 px-2 py-1 text-xs text-stone-500">
              {month.month} · 已记时长 {month.completeMinutesMatches}/{month.matches} 场
            </span>)}
        </div>
      </> : <p className="text-xs text-stone-500">每个月独立计算场均；无比赛月份的场均不定义，折线断开。参赛场次柱图与折线共用月份横轴。</p>}
      <p className="text-xs text-stone-500">只统计已经填写的比赛和表现。</p>
    </Card>
  </div>;
}
