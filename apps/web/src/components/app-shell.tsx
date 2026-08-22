import {
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  Clock3,
  Heart,
  Home,
  Menu,
  Search,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../lib/cn';
import { Button } from './ui/button';

const navigation = [
  { to: '/', label: '今天', icon: Home, end: true },
  { to: '/calendar', label: '日程', icon: CalendarDays },
  { to: '/tasks', label: '待办', icon: CheckSquare2 },
  { to: '/days', label: '日子', icon: Clock3 },
  { to: '/wishes', label: '许愿', icon: Heart },
  { to: '/family', label: '家庭', icon: Users },
  { to: '/settings', label: '设置', icon: Settings },
];

const mobileNavigation = navigation.slice(0, 5);

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
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-stone-200/80 bg-[#fbfcfa] px-4 py-5 lg:flex lg:flex-col">
      <div className="px-2"><Brand /></div>
      <button className="mt-7 flex items-center justify-between rounded-2xl bg-white px-3 py-3 text-left shadow-sm ring-1 ring-stone-200/80">
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-100 text-sm font-semibold text-amber-800">黄</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-stone-800">我们的家</span>
            <span className="block truncate text-xs text-stone-400">4 位成员 · 界面预览</span>
          </span>
        </span>
        <ChevronDown className="size-4 text-stone-400" />
      </button>
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
        <p className="mt-2 text-xs leading-5 text-emerald-100/70">未来在这里快速创建日程、待办、日子和愿望。</p>
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
  return (
    <div className="min-h-screen bg-[#f6f8f4] text-stone-900">
      <DesktopNav />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-stone-200/70 bg-[#f6f8f4]/90 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="lg:hidden"><Brand /></div>
            <div className="hidden lg:block">
              <p className="text-xs font-medium text-stone-400">家庭空间</p>
              <p className="text-sm font-semibold text-stone-800">我们的家</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="icon" aria-label="搜索"><Search className="size-[18px]" /></Button>
              <Button variant="ghost" size="icon" aria-label="更多菜单" className="lg:hidden"><Menu className="size-[19px]" /></Button>
              <button className="ml-1 grid size-9 place-items-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800 ring-2 ring-white">锐</button>
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
