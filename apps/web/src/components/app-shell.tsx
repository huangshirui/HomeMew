import {
  CalendarDays,
  CalendarRange,
  Target,
  Flame,
  Gift,
  Trophy,
  CheckSquare2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Ellipsis,
  Heart,
  Home,
  RefreshCw,
  Settings,
  Users,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../lib/cn';
import { useHousehold } from './household-provider';

const dailyNavigation = [
  { to: '/', label: '今天', icon: Home, end: true },
  { to: '/calendar', label: '日程', icon: CalendarDays },
  { to: '/tasks', label: '待办', icon: CheckSquare2 },
];

const growthNavigation = [
  { to: '/activities', label: '活动', icon: CalendarRange },
  { to: '/goals', label: '目标', icon: Target },
  { to: '/habits', label: '习惯', icon: Flame },
];

const memoriesNavigation = [
  { to: '/days', label: '日子', icon: Clock3 },
  { to: '/anniversaries', label: '纪念日', icon: Gift },
  { to: '/wishes', label: '许愿池', icon: Heart },
  { to: '/football', label: '足球比赛', icon: Trophy },
];

const managementNavigation = [
  { to: '/family', label: '家庭与成员', icon: Users },
  { to: '/settings', label: '设置', icon: Settings },
];

const mobileNavigation = [
  { to: '/', label: '首页', icon: Home, end: true },
  { to: '/calendar', label: '日程', icon: CalendarDays },
  { to: '/tasks', label: '待办', icon: CheckSquare2 },
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

function FamilyIdentity({ mobile = false }: { mobile?: boolean }) {
  const { families, currentFamily, members, setCurrentFamilyId } = useHousehold();
  const canSwitch = families.length > 1;

  return (
    <div className={cn(
      'group relative flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors',
      canSwitch && 'cursor-pointer hover:bg-stone-100/80 focus-within:bg-stone-100/80 focus-within:ring-2 focus-within:ring-emerald-500/40',
      mobile && 'gap-2.5 px-0 py-1 hover:bg-transparent focus-within:bg-transparent',
    )}>
      <Avatar
        src={currentFamily?.avatarUrl}
        alt={currentFamily ? `${currentFamily.name}家庭头像` : '家庭头像'}
        fallback={currentFamily?.name || '家'}
        className={cn('size-10 rounded-2xl bg-amber-100 text-amber-800', mobile && 'size-9')}
      />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-semibold tracking-tight text-stone-900', mobile ? 'text-sm' : 'text-base')}>
          {currentFamily?.name || '暂无家庭'}
        </p>
        <p className="mt-0.5 truncate text-xs text-stone-400">
          {currentFamily ? (members.length ? `${members.length} 位成员` : '正在加载成员…') : '请先创建或加入家庭'}
        </p>
      </div>
      {canSwitch ? (
        <>
          <ChevronDown aria-hidden="true" className={cn(
            'size-4 shrink-0 text-stone-500 transition-opacity',
            mobile ? 'opacity-75' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          )} />
          <select
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={currentFamily?.id || ''}
            onChange={(event) => setCurrentFamilyId(event.target.value)}
            aria-label={mobile ? '移动端切换家庭' : '切换家庭'}
            title="切换家庭"
          >
            {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
          </select>
        </>
      ) : null}
    </div>
  );
}

type SidebarEntry = { to: string; label: string; icon: typeof Home; end?: boolean };

function SidebarSection({ title, entries, first = false }: { title: string; entries: readonly SidebarEntry[]; first?: boolean }) {
  return (
    <section className={first ? '' : 'mt-4 border-t border-stone-200/80 pt-4'} aria-label={title}>
      <h2 className="mb-2 px-3 text-[11px] font-semibold tracking-[0.14em] text-stone-400">{title}</h2>
      <div className="space-y-0.5">
        {entries.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-emerald-50 text-emerald-800' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800',
            )}
          >
            <Icon className="size-[18px] shrink-0" />
            {label}
          </NavLink>
        ))}
      </div>
    </section>
  );
}

function DesktopNav() {
  const { user } = useHousehold();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-hidden border-r border-stone-200/80 bg-[#fbfcfa] px-4 py-5 lg:flex">
      <div className="shrink-0"><FamilyIdentity /></div>
      <nav aria-label="家庭主导航" className="mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 scrollbar-overlay">
        <SidebarSection title="日常" entries={dailyNavigation} first />
        <SidebarSection title="计划与成长" entries={growthNavigation} />
        <SidebarSection title="生活与回忆" entries={memoriesNavigation} />
        <SidebarSection title="家庭管理" entries={managementNavigation} />
      </nav>
      <div className="mt-3 flex shrink-0 items-center gap-3 border-t border-stone-200/80 px-2 pt-4">
        <Avatar
          src={user?.avatarUrl}
          alt={user?.displayName ? `${user.displayName}的头像` : '我的头像'}
          fallback={user?.displayName || '我'}
          className="size-9 ring-2 ring-white"
        />
        <p className="min-w-0 truncate text-sm font-medium text-stone-700">{user?.displayName || '我的账号'}</p>
      </div>
    </aside>
  );
}

function MobileBottomNav() {
  return (
    <nav className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-4 rounded-[24px] bg-stone-950/95 p-1.5 shadow-2xl backdrop-blur lg:hidden">
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
        <header className="sticky top-0 z-20 border-b border-stone-200/70 bg-[#f6f8f4]/90 backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
            <div className="min-w-0 flex-1"><FamilyIdentity mobile /></div>
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
          <Outlet key={currentFamily?.id ?? 'no-family'} />
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
