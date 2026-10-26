/**
 * 首页 —— 今天的家庭工作台
 *
 * 首页顺序（见需求「11. 首页需求」）：
 *   导航栏显示当前家庭名称 → 需要关注 → 今天安排 → 待办提醒 → 生活进行时
 *
 * 设计目标：
 * - 删除两个统计数字卡片；
 * - 删除原单条 urgent banner，紧急日程并入「需要关注」横向卡片；
 * - 删除原欢迎卡片：当前家庭名称显示于导航栏（运行时替换固定的“家事喵”标题），
 *   切换家庭统一在「我的」页完成，首页不再承载家庭切换入口；
 * - 「需要关注」保持简洁：区块底色为浅绿、内部卡片为浅白（与原配色互换），
 *   critical 卡片整卡高亮并放大数字，让逾期/紧急真正跳出来；
 * - 没有关注项时整个「需要关注」区域隐藏；
 * - 完整功能与家庭管理入口统一收归「更多」。
 */

import {
  currentFamilyStore,
  familiesStore,
  userStore,
  loadFamilies,
  loadCurrentUser,
  restoreCurrentFamily,
} from '../../stores/index';
import {
  showSuccess,
  showError,
  getErrorMessage,
  isVersionConflict,
  formatDate,
  addDaysToDateOnly,
  formatInstantInTimeZone,
  timeZoneLabel,
} from '../../utils/index';
import { getViewingTimeZone } from '../../services/settings';
import { eventDaysInRange } from '../../utils/event-timeline';
import { isEventEnded, isEventOngoing, eventDisplayRank } from '../../utils/event-status';
import { consumeAnyDirty, consumeDirtyDomains, markDirty, subscribe } from '../../stores/dirty';
import { loadHomeScope, type HomeScope } from '../../stores/home-scope';
import { listEvents } from '../../services/events';
import { listTasks, completeTask } from '../../services/tasks';
import { listAttentionDayRecords } from '../../services/day-records';
import {
  readHomeStartupCache,
  cacheHomeEvents,
  cacheHomeTasks,
  cacheHomeAttentionDays,
} from '../../services/home-cache';
import { mapDayRecordView, DayRecordView } from '../../utils/day-record-view';
import { DayRecordKind } from '../../types/index';
import { Event, Task, FamilyRole } from '../../types/index';
import { listDomainPeople, performDomainAction, type PersonOption } from '../../services/domains';
import { listCurrentLifeRecords, type LifeKind } from '../../services/life-records';
import { homeLifeRows, type HomeLifeRow } from '../../utils/home-life';

type FamilyView = {
  id: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  role: FamilyRole;
  memberCount: number;
};

type TodayEventView = {
  id: string;
  summary: string;
  timeText: string;
  isAllDay: boolean;
  isEnded: boolean;
  isOngoing: boolean;
};

type TaskHomeView = {
  id: string;
  name: string;
  status: 'pending' | 'completed';
  dueDate: string | null;
  dueText: string;
  isOverdue: boolean;
  assigneeText: string;
  version: number;
  completing: boolean;
};

/** 「需要关注」横向卡片（聚合日子 / 逾期待办 / 紧急日程） */
type AttentionCard = {
  /** 卡片内部类型，决定渲染与跳转 */
  kind: 'day' | 'overdue-tasks' | 'urgent-event';
  id: string;
  /** 主文案（标题），如「清理滤水器」「待办已逾期」「足球训练」 */
  title: string;
  /** 次文案，非日子类使用（如「有 3 件事情需要处理」） */
  desc: string;
  /** 左侧图标 */
  icon: string;
  /** 关注级别，用于排序与配色 */
  level: 'critical' | 'warning' | 'info' | 'none';
  /** 点击跳转目标 */
  navigate: 'day' | 'tasks' | 'event';
  /** 跳转用的资源 id（day / event 使用） */
  targetId: string;

  /** 日子类专属字段（kind === 'day' 时填充） */
  /** 日子子类型：elapsed（生活记录）/ countdown（倒计时）/ cycle（周期事项），决定卡片布局 */
  dayType?: 'elapsed' | 'countdown' | 'cycle';
  /** 高亮数字，如 86 / 4 / -3（已过去天数用负数区分，渲染时加「已过去」前缀） */
  dayNumber?: string;
  /** 数字后的单位文案，如「天」「天到期」 */
  dayUnit?: string;
  /** 底部补充文字，如「已达到提醒时间」「2026年8月19日」「还有 4 天到期」 */
  daySubText?: string;
  /** 周期进度百分比（0~100）；非 cycle 为 null */
  dayProgress?: number | null;
};

/** 首页每个模块最多展示的条目数，超出由「查看全部」进入对应 Tab */
const HOME_LIMIT = 3;

/** 首页「待办提醒」最多展示的条目数，超出在末行提示更多 */
const HOME_TASK_LIMIT = 10;

/**
 * 首页「待办提醒」的截止日期窗口：今天 / 明天 / 后天（共 3 天）。
 * 已逾期的待办没有下界限制，始终包含；无截止日期的不进入该列表。
 */
const HOME_TASK_DUE_DAYS = 3;

/**
 * 后台轮询间隔（毫秒）：页面可见期间每 60 秒重新拉取一次后台数据，
 * 让其他家庭成员的新增 / 修改 / 删除在无需用户操作时也能自动出现。
 * 页面隐藏（切 tab / 进入子页 / 退到后台）时停止，不消耗流量。
 */
const POLL_INTERVAL_MS = 60 * 1000;

/** 关注级别排序权重：critical → warning → info → none */
function attentionLevelRank(level: string): number {
  switch (level) {
    case 'critical': return 0;
    case 'warning': return 1;
    case 'info': return 2;
    default: return 3;
  }
}

