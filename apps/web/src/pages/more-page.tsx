import { CalendarRange, Clock3, Flame, Gift, Heart, Settings, Target, Trophy, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/page-header';
import { useHousehold } from '../components/household-provider';

const groups = [
  {
    title: '计划与成长',
    entries: [
      { to: '/activities', title: '活动', icon: CalendarRange, tone: 'bg-cyan-100 text-cyan-700' },
      { to: '/goals', title: '目标', icon: Target, tone: 'bg-emerald-100 text-emerald-700' },
      { to: '/habits', title: '习惯', icon: Flame, tone: 'bg-orange-100 text-orange-700' },
    ],
  },
  {
    title: '生活与回忆',
    entries: [
      { to: '/days', title: '日子', icon: Clock3, tone: 'bg-amber-100 text-amber-700' },
      { to: '/anniversaries', title: '纪念日', icon: Gift, tone: 'bg-violet-100 text-violet-700' },
      { to: '/wishes', title: '许愿池', icon: Heart, tone: 'bg-pink-100 text-pink-700' },
      { to: '/football', title: '足球比赛', icon: Trophy, tone: 'bg-blue-100 text-blue-700' },
    ],
  },
  {
    title: '家庭管理',
    entries: [
      { to: '/family', title: '家庭与成员', icon: Users, tone: 'bg-amber-100 text-amber-700' },
      { to: '/settings', title: '设置', icon: Settings, tone: 'bg-stone-200 text-stone-700' },
    ],
  },
] as const;

const roleLabels = { owner: '家庭所有者', admin: '管理员', editor: '成员', viewer: '只读成员' } as const;

export function MorePage() {
  const { currentFamily } = useHousehold();
  return (
    <div className="space-y-6">
      <PageHeader title="更多" />
      {groups.map(group => (
        <section key={group.title} aria-label={group.title} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-stone-700">{group.title}</h2>
            {group.title === '家庭管理' && currentFamily ? (
              <span className="text-xs text-stone-400">当前身份：{roleLabels[currentFamily.role]}</span>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
            {group.entries.map(({ to, title, icon: Icon, tone }) => (
              <Link key={to} to={to}
                className="group flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-white px-2 py-3 text-center ring-1 ring-stone-200/80 transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${tone}`}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-medium leading-5 text-stone-700 group-hover:text-emerald-800">{title}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-stone-400">首页、日程与待办可从底部导航直接进入；家庭管理权限由 LifeSpace 校验。</p>
    </div>
  );
}
