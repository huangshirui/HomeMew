import {
  CalendarDays,
  ChevronLeft,
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
import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { cn } from '../lib/cn';
import { useHousehold, type FamilyMember } from './household-provider';

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

export function Avatar({ src, alt, fallback, className }: { src: string | null | undefined; alt: string; fallback: string; className?: string }) {
  return (
    <span className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800', className)}>
      <span aria-hidden="true">{(fallback || '家').slice(0, 1)}</span>
      {src ? (
        <img
          key={src}
          src={src}
          alt={alt}
          className="absolute inset-0 size-full object-cover"
          onError={(event) => { event.currentTarget.hidden = true; }}
        />
      ) : null}
    </span>
  );
}

// Reuse the stable, same-origin media route also consumed by the Mini Program.
// These public avatar assets never expose LifeSpace bearer tokens in the browser.
const familyAvatarSource = (id: string, available: string | null | undefined) =>
  available ? `/api/v1/miniprogram/media/families/${encodeURIComponent(id)}/avatar` : null;

export function MemberAvatar({ member, className }: { member: FamilyMember; className?: string }) {
  return <Avatar
    src={member.userId ? `/api/v1/miniprogram/media/users/${encodeURIComponent(member.userId)}/avatar` : null}
    alt={`${member.displayName || '家庭成员'}的头像`}
    fallback={member.displayName || '成'}
    className={className}
  />;
}

function MobileFamilyIdentity() {
  const { families, currentFamily, members, setCurrentFamilyId } = useHousehold();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative min-w-0 max-w-28">
      <button type="button" aria-label={`当前家庭：${currentFamily?.name || '暂无家庭'}，查看家庭与成员`}
        title={currentFamily?.name || '暂无家庭'}
        aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}
        className="flex h-10 w-full min-w-0 items-center gap-1.5 rounded-xl px-0.5 text-left outline-none transition hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-emerald-500">
        <Avatar src={currentFamily ? familyAvatarSource(currentFamily.id, currentFamily.avatarUrl) : null}
          alt={currentFamily ? `${currentFamily.name}家庭Logo` : '家庭Logo'}
          fallback={currentFamily?.name || '家'}
          className="size-7 shrink-0 rounded-lg bg-amber-100 text-[11px] text-amber-800" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-stone-800">{currentFamily?.name || '暂无家庭'}</span>
        <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-stone-500" />
      </button>
      {open ? (
        <div id={panelId} className="absolute left-0 top-[calc(100%+0.375rem)] z-50 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-stone-200 bg-white p-3 shadow-xl" aria-label="家庭切换与成员">
          <p className="mb-2 text-xs font-semibold text-stone-500">选择家庭</p>
          <div className="space-y-1">
            {families.map(family => (
              <button key={family.id} type="button"
                aria-current={family.id === currentFamily?.id ? 'true' : undefined}
                onClick={() => { setCurrentFamilyId(family.id); setOpen(false); }}
                className={cn('flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm hover:bg-stone-50',
                  family.id === currentFamily?.id && 'bg-emerald-50 text-emerald-800')}>
                <Avatar src={familyAvatarSource(family.id, family.avatarUrl)}
                  alt={`${family.name}家庭Logo`} fallback={family.name}
                  className="size-8 shrink-0 rounded-lg bg-amber-100 text-xs text-amber-800" />
                <span className="min-w-0 flex-1 truncate font-medium">{family.name}</span>
                {family.id === currentFamily?.id ? <span className="text-xs text-emerald-700">当前</span> : null}
              </button>
            ))}
            {!families.length ? <p className="p-2 text-sm text-stone-500">暂无家庭</p> : null}
          </div>
          {currentFamily ? (
            <div className="mt-3 border-t border-stone-100 pt-3">
              <p className="mb-2 text-xs font-semibold text-stone-500">家庭成员 · {members.length} 人</p>
              <div className="flex items-center gap-1.5" aria-label="家庭成员头像">
                {members.slice(0, 5).map(member => <MemberAvatar key={member.id} member={member} className="size-8 ring-2 ring-white" />)}
                {members.length > 5 ? <span className="grid size-8 place-items-center rounded-full bg-stone-100 text-[10px] text-stone-600">+{members.length - 5}</span> : null}
                {!members.length ? <span className="text-xs text-stone-400">暂无成员信息</span> : null}
              </div>
            </div>
          ) : null}
          <Link to="/family" onClick={() => setOpen(false)}
            className="mt-3 flex min-h-10 items-center justify-center rounded-xl bg-stone-50 text-xs font-medium text-stone-700 hover:bg-stone-100">
            家庭与成员
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function FamilyIdentity({ mobile = false }: { mobile?: boolean }) {
  const { families, currentFamily, members, setCurrentFamilyId } = useHousehold();
  const canSwitch = families.length > 1;
  if (mobile) return <MobileFamilyIdentity />;

  return (
    <div className={cn(
      'group relative flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors',
      canSwitch && 'cursor-pointer hover:bg-stone-100/80 focus-within:bg-stone-100/80 focus-within:ring-2 focus-within:ring-emerald-500/40',
    )}>
      <Avatar src={currentFamily?.avatarUrl} alt={currentFamily ? `${currentFamily.name}家庭头像` : '家庭头像'}
        fallback={currentFamily?.name || '家'} className="size-10 rounded-2xl bg-amber-100 text-amber-800" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold tracking-tight text-stone-900">{currentFamily?.name || '暂无家庭'}</p>
        <p className="mt-0.5 truncate text-xs text-stone-400">
          {currentFamily ? (members.length ? `${members.length} 位成员` : '正在加载成员…') : '请先创建或加入家庭'}
        </p>
      </div>
      {canSwitch ? (
        <>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-stone-500 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
          <select className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={currentFamily?.id || ''} onChange={(event) => setCurrentFamilyId(event.target.value)}
            aria-label={mobile ? '移动端切换家庭' : '切换家庭'} title="切换家庭">
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
    <nav aria-label="移动端主导航" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgba(28,25,23,0.04)] lg:hidden">
      {mobileNavigation.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => cn(
            'flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-600',
            isActive ? 'bg-emerald-50/70 text-emerald-800' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800',
          )}
        >
          <Icon aria-hidden="true" className="size-5" />
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
  const { currentFamily } = useHousehold();
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  const containerDetail = segments.length === 2 && ['activities', 'goals', 'habits'].includes(segments[0]);
  const nestedPage = containerDetail
    || (segments.length === 2 && segments[0] === 'football')
    || (segments.length === 3 && segments[0] === 'settings' && segments[1] === 'integrations');
  const parentPath = `/${segments[0]}`;
  const detailTitles: Record<string, string> = { activities: '活动详情', goals: '目标详情', habits: '习惯详情' };

  return (
    <div className="min-h-screen bg-[#f6f8f4] text-stone-900">
      <DesktopNav />
      <div className="lg:pl-64">
        {containerDetail ? (
          <header className="sticky top-0 z-20 border-b border-stone-200/70 bg-[#f6f8f4]/95 backdrop-blur-xl lg:hidden">
            <div className="mx-auto grid h-12 max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 px-4 sm:px-6">
              <Link to={parentPath} aria-label="返回列表" className="flex min-h-11 items-center gap-1 text-sm font-medium text-stone-700">
                <ChevronLeft aria-hidden="true" className="size-4" /> 返回
              </Link>
              <h1 className="truncate text-center text-[20px] font-semibold tracking-tight text-stone-950">{detailTitles[segments[0]]}</h1>
              <span aria-hidden="true" />
            </div>
          </header>
        ) : null}
        <HouseholdErrorBanner />
        <main className={cn(
          'mx-auto max-w-7xl px-4 pt-3 sm:px-6 sm:pt-5 lg:px-8 lg:pb-10 lg:pt-8',
          nestedPage ? 'pb-8' : 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]',
        )}>
          <Outlet key={currentFamily?.id ?? 'no-family'} />
        </main>
      </div>
      {!nestedPage ? <MobileBottomNav /> : null}
    </div>
  );
}
