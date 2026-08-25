import {
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Ellipsis,
  Heart,
  Home,
  RefreshCw,
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

const mobileNavigation = [
  { to: '/', label: '今天', icon: Home, end: true },
  { to: '/calendar', label: '日程', icon: CalendarDays },
  { to: '/tasks', label: '待办', icon: CheckSquare2 },
  { to: '/days', label: '日子', icon: Clock3 },
  { to: '/more', label: '更多', icon: Ellipsis },
];

function Avatar({ src, alt, fallback, className }: { src: string | null | undefined; alt: string; fallback: string; className?: string }) {
  return (
    <span className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800', className)}>
      <span aria-hidden="true">{(fallback || '家').slice(0, 1)}</span>
      {src ? (
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 size-full object-cover"
          onError={(event) => { event.currentTarget.hidden = true; }}
        />
      ) : null}
    </span>
  );
}

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
          <Avatar
            src={currentFamily?.avatarUrl}
            alt={currentFamily ? `${currentFamily.name}家庭头像` : '家庭头像'}
            fallback={currentFamily?.name || '家'}
            className="size-9 bg-amber-100 text-amber-800"
          />
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

function MobileFamilyContext() {
  const { families, currentFamily, setCurrentFamilyId } = useHousehold();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar
        src={currentFamily?.avatarUrl}
        alt={currentFamily ? `${currentFamily.name}家庭头像` : '家事喵'}
        fallback={currentFamily?.name || '猫'}
        className="size-9 bg-amber-100 text-amber-800 ring-2 ring-white"
      />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-stone-400">家事喵</p>
        {families.length > 1 ? (
          <span className="relative block min-w-0">
            <select
              className="block max-w-[46vw] appearance-none truncate bg-transparent pr-5 text-sm font-semibold text-stone-800 outline-none"
              value={currentFamily?.id || ''}
              onChange={(event) => setCurrentFamilyId(event.target.value)}
              aria-label="移动端切换家庭"
            >
              {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-1/2 size-3 -translate-y-1/2 text-stone-400" />
          </span>
        ) : (
          <p className="max-w-[46vw] truncate text-sm font-semibold text-stone-800">{currentFamily?.name || '暂无家庭'}</p>
        )}
      </div>
    </div>
  );
}

function MobileBottomNav() {
  return (
    <nav className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-5 rounded-[24px] bg-stone-950/95 p-1.5 shadow-2xl backdrop-blur lg:hidden">
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

function HouseholdErrorBanner() {
  const { error, loading, refresh } = useHousehold();
  if (!error) return null;
  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8" role="alert">
      <div className="flex items-start gap-3 rounded-2xl bg-red-50 px-4 py-3 text-red-800 ring-1 ring-red-100">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">家庭数据暂时没有同步完整</p>
          <p className="mt-0.5 break-words text-xs leading-5 text-red-700/80">{error}</p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-semibold text-red-700 shadow-sm ring-1 ring-red-100 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
          onClick={() => { void refresh(); }}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          重试
        </button>
      </div>
    </div>
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
            <div className="min-w-0 lg:hidden"><MobileFamilyContext /></div>
            <div className="hidden lg:block">
              <p className="text-xs font-medium text-stone-400">家庭空间</p>
              <p className="text-sm font-semibold text-stone-800">{currentFamily?.name || '暂无家庭'}</p>
            </div>
            <Avatar
              src={user?.avatarUrl}
              alt={user?.displayName ? `${user.displayName}的头像` : '我的头像'}
              fallback={user?.displayName || '我'}
              className="ml-3 size-9 ring-2 ring-white"
            />
          </div>
        </header>
        <HouseholdErrorBanner />
        <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
