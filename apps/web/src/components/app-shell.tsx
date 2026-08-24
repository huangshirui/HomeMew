import {
  CalendarDays,
  CheckSquare2,
  Clock3,
  Heart,
  Home,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../lib/cn';
import { useHousehold } from './household-provider';

const navigation = [
  { to: '/', label: '今天', icon: Home, end: true },
  { to: '/family', label: '家庭', icon: Users },
  { to: '/settings', label: '设置', icon: Settings },
  { to: '/calendar', label: '日程', icon: CalendarDays },
  { to: '/tasks', label: '待办', icon: CheckSquare2 },
  { to: '/days', label: '日子', icon: Clock3 },
  { to: '/wishes', label: '许愿', icon: Heart },
];

const mobileNavigation = [navigation[0], navigation[3], navigation[4], navigation[1], navigation[2]];

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-2xl bg-emerald-600 text-white shadow-sm shadow-emerald-600/20">
        <span className="text-lg" aria-hidden="true">猫</span>
      </div>
      <div>
        <p className="font-semibold tracking-tight text-stone-900">家事喵</p>
        <p className="text-xs font-medium tracking-[0.16em] text-stone-400">HOMEMEW</p>
      </div>
    </div>
  );
}

function DesktopNav() {
  const { families, currentFamily, members, setCurrentFamilyId } = useHousehold();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-stone-200/80 bg-[#fbfcfa] px-4 py-5 lg:flex lg:flex-col">
      <div className="px-2"><Brand /></div>
      <div className="mt-7 rounded-2xl bg-white px-3 py-3 shadow-sm ring-1 ring-stone-200/80">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-100 text-sm font-semibold text-amber-800">
            {(currentFamily?.name || '家').slice(0, 1)}
          </span>
          <span className="min-w-0 flex-1">
            {families.length > 1 ? (
              <select
                className="block w-full bg-transparent text-sm font-semibold text-stone-800 outline-none"
                value={currentFamily?.id || ''}
                onChange={(event) => setCurrentFamilyId(event.target.value)}
                aria-label="切换家庭"
              >
                {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
              </select>
            ) : (
              <span className="block truncate text-sm font-semibold text-stone-800">{currentFamily?.name || '暂无家庭'}</span>
            )}
            <span className="block truncate text-xs text-stone-400">{currentFamily ? `${members.length} 位成员` : '请先创建或加入家庭'}</span>
          </span>
        </div>
      </div>
      <nav className="mt-6 space-y-1">
        {navigation.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-emerald-50 text-emerald-800' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800',
            )}
          >
            <Icon className="size-[18px]" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto rounded-3xl bg-emerald-950 p-4 text-emerald-50">
        <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" /> 喵一下</div>
        <p className="mt-2 text-xs leading-5 text-emerald-100/70">日程、待办、日子和愿望已经接入 LifeSpace；Web 的智能创建入口后续单独收敛。</p>
      </div>
    </aside>
  );
}

function MobileBottomNav() {
  return (
    <nav className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 rounded-[24px] bg-stone-950/95 p-1.5 shadow-2xl backdrop-blur lg:hidden">
      {mobileNavigation.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => cn(
            'flex min-h-12 flex-col items-center justify-center gap-1 rounded-[18px] text-[11px] font-medium transition-colors',
            isActive ? 'bg-white text-stone-900' : 'text-stone-400 hover:text-white',
          )}
        >
          <Icon className="size-[18px]" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { user, currentFamily } = useHousehold();
  return (
    <div className="min-h-screen bg-[#f6f8f4] text-stone-900">
      <DesktopNav />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-stone-200/70 bg-[#f6f8f4]/90 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="lg:hidden"><Brand /></div>
            <div className="hidden lg:block">
              <p className="text-xs font-medium text-stone-400">家庭空间</p>
              <p className="text-sm font-semibold text-stone-800">{currentFamily?.name || '暂无家庭'}</p>
            </div>
            <div className="ml-auto grid size-9 place-items-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800 ring-2 ring-white" title={user?.displayName || ''}>
              {(user?.displayName || '我').slice(0, 1)}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