Page({
  data: {
    /** 首屏骨架屏开关：初始为 true，数据就绪后关闭，由真实内容替换 */
    loading: true,

    currentFamily: null as FamilyView | null,
    loaded: false,
    /** 当前生效的首页数据范围（设置页「首页数据范围」）：'me' 只看我的 / 'all' 看全家 */
    homeScope: 'me' as HomeScope,

    todayEvents: [] as TodayEventView[],
    todayEventCount: 0,

    pendingTasks: [] as TaskHomeView[],
    pendingTaskCount: 0,
    /** 近 3 天待办中未展示的剩余条数（> 0 时列表末行提示更多） */
    pendingTaskMore: 0,

    attentionCards: [] as AttentionCard[],

    eventsLoading: false,
    eventsRefreshing: false,
    eventsError: false,
    tasksLoading: false,
    tasksRefreshing: false,
    tasksError: false,

    attentionDays: [] as DayRecordView[],
    daysLoading: false,
    daysError: false,

    /** 下拉刷新指示器状态（scroll-view refresher） */
    refreshing: false,
    lifeTab: 'habits' as LifeKind,
    lifeTabs: [{ key: 'habits', label: '我的习惯' }, { key: 'activities', label: '活动' }, { key: 'goals', label: '目标' }],
    lifeRecords: { habits: [], activities: [], goals: [] } as Record<LifeKind, HomeLifeRow[]>,
    lifeLoading: { habits: false, activities: false, goals: false },
    lifeErrors: { habits: false, activities: false, goals: false },
    canCheckIn: false,
  },

  _lifeGeneration: { habits: 0, activities: 0, goals: 0 },
  _lifePersonId: '',
  _lifeContext: 0,
  _checkingHabits: new Set<string>(),

  // 原始列表（不参与渲染，仅用于派生视图与排序）
  _todayEvents: [] as Event[],
  _pendingTasks: [] as Task[],
  _completingIds: new Set<string>(),
  /** 本页已尝试恢复启动缓存的家庭；避免同一次页面生命周期反复读取 Storage。 */
  _homeCacheHydratedFamilyId: '' as string,

  _familyUnsubscribe: null as (() => void) | null,
  _familiesUnsubscribe: null as (() => void) | null,
  _dirtyUnsubscribe: null as (() => void) | null,
  /** 每分钟本地重算定时器（只重算展示态，不重新拉后台） */
  _tickTimer: null as ReturnType<typeof setInterval> | null,
  /** 后台轮询定时器（页面可见期间才运行，拉取其他成员的变更） */
  _pollTimer: null as ReturnType<typeof setInterval> | null,
  /** 上次真正发起后台拉取的时间戳，用于轮询节流，避免与 onShow / 下拉刷新叠加 */
  _lastFetchAt: 0,
  /** 上次重算得到的「已结束 / 进行中」指纹，用于跳过无变化的 setData */
  _statusFingerprint: '' as string,

  /** 页面显示：同步导航栏家庭名 + 订阅状态 + 启动每分钟本地重算 */
  onShow(): void {
    this.getTabBar()?.setData({ selected: 0 });

    // 先以 store 中的当前家庭刷新标题，避免 setData 异步导致读取到旧数据。
    this.applyNavTitle(currentFamilyStore.value as FamilyView | null);

    const storeFamilyId = currentFamilyStore.value?.id || '';
    const shownFamilyId = this.data.currentFamily?.id || '';
    // 首页只消费自己关心的域（events / tasks / days），不消费 wishes，
    // 避免愿望的变更导致首页全量重新请求。
    const dirty = consumeDirtyDomains(['events', 'tasks', 'days']);
    // 设置页「首页数据范围」变更后，本页需重新拉取以套用新的范围。
    const scope = loadHomeScope(storeFamilyId, userStore.value?.id || '');
    const scopeChanged = scope !== this.data.homeScope;
    this.setData({ homeScope: scope });
    // 首次加载、家庭在其他页被切换过、关心的域被标记变更（新建/完成/删除后返回）、
    // 或数据范围设置变更时重新拉取；普通切换 tab 不重复请求。
    if (!this.data.loaded || (storeFamilyId && storeFamilyId !== shownFamilyId) || dirty.size > 0 || scopeChanged) {
      this.loadData();
    } else if (storeFamilyId) {
      // New domain edit/detail pages do not publish the legacy dirty flags.
      void this.loadLife(storeFamilyId);
    }

    this._familyUnsubscribe = currentFamilyStore.subscribe((family) => {
      const newFamily = family as FamilyView | null;
      const prevId = this.data.currentFamily?.id;
      this.setData({ currentFamily: newFamily }, () => {
        this.applyNavTitle(newFamily);
      });
      const newId = newFamily?.id;
      if (newId !== prevId) {
        // 家庭切换：先清空旧家庭的所有缓存与派生展示数据，避免「需要关注」、
        // 今天安排、待办提醒等仍短暂显示上一个家庭的内容；随后再以新家庭重新拉取。
        this._resetFamilyData();
        if (!newId) return;
        this._hydrateHomeStartupCache(newId);
        // 重置轮询节流窗口，避免下一轮轮询紧接着又对新家庭重复请求一次
        this._markFetched();
        this.loadTodayEvents(newId);
        this.loadTasks(newId);
        this.loadAttentionDays(newId);
        void this.loadLife(newId);
      }
    });
    this._familiesUnsubscribe = familiesStore.subscribe((families) => {
      const cf = currentFamilyStore.value;
      this.setData({
        loaded: true,
        loading: false,
        currentFamily: cf as FamilyView | null,
      }, () => {
        this.applyNavTitle(cf as FamilyView | null);
      });
    });

    this._subscribeDirty();
    this._startTick();
    this._startPoll();
  },

  onHide(): void {
    if (this._familyUnsubscribe) this._familyUnsubscribe();
    if (this._familiesUnsubscribe) this._familiesUnsubscribe();
    this._unsubscribeDirty();
    this._stopTick();
    this._stopPoll();
  },

  onUnload(): void {
    if (this._familyUnsubscribe) this._familyUnsubscribe();
    if (this._familiesUnsubscribe) this._familiesUnsubscribe();
    this._unsubscribeDirty();
    this._stopTick();
    this._stopPoll();
  },

  /** 启动每分钟本地重算：仅用已缓存数据重算「进行中/已结束」等展示态，不请求后台 */
  _startTick(): void {
    if (this._tickTimer) return;
    // 立即重算一次：从后台返回 / 切回 tab 时，缓存的展示态可能已在页面不可见期间发生
    // 进行中→已结束等变化，应立刻反映，而不是等下一个 60 秒 tick。
    this.recompute();
    this._tickTimer = setInterval(() => this.recompute(), 60 * 1000);
  },

  _stopTick(): void {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  },

  /**
   * 启动后台轮询：页面可见期间每 60 秒重新拉取一次首页三个模块，
   * 使其他家庭成员的变更在用户不做任何操作时也能自动出现。
   *
   * 注意：
   * - 只在 onShow 启动、onHide / onUnload 停止，隐藏期间不产生请求；
   * - 与本地展示态 tick 分开，互不干扰；
   * - 通过 _lastFetchAt 节流，刚刚（onShow / 下拉刷新 / 脏标记）拉过就跳过本轮；
   * - 每次轮询都重新读取 currentFamilyStore，家庭切换后自然指向新家庭；
   *   各 load* 内部还会用 familyId 校验丢弃过期响应，不会串数据。
   */
  _startPoll(): void {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  },

  _stopPoll(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  /** 轮询一次：带节流与家庭校验，复用已有的加载函数 */
  _poll(): void {
    if (!this.data.loaded) return;
    // 以 store 为准：家庭可能在其它页被切换，此处不能用可能滞后的 data 快照
    const familyId = currentFamilyStore.value?.id || '';
    if (!familyId || familyId !== this.data.currentFamily?.id) return;
    if (Date.now() - this._lastFetchAt < POLL_INTERVAL_MS) return;
    this._markFetched();
    this.loadTodayEvents(familyId);
    this.loadTasks(familyId);
    this.loadAttentionDays(familyId);
    void this.loadLife(familyId);
  },

  /** 记录一次后台拉取时间，供轮询节流使用 */
  _markFetched(): void {
    this._lastFetchAt = Date.now();
  },

  /**
   * 在远端已经验证过当前 user + family 后，先恢复上一次首页数据用于首屏展示。
   * 缓存只改善渲染速度；本方法之后仍会立即并发请求 LifeSpace，实时结果覆盖缓存。
   */
  _hydrateHomeStartupCache(familyId: string): void {
    if (this._homeCacheHydratedFamilyId === familyId) return;
    this._homeCacheHydratedFamilyId = familyId;

    const userId = userStore.value?.id || '';
    const family = currentFamilyStore.value;
    if (!userId || !family || family.id !== familyId) return;

    const viewingTimezone = getViewingTimeZone(family.timezone);
    const viewDate = formatInstantInTimeZone(new Date().toISOString(), viewingTimezone).date;
    const cached = readHomeStartupCache(userId, familyId, viewDate);
    if (!cached) return;

    if (cached.events) this._todayEvents = cached.events;
    if (cached.tasks) this._pendingTasks = cached.tasks;
    if (cached.attentionDays) {
      this.setData({ attentionDays: cached.attentionDays.map(mapDayRecordView) });
    }
    this._statusFingerprint = '';
    this.recompute();
  },

  /**
   * 清空当前家庭的全部缓存与派生展示数据，并重置展示态指纹。
   * 用于家庭切换或重新加载开始：保证旧家庭的「需要关注」日子 / 今天安排 /
   * 待办提醒不会在新家庭数据返回前继续显示，避免串数据。
   *
   * 注意：不清空 loading/error 标志由各自 load* 负责；此处仅清空数据，
   * 并触发一次 setData 让界面立即回落到空态（加载中由对应 load* 接管）。
   */
  _resetFamilyData(): void {
    this._todayEvents = [];
    this._pendingTasks = [];
    this._completingIds.clear();
    this._statusFingerprint = '';
    this._homeCacheHydratedFamilyId = '';
    for (const kind of ['habits', 'activities', 'goals'] as LifeKind[]) this._lifeGeneration[kind]++;
    this._lifePersonId = '';
    this._lifeContext++;
    this._checkingHabits.clear();
    this.setData({
      todayEvents: [],
      todayEventCount: 0,
      pendingTasks: [],
      pendingTaskCount: 0,
      pendingTaskMore: 0,
      attentionDays: [],
      attentionCards: [],
      lifeTab: 'habits',
      lifeRecords: { habits: [], activities: [], goals: [] },
      lifeLoading: { habits: false, activities: false, goals: false },
      lifeErrors: { habits: false, activities: false, goals: false },
      canCheckIn: false,
    });
  },

  _subscribeDirty(): void {
    this._unsubscribeDirty();
    this._dirtyUnsubscribe = subscribe((domain) => {
      const cf = this.data.currentFamily;
      if (!cf || !this.data.loaded) return;
      if (domain === 'tasks') this.loadTasks(cf.id);
      else if (domain === 'events') this.loadTodayEvents(cf.id);
      else if (domain === 'days') this.loadAttentionDays(cf.id);
    });
  },

  _unsubscribeDirty(): void {
    if (this._dirtyUnsubscribe) {
      this._dirtyUnsubscribe();
      this._dirtyUnsubscribe = null;
    }
  },

  /** 下拉刷新：仅内容区下拉（nav-bar 固定），家庭信息 + 今日日程 + 待办 */
  onRefresh(): void {
    this._markFetched();
    this.setData({ refreshing: true });
    Promise.all([
      this.loadData(),
      this.data.currentFamily ? this.loadTodayEvents(this.data.currentFamily.id) : Promise.resolve(),
      this.data.currentFamily ? this.loadTasks(this.data.currentFamily.id) : Promise.resolve(),
    ])
      .then(() => this.setData({ refreshing: false }))
      .catch(() => this.setData({ refreshing: false }));
  },

  async loadData(): Promise<void> {
    this._markFetched();
    try {
      await Promise.all([loadFamilies(), this.ensureUser()]);
      const families = familiesStore.value;
      // 优先信任 store 中当前家庭（其它页面切换后已同步），若无效再尝试恢复缓存。
      const storeCurrent = currentFamilyStore.value;
      const current =
        (storeCurrent && families.some((f) => f.id === storeCurrent.id)
          ? storeCurrent
          : restoreCurrentFamily(families)) || null;
      const prevId = this.data.currentFamily?.id;
      this.setData({
        currentFamily: current as FamilyView | null,
        loaded: true,
        loading: false,
      }, () => {
        this.applyNavTitle(current as FamilyView | null);
      });

      const app = getApp<IAppOption>();
      if (app) {
        app.globalData.families = families;
        app.globalData.currentFamily = current;
      }

      this.setData({ homeScope: loadHomeScope(current?.id || '', userStore.value?.id || '') });

      if (current) {
        // 家庭发生变化时先清空旧数据，避免新家庭加载完成前残留上一个家庭的内容
        if (prevId && prevId !== current.id) {
          this._resetFamilyData();
        }
        this._hydrateHomeStartupCache(current.id);
        this.loadTodayEvents(current.id);
        this.loadTasks(current.id);
        this.loadAttentionDays(current.id);
        await this.loadLife(current.id);
      } else {
        this._resetFamilyData();
      }
    } catch (e) {
      console.error('[Home] Load data failed:', e);
      this.setData({ loaded: true, loading: false });
    }
  },

  /** 确保当前用户已加载（用于问候昵称），不重复请求 */
  async ensureUser(): Promise<void> {
    if (userStore.value) return;
    try {
      await loadCurrentUser();
    } catch (e) {
      console.error('[Home] Load user failed:', e);
    }
  },

  /** 将导航栏标题同步为当前家庭名称（运行时替换固定的“家事喵”） */
  applyNavTitle(family?: FamilyView | null): void {
    const current = family || this.data.currentFamily;
    const name = current?.name;
    if (name) {
      wx.setNavigationBarTitle({ title: name });
    }
  },

  /**
   * 加载今日日程。
   *
   * 「今天」由查看时区（设备时区，无效时回退家庭时区）决定：同一个时区既作为
   * 列表接口的 `timezone` 查询参数，也用于本地过滤，因此查询窗口无需前后扩展，
   * Core 返回的就是这一天的日程。事件的 startTimezone 只是地点时区标签。
   */
  async loadTodayEvents(familyId: string): Promise<void> {
    // 已有数据时进入非破坏性「后台刷新」态，保留旧列表继续展示，避免整块闪现「加载中」
    const hasOld = this.data.todayEvents.length > 0;
    this.setData({
      eventsLoading: !hasOld,
      eventsRefreshing: hasOld,
      eventsError: false,
    });
    try {
      const viewingTimezone = getViewingTimeZone(this.data.currentFamily?.timezone);
      const start = formatInstantInTimeZone(new Date().toISOString(), viewingTimezone).date;
      const end = addDaysToDateOnly(start, 1);
      // 跟随设置页「首页数据范围」：all 看全家（不传 attendeeId）、me 只看我的（传 'me'）
      const scope = loadHomeScope(familyId, userStore.value?.id || '');
      const attendeeId = scope === 'all' ? undefined : 'me';
      const events = await listEvents(familyId, {
        startDate: start,
        endDateExclusive: end,
        timezone: viewingTimezone,
        status: 'active',
        ...(attendeeId ? { attendeeId } : {}),
      });
      if (this.data.currentFamily?.id !== familyId) return;

      this._todayEvents = events.filter(event =>
        eventDaysInRange(
          event,
          start,
          end,
          viewingTimezone,
          (instant, tz) => formatInstantInTimeZone(instant, tz).date,
        ).length > 0,
      );
      const userId = userStore.value?.id;
      if (userId) cacheHomeEvents(userId, familyId, start, this._todayEvents);
      this.setData({ eventsLoading: false, eventsRefreshing: false });
      this.recompute();
    } catch (e) {
      console.error('[Home] Load today events failed:', e);
      if (this.data.currentFamily?.id !== familyId) return;
      this.setData({ eventsLoading: false, eventsRefreshing: false, eventsError: true });
    }
  },

  onRetryEvents(): void {
    if (this.data.currentFamily) this.loadTodayEvents(this.data.currentFamily.id);
  },

  /**
   * 加载待办任务（进行中的任务）。
   *
   * 跟随设置页「首页数据范围」：all 看全家（不传 assigneeId）、me 只看我的（传 'me'），
   * 与「今天安排」的做法一致。这里拉取范围内全部进行中的待办：首页「待办提醒」再按近
   * 3 天截止筛选，「需要关注」的逾期汇总与问候语计数仍基于同一份数据，保证口径一致。
   */
  async loadTasks(familyId: string): Promise<void> {
    const hasOld = this.data.pendingTasks.length > 0;
    this.setData({
      tasksLoading: !hasOld,
      tasksRefreshing: hasOld,
      tasksError: false,
    });
    try {
      // 跟随设置页「首页数据范围」：all 看全家（不传 assigneeId）、me 只看我的（传 'me'）
      const scope = loadHomeScope(familyId, userStore.value?.id || '');
      const assigneeId = scope === 'all' ? undefined : 'me';
      const tasks = await listTasks(familyId, {
        status: 'pending',
        includeNoDue: true,
        sort: 'due_asc',
        ...(assigneeId ? { assigneeId } : {}),
      });
      if (this.data.currentFamily?.id !== familyId) return;

      this._pendingTasks = tasks;
      const userId = userStore.value?.id;
      if (userId) cacheHomeTasks(userId, familyId, tasks);
      this.setData({ tasksLoading: false, tasksRefreshing: false });
      this.recompute();
    } catch (e) {
      console.error('[Home] Load tasks failed:', e);
      if (this.data.currentFamily?.id !== familyId) return;
      this.setData({ tasksLoading: false, tasksRefreshing: false, tasksError: true });
    }
  },

  onRetryTasks(): void {
    if (this.data.currentFamily) this.loadTasks(this.data.currentFamily.id);
  },

  /**
   * 加载「需要关注」的日子（全部关注项，由服务层分页拉全）。
   * 关注状态完全来自 Core 的 computed，本页不重新判断。
   */
  async loadAttentionDays(familyId: string): Promise<void> {
    const hasOld = this.data.attentionDays.length > 0;
    this.setData({
      daysLoading: !hasOld,
      daysError: false,
    });
    try {
      // 跟随设置页「首页数据范围」：all 看全家（不过滤）、me 只看我的（按当前用户过滤）
      const scope = loadHomeScope(familyId, userStore.value?.id || '');
      const subjectUserId = scope === 'all' ? undefined : (userStore.value?.id || undefined);
      const records = await listAttentionDayRecords(familyId, subjectUserId);
      if (this.data.currentFamily?.id !== familyId) return;
      const userId = userStore.value?.id;
      if (userId) cacheHomeAttentionDays(userId, familyId, records);
      this.setData({
        attentionDays: records.map(mapDayRecordView),
        daysLoading: false,
      });
      // attentionCards 由 attentionDays 派生。
      // 日子请求可能比日程和待办更晚返回，因此必须在这里主动重算，
      // 不能依赖其它并发请求“顺便”触发 recompute。
      this.recompute();
    } catch (e) {
      console.error('[Home] Load attention days failed:', e);
      if (this.data.currentFamily?.id !== familyId) return;
      this.setData({ daysLoading: false, daysError: true });
    }
  },

  onRetryDays(): void {
    if (this.data.currentFamily) this.loadAttentionDays(this.data.currentFamily.id);
  },

  async loadLife(familyId: string, onlyKind?: LifeKind): Promise<void> {
    const kinds: LifeKind[] = (onlyKind ? [onlyKind] : ['habits', 'activities', 'goals'] as LifeKind[])
      .filter(kind => kind !== 'habits' || this._checkingHabits.size === 0);
    if (!kinds.length) return;
    const generations = { ...this._lifeGeneration };
    for (const kind of kinds) {
      generations[kind] = ++this._lifeGeneration[kind];
      this.setData({ [`lifeLoading.${kind}`]: true, [`lifeErrors.${kind}`]: false });
    }
    const isCurrent = (kind: LifeKind) => this.data.currentFamily?.id === familyId &&
      this._lifeGeneration[kind] === generations[kind];
    let people: PersonOption[];
    try {
      await this.ensureUser();
      people = await listDomainPeople(familyId);
    } catch {
      for (const kind of kinds) {
        if (isCurrent(kind)) this.setData({ [`lifeLoading.${kind}`]: false, [`lifeErrors.${kind}`]: true });
      }
      return;
    }
    const myPersonId = people.find(person => person.userId === userStore.value?.id)?.personId || '';
    // 跟随设置页「首页数据范围」：all 看全家（不限定成员，family-wide）、me 只看我的
    const scope = loadHomeScope(familyId, userStore.value?.id || '');
    const fetchPersonId = scope === 'all' ? '' : myPersonId;
    if (kinds.includes('habits') && isCurrent('habits')) this._lifePersonId = fetchPersonId;
    const today = formatInstantInTimeZone(new Date().toISOString(), this.data.currentFamily?.timezone || 'Asia/Shanghai').date;
    await Promise.all(kinds.map(async kind => {
      if (!isCurrent(kind)) return;
      try {
        const records = await listCurrentLifeRecords(familyId, kind, fetchPersonId, today, () => isCurrent(kind));
        if (!isCurrent(kind)) return;
        const rows = homeLifeRows(records, kind, people, fetchPersonId);
        // A poll may finish while a check-in is pending. Keep its button locked.
        rows.forEach(row => { row.checking = this._checkingHabits.has(row.id); });
        this.setData({ [`lifeRecords.${kind}`]: rows, [`lifeErrors.${kind}`]: false,
          canCheckIn: Boolean(fetchPersonId) && (this.data.currentFamily?.role as string) !== 'viewer' });
      } catch {
        if (isCurrent(kind)) this.setData({ [`lifeErrors.${kind}`]: true });
      } finally {
        if (isCurrent(kind)) {
          this.setData({ [`lifeLoading.${kind}`]: false });
        }
      }
    }));
  },

  onLifeTab(e: WechatMiniprogram.TouchEvent): void {
    const kind = e.currentTarget.dataset.kind as LifeKind;
    if (['habits', 'activities', 'goals'].includes(kind)) this.setData({ lifeTab: kind });
  },

  onRetryLife(): void {
    if (this.data.currentFamily) void this.loadLife(this.data.currentFamily.id, this.data.lifeTab);
  },

  onViewLife(): void {
    if (!this.data.currentFamily) return;
    const kind = this.data.lifeTab;
    wx.navigateTo({ url: '/pages/domains/list?kind=' + kind + '&familyId=' + this.data.currentFamily.id +
      (kind === 'habits' ? '&mine=1' : '') });
  },

  onLifeRecordTap(e: WechatMiniprogram.TouchEvent): void {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id || !this.data.currentFamily) return;
    wx.navigateTo({ url: '/pages/domains/detail?kind=' + this.data.lifeTab + '&familyId=' +
      this.data.currentFamily.id + '&id=' + encodeURIComponent(id) });
  },

  async onHabitCheckIn(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const id = String(e.currentTarget.dataset.id || '');
    const habit = this.data.lifeRecords.habits.find(record => record.id === id);
    const familyId = this.data.currentFamily?.id;
    if (!familyId || !habit || !this.data.canCheckIn || !this._lifePersonId ||
      habit.subjectPersonId !== this._lifePersonId || habit.status !== 'active' ||
      !habit.computed?.checkIn || habit.checkedInToday || this._checkingHabits.has(id)) return;
    this._checkingHabits.add(id);
    ++this._lifeGeneration.habits;
    const context = this._lifeContext;
    let reload = false;
    this.setData({ 'lifeLoading.habits': false, 'lifeRecords.habits': this.data.lifeRecords.habits.map(row =>
      row.id === id ? { ...row, checking: true } : row) });
    try {
      const updated = await performDomainAction(familyId, 'habits', id, 'check-in', habit.version);
      if (this.data.currentFamily?.id !== familyId || this._lifeContext !== context) return;
      // Update in place: don't move the tapped row out from under the user's finger.
      this.setData({ 'lifeRecords.habits': this.data.lifeRecords.habits.map(row => row.id === id ? {
        ...row, ...updated, checkedInToday: Boolean(updated.computed?.checkIn?.checkedInToday),
        streakDays: updated.computed?.checkIn?.streakDays || 0, checking: false,
      } : row) });
      showSuccess('打卡成功');
    } catch (error) {
      if (this.data.currentFamily?.id !== familyId || this._lifeContext !== context) return;
      const err = error as { code?: string; message?: string };
      showError(isVersionConflict(err.code) ? '习惯已更新，请查看最新状态后重试' :
        getErrorMessage(err.code, err.message) || '打卡失败，请重试');
      // Refresh for review, never replay the write automatically.
      reload = true;
    } finally {
      if (this.data.currentFamily?.id === familyId && this._lifeContext === context) {
        this._checkingHabits.delete(id);
        this.setData({ 'lifeRecords.habits': this.data.lifeRecords.habits.map(row =>
          row.id === id ? { ...row, checking: false } : row) });
        if (reload) void this.loadLife(familyId, 'habits');
      }
    }
  },

  /** 点击「需要关注」的横向卡片进入对应页面（见 onAttentionCardTap） */

  /** 查看全部日子 */
  onViewDays(): void {
    if (!this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/days/list?familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 查看许愿池 */
  onViewWishes(): void {
    if (!this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/wishes/list?familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 新建日子 */
  onCreateDay(): void {
    if (!this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/days/edit?familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 新建愿望 */
  onCreateWish(): void {
    if (!this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/wishes/edit?familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 由原始数据派生所有展示字段：列表、计数、副标题、需要关注卡片 */
  recompute(): void {
    // 待办截止日期是家庭时区下的纯日期
    const familyTimezone = this.data.currentFamily?.timezone || 'Asia/Shanghai';
    const today = formatInstantInTimeZone(new Date().toISOString(), familyTimezone).date;
    const tomorrow = addDaysToDateOnly(today, 1);

    // 日程展示使用与筛选一致的查看时区（跟随用户时区设置）
    const viewingTimezone = getViewingTimeZone(this.data.currentFamily?.timezone);
    const now = Date.now();
    // 已结束的日程不再在首页「今天安排」展示；剩余按开始时间升序（全天优先，
    // 即将开始/正在进行排前，已结束排后），让最该关注的排在前面。
    const todayEvents = [...this._todayEvents]
      .filter(event => !(isEventEnded(event, now)))
      .sort((a, b) => eventDisplayRank(a, b, now))
      .map(event => mapTodayEvent(event, viewingTimezone, now));
    // 待办提醒：只保留截止日期在近 3 天（今天 / 明天 / 后天）内的待办，
    // 已逾期的没有下界始终包含，无截止日期的不进入该列表；按截止日期升序。
    const dueWindowEnd = addDaysToDateOnly(today, HOME_TASK_DUE_DAYS - 1);
    const pendingTasks = this._pendingTasks
      .filter((t) => t.status === 'pending' && !!t.dueDate && t.dueDate <= dueWindowEnd)
      .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0))
      .map((t) => {
        const v = mapTaskHome(t, today, tomorrow);
        v.completing = this._completingIds.has(t.id);
        return v;
      });

    const todayEventCount = todayEvents.length;
    const pendingTaskCount = this._pendingTasks.length;
    const overdueCount = this._pendingTasks.filter(
      (t) => t.status === 'pending' && !!t.dueDate && t.dueDate < today,
    ).length;
    const pendingTaskMore = Math.max(0, pendingTasks.length - HOME_TASK_LIMIT);
    const urgent = findUrgentEvent(this._todayEvents);

    // 构建「需要关注」横向卡片（聚合日子关注项 + 逾期待办汇总 + 紧急日程）
    const attentionCards = buildAttentionCards(
      this.data.attentionDays,
      overdueCount,
      urgent,
    );

    const fingerprint =
      todayEvents.map((e) => `${e.id}:${e.isEnded ? 1 : 0}:${e.isOngoing ? 1 : 0}`).join('|') +
      '#' +
      pendingTasks.map((t) => `${t.id}:${t.isOverdue ? 1 : 0}:${t.completing ? 1 : 0}`).join('|') +
      `#${pendingTaskCount}:${pendingTaskMore}#` +
      attentionCards.map((c) => `${c.kind}:${c.id}:${c.level}`).join('|');
    // 每分钟重算时：若「进行中 / 已结束 / 逾期 / 提交中 / 关注卡」展示态都没有变化，跳过 setData，
    // 避免列表无谓闪动；计数也随指纹一并稳定。
    if (fingerprint === this._statusFingerprint) return;
    this._statusFingerprint = fingerprint;

    this.setData({
      todayEvents: todayEvents,
      todayEventCount,
      pendingTasks: pendingTasks.slice(0, HOME_TASK_LIMIT),
      pendingTaskCount,
      pendingTaskMore,
      attentionCards,
    });
  },

  /** 点击日程进入详情 */
  onEventTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id || !this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/events/detail?id=${id}&familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 点击待办进入详情 */
  onTaskTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id || !this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/tasks/detail?id=${id}&familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 在首页快速完成待办（仅 pending → completed，避免误恢复） */
  async onToggleTaskStatus(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const id = e.currentTarget.dataset.id as string;
    const task = this._pendingTasks.find((t) => t.id === id);
    if (!task || this._completingIds.has(id) || !this.data.currentFamily) return;
    const familyId = this.data.currentFamily.id;

    this._completingIds.add(id);
    this.recompute();

    try {
      await completeTask(familyId, id, task.version);
      if (familyId !== this.data.currentFamily?.id) return;
      this._pendingTasks = this._pendingTasks.filter((t) => t.id !== id);
      this._completingIds.delete(id);
      const userId = userStore.value?.id;
      if (userId) cacheHomeTasks(userId, familyId, this._pendingTasks);
      this.recompute();
      markDirty('tasks');
      showSuccess('已完成');
    } catch (error: unknown) {
      if (familyId !== this.data.currentFamily?.id) return;
      this._completingIds.delete(id);
      this.recompute();
      console.error('[Home] Toggle task status failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError(getErrorMessage(err.code) || '内容已被其他家庭成员修改，请刷新后重试');
        this.loadTasks(familyId);
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '操作失败，请重试');
    }
  },

  /** 点击「需要关注」横向卡片：根据卡片类型进入对应页面 */
  onAttentionCardTap(e: WechatMiniprogram.TouchEvent): void {
    const { navigate, id } = e.currentTarget.dataset as { navigate: string; id: string };
    if (navigate === 'day' && id && this.data.currentFamily) {
      wx.navigateTo({
        url: `/pages/days/detail?id=${id}&familyId=${this.data.currentFamily.id}`,
      });
    } else if (navigate === 'event' && id && this.data.currentFamily) {
      wx.navigateTo({
        url: `/pages/events/detail?id=${id}&familyId=${this.data.currentFamily.id}`,
      });
    } else if (navigate === 'tasks') {
      this.onViewTasks();
    }
  },

  /** 查看全部日程 */
  onViewEvents(): void {
    wx.switchTab({ url: '/pages/events/events' });
  },

  /** 查看全部待办 */
  onViewTasks(): void {
    wx.switchTab({ url: '/pages/tasks/tasks' });
  },

  /** 新建日程 */
  onCreateEvent(): void {
    if (!this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/events/edit?familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 新建待办 */
  onCreateTask(): void {
    if (!this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/tasks/edit?familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 创建家庭（无家庭时入口） */
  onCreateFamily(): void {
    wx.navigateTo({ url: '/pages/family/create' });
  },

  /** 加入家庭（无家庭时入口） */
  onJoinFamily(): void {
    wx.navigateTo({ url: '/pages/family/join' });
  },
});

/* ----------------- 工具函数 ----------------- */

/**
 * 主时间使用查看时区（与「今天」的判断一致）；
 * startTimezone 只有在与查看时区不同时才作为地点时区标签补充展示。
 */
function mapTodayEvent(e: Event, viewingTimezone: string, now: number): TodayEventView {
  let timeText = '全天';
  if (!e.isAllDay) {
    timeText = formatInstantInTimeZone(e.startAt, viewingTimezone).time;
    if (e.startTimezone && e.startTimezone !== viewingTimezone) {
      const atOrigin = formatInstantInTimeZone(e.startAt, e.startTimezone);
      timeText = `${timeText}（${timeZoneLabel(e.startTimezone)} ${atOrigin.time}）`;
    }
  }
  // 已结束 / 进行中：复用纯函数模块（与日程页同一套判据）
  const isEnded = isEventEnded(e, now);
  const isOngoing = isEventOngoing(e, now);
  return { id: e.id, summary: e.summary, timeText, isAllDay: e.isAllDay, isEnded, isOngoing };
}

/**
 * 截止日期文案。负责人单独作为一个标签展示，不再借道本函数，
 * 否则有截止日期时负责人会被吞掉。
 */
function taskDueLabel(t: Task, today: string, tomorrow: string): string {
  if (!t.dueDate) return '';
  if (t.dueDate < today) return '已逾期';
  if (t.dueDate === today) return '今天';
  if (t.dueDate === tomorrow) return '明天';
  return formatDate(t.dueDate, 'date');
}

function mapTaskHome(t: Task, today: string, tomorrow: string): TaskHomeView {
  const isOverdue = t.status === 'pending' && !!t.dueDate && t.dueDate < today;
  const assigneeText = (t.assignees || []).map((a) => a.displayName).join('、');
  return {
    id: t.id,
    name: t.name,
    status: t.status as 'pending' | 'completed',
    dueDate: t.dueDate,
    dueText: taskDueLabel(t, today, tomorrow),
    isOverdue,
    assigneeText,
    version: t.version,
    completing: false,
  };
}

/**
 * 找出应进入「需要关注」的紧急日程：
 * - 正在进行中的非全天日程（优先）；
 * - 否则 30 分钟内即将开始的非全天日程。
 * 只取最近的一张。返回中 `ongoing` 标记是否正在进行。
 */
function findUrgentEvent(
  events: Event[],
): { id: string; summary: string; minutes: number; ongoing: boolean } | null {
  const now = Date.now();
  let best: { id: string; summary: string; minutes: number; ongoing: boolean } | null = null;
  for (const e of events) {
    if (e.isAllDay) continue;
    // 正在进行中
    if (isEventOngoing(e, now)) {
      if (!best) best = { id: e.id, summary: e.summary, minutes: 0, ongoing: true };
      continue;
    }
    const start = new Date(e.startAt).getTime();
    const diff = start - now;
    if (diff >= 0 && diff <= 30 * 60000) {
      const minutes = Math.max(1, Math.round(diff / 60000));
      if (!best || !best.ongoing || minutes < best.minutes) {
        best = { id: e.id, summary: e.summary, minutes, ongoing: false };
      }
    }
  }
  return best;
}

/**
 * 聚合「需要关注」横向卡片：
 *   A. 日子关注项（来自 Core computed，状态完全由后端决定）
 *   B. 逾期待办（仅一张汇总卡）
 *   C. 紧急日程（仅最近一张）
 *
 * 排序：critical → warning → info；同级按实际日期或发生时间升序。
 */
function buildAttentionCards(
  dayViews: DayRecordView[],
  overdueCount: number,
  urgent: { id: string; summary: string; minutes: number; ongoing: boolean } | null,
): AttentionCard[] {
  const cards: AttentionCard[] = [];

  // A. 日子关注项
  for (const d of dayViews) {
    const dayFields = buildDayAttentionCard(d);
    cards.push({
      kind: 'day',
      id: d.id,
      title: d.name,
      desc: '',
      icon: d.icon,
      level: (d.isAttentionRequired ? d.attentionLevel : 'info') as AttentionCard['level'],
      navigate: 'day',
      targetId: d.id,
      ...dayFields,
    });
  }

  // B. 逾期待办汇总卡（仅一张）
  if (overdueCount > 0) {
    cards.push({
      kind: 'overdue-tasks',
      id: 'overdue-tasks',
      title: '待办已逾期',
      desc: `有 ${overdueCount} 件事情需要处理`,
      icon: '⚠️',
      level: 'critical',
      navigate: 'tasks',
      targetId: '',
    });
  }

  // C. 紧急日程（仅最近一张）
  if (urgent) {
    cards.push({
      kind: 'urgent-event',
      id: urgent.id,
      title: urgent.summary,
      desc: urgent.ongoing ? '正在进行中' : `还有 ${urgent.minutes} 分钟开始`,
      icon: '⏰',
      level: 'warning',
      navigate: 'event',
      targetId: urgent.id,
    });
  }

  // 排序：关注级别升序；同级按标题稳定排序（避免频繁抖动）
  return cards.sort((a, b) => {
    const r = attentionLevelRank(a.level) - attentionLevelRank(b.level);
    if (r !== 0) return r;
    return a.title.localeCompare(b.title);
  });
}

/**
 * 从日子视图拆分出「需要关注」卡片的结构化字段：
 * - 高亮数字（dayNumber）与单位（dayUnit）分离，便于 WXML 单独加粗高亮；
 * - 不同 kind 给出不同布局与补充文案。
 *
 * 文案仍由 DayRecordView 的 primaryText / secondaryText 派生，不重新判断业务规则。
 */
function buildDayAttentionCard(d: DayRecordView): Partial<AttentionCard> {
  const { primaryText, secondaryText, kind, progressRatio } = d;

  // 从「已使用 86 天」「还有 4 天」等文案中提取首个数字
  const numMatch = /^([^\d]*?)(\d+)(.*)$/.exec(primaryText);
  const dayNumber = numMatch ? numMatch[2] : '';
  const dayUnit = numMatch ? numMatch[3] : primaryText;

  if (kind === 'cycle') {
    const subText = secondaryText || '周期事项';
    return {
      dayType: 'cycle',
      dayNumber,
      dayUnit,
      daySubText: subText,
      dayProgress: progressRatio != null ? Math.round(progressRatio * 100) : null,
    };
  }

  if (kind === 'countdown') {
    // countdown 的 secondaryText 是锚点日期（如「2026年8月19日」）
    return {
      dayType: 'countdown',
      dayNumber,
      dayUnit,
      daySubText: secondaryText || '',
      dayProgress: null,
    };
  }

  // elapsed：secondaryText 可能是「已达到提醒时间」或空串
  return {
    dayType: 'elapsed',
    dayNumber,
    dayUnit,
    daySubText: secondaryText || '生活记录',
    dayProgress: null,
  };
}
