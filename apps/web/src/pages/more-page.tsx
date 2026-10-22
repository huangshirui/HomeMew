import { CalendarRange, Clock3, Flame, Gift, Heart, Settings, Target, Trophy, Users } from 'lucide-react';
import { PageHeader } from '../components/ui/page-header';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui/card';

const entries = [
  { to: '/days', title: '日子', description: '记录重要的倒计时和坚持天数。', icon: Clock3, tone: 'bg-amber-100 text-amber-700' },
  { to: '/anniversaries', title: '纪念日', description: '生日、周年纪念和特别日子。', icon: Gift, tone: 'bg-violet-100 text-violet-700' },
  { to: '/activities', title: '活动', description: '家庭旅行、社团活动与赛事。', icon: CalendarRange, tone: 'bg-cyan-100 text-cyan-700' },
  { to: '/goals', title: '目标', description: '记录成长目标和阶段状态。', icon: Target, tone: 'bg-emerald-100 text-emerald-700' },
  { to: '/habits', title: '习惯', description: '为家人建习惯，本人打卡。', icon: Flame, tone: 'bg-orange-100 text-orange-700' },
  { to: '/football', title: '足球比赛', description: '比赛记录、进球与数据统计。', icon: Trophy, tone: 'bg-blue-100 text-blue-700' },
  {
    to: '/wishes',
    title: '许愿池',
    description: '写下、认领和实现一家人的小愿望。',
    icon: Heart,
    tone: 'bg-pink-100 text-pink-700',
  },
  {
    to: '/family',
    title: '家庭与成员',
    description: '家庭资料、成员、邀请和角色管理。',
    icon: Users,
    tone: 'bg-amber-100 text-amber-700',
  },
  {
    to: '/settings',
    title: '设置',
    description: '外部系统和其他低频家庭设置。',
    icon: Settings,
    tone: 'bg-stone-200 text-stone-700',
  },
] as const;

export function MorePage() {
  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader title="更多" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(({ to, title, description, icon: Icon, tone }) => (
          <Link key={to} to={to} className="group">
            <Card className="h-full p-5 transition group-hover:-translate-y-0.5 group-hover:shadow-md">
              <span className={`grid size-11 place-items-center rounded-2xl ${tone}`}><Icon className="size-5" /></span>
              <p className="mt-4 font-semibold text-stone-900">{title}</p>
              <p className="mt-1 text-sm leading-6 text-stone-500">{description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
