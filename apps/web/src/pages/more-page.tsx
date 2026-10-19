import { Heart, Settings, Users } from 'lucide-react';
import { PageHeader } from '../components/ui/page-header';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui/card';

const entries = [
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
