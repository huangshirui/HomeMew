/**
 * 日程页（纵向时间线 + 折叠月历 + 成员日历范围）
 *
 * 结构：
 * - 顶栏：成员范围选择（全家 / 我 / 指定成员，按用户持久化）+「今天」；
 * - 折叠月历条：显示当前可见月份，点击或下滑展开完整月历，点日期定位列表并自动折叠；
 * - 时间线：日程按日期分组连续展示，双向分段加载。
 *
 * 加载策略：「时间窗口 + 窗口内游标」——
 * - 首次以今天为锚点加载 [今天-7, 今天+30)；
 * - 接近顶部 / 底部时按 30 天窗口向前 / 向后扩展；
 * - Core 是重叠查询，跨窗口多日事件会重复返回，统一按 event id 去重；
 * - 前后各 365 天为浏览上限，显示「已加载到最早 / 最晚」。
 *
 * 时区：本页有唯一的「查看时区」viewingTimezone（设备时区，缺失时回退家庭时区）。
 * 它既是列表接口 `timezone` 查询参数，也是列表归组、月历圆点、「今天」判断的唯一依据，
 * 保证客户端分到的日期与 Core 的查询窗口完全一致。
 * 事件的 startTimezone/endTimezone 只是端点地点时区元数据（如航班出发地 / 到达地），
 * 仅用于卡片与详情上的时间标签，不参与归组。全天事件只做纯日期运算。
 */

import { fetchEventsPage } from '../../services/events';
import { listFamilyMembers } from '../../services/families';
import { currentFamilyStore, userStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { consumeDirty, markDirty, subscribe } from '../../stores/dirty';
import {
  loadEventsScope,
  saveEventsScope,
  EventsScope,
} from '../../stores/events-scope';
import {
  showError,
  getErrorMessage,
  parseDateOnly,
  formatDateOnly,
  addDaysToDateOnly,
  safeAvatarUrl,
  formatInstantInTimeZone,
  timeZoneLabel,
} from '../../utils/index';
import { getViewingTimeZone } from '../../services/settings';
import {
  DayCell,
  maxYmd,
  minYmd,
  addMonths,
  monthLabelOf,
  dateLabelOf,
  weekLabelOf,
  eventDaysInRange,
  buildCalendarMatrix,
  pad2 as pad,
} from '../../utils/event-timeline';
import { Event, FamilyMember } from '../../types/index';
import { isEventEnded } from '../../utils/event-status';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** 注入 eventDaysInRange 的时区换算：走 datetime 静态偏移表方案，真机不依赖 Intl */
const instantDate = (instant: string, timeZone: string): string =>
  formatInstantInTimeZone(instant, timeZone).date;

/**
 * 当前查看时区，由页面在解析出 _viewingTimezone 后同步过来，
 * 保证 todayYmd() 的「今天」与列表归组落在同一个时区。
 */
let viewingTimezoneForToday = '';

/** 初始窗口：过去 7 天 + 未来 30 天 */
const INIT_BACK_DAYS = 7;
const INIT_FWD_DAYS = 30;
/** 每次扩展的时间窗口天数 */
const WINDOW_DAYS = 30;
/** 浏览上限：今天前后各 365 天 */
const RANGE_LIMIT_DAYS = 365;
/** 单窗口内最多翻页次数（防失控） */
const MAX_PAGES_PER_WINDOW = 10;
/** 距顶部 / 底部约 2~3 屏时提前触发加载（px） */
const EDGE_THRESHOLD_PX = 1200;

/**
 * 后台轮询间隔（毫秒）：页面可见期间每 60 秒原地重拉一次已加载窗口，
 * 让其他家庭成员的新增 / 修改 / 删除在无需用户操作时也能自动出现。
 * 页面隐藏时停止，不消耗流量。
 */
const POLL_INTERVAL_MS = 60 * 1000;

type EventItemView = {
  id: string;
  summary: string;
  isAllDay: boolean;
  /** 普通日程 "16:00–18:00"；全天为空（用标签展示） */
  timeText: string;
  /** "KK、天宝 · 奥体中心" */
  metaText: string;
  /** 非全天且结束时刻早于当前，视为已结束（置灰展示） */
  isEnded: boolean;
};

type DaySection = {
  /** 锚点 id：sec-YYYY-MM-DD */
  id: string;
  date: string;
  /** "7月27日"（跨年时带年份） */
  dateLabel: string;
  /** "周一" */
  weekLabel: string;
  /** "2026年7月" */
  monthLabel: string;
  isToday: boolean;
  items: EventItemView[];
};

type ScopeOption = {
  key: string;
  label: string;
  avatarUrl: string;
  showAvatar: boolean;
};

Page({
  data: {
    weekLabels: WEEK_LABELS,

    // 页面骨架状态
    loaded: false,
    initError: false,
    noFamily: false,
    familyId: '' as string,

    // 成员范围
    scope: 'me' as EventsScope,
    scopeLabel: '我的',
    scopeOptions: [] as ScopeOption[],
    showScopeSheet: false,

    // 折叠月历
    monthLabel: '',
    calendarExpanded: false,
    calYear: 0,
    calMonth: 0,
    calendar: [] as DayCell[][],
    // 折叠态紧凑周条（当前周，周一..周日）
    visibleDate: '' as string,
    weekStrip: [] as { date: string; day: number; isToday: boolean }[],

    // 时间线
    sections: [] as DaySection[],
    isEmpty: false,
    loadingBack: false,
    loadingFwd: false,
    backError: false,
    fwdError: false,
    reachedEarliest: false,
    reachedLatest: false,
    edgeThreshold: EDGE_THRESHOLD_PX,

    // 受控滚动
    scrollTop: 0,
    scrollIntoView: '',
  },

  /** 请求序号：用于丢弃过期（家庭切换 / 范围切换 / 重新锚定）返回结果 */
  _reqSeq: 0,
  /** 缓存 onLoad 入参，供初始化失败后重试复用 */
  _initOptions: null as { date?: string; familyId?: string; attendee?: string } | null,
  /** 去重后的全部已加载事件：id -> Event */
  _events: {} as Record<string, Event>,
  /** 已加载范围 [start, end)，YYYY-MM-DD */
  _rangeStart: '',
  _rangeEnd: '',
  /** 浏览上限 */
  _minDate: '',
  _maxDate: '',
  /** 无日程但需要展示的占位日期（今天 / 锚点 / 点选日期） */
  _placeholderDates: [] as string[],
  /** 家庭成员（用于范围选择器） */
  _members: [] as FamilyMember[],
  /** 展开月历圆点缓存：`${scope}|${monthKey}` -> 有日程的日期数组 */
  _dotCache: {} as Record<string, string[]>,
  /** 双向加载互斥标志 */
  _loadingBack: false,
  _loadingFwd: false,
  /** 实时滚动位置镜像（避免频繁 setData） */
  _scrollTop: 0,
  /** 各日分组在内容中的纵向位置（月份联动用） */
  _sectionTops: [] as { date: string; top: number; monthLabel: string }[],
  _lastMonthSyncAt: 0,
  /** 当前可见（列表顶部）的日期 */
  _visibleDate: '',
  /** scroll-into-view 定位动画期间抑制边缘自动加载，避免滚动位置互相干扰 */
  _suppressEdgeUntil: 0,
  /** 月历手势起点 */
  _calTouchY: 0,
  // 脏标记订阅句柄
  _dirtyUnsubscribe: null as (() => void) | null,
  /** 每分钟本地重算定时器（只重算展示态，不重新拉后台） */
  _tickTimer: null as ReturnType<typeof setInterval> | null,
  /** 后台轮询定时器（页面可见期间才运行，拉取其他成员的变更） */
  _pollTimer: null as ReturnType<typeof setInterval> | null,
  /** 上次真正发起后台拉取的时间戳，用于轮询节流 */
  _lastFetchAt: 0,
  /** 上次重算得到的 isEnded 指纹，用于跳过无变化的 setData */
  _endedFingerprint: '' as string,
  /** 查看时区：请求参数与列表归组共用同一个值 */
  _viewingTimezone: 'Asia/Shanghai',

  async onLoad(options: { date?: string; familyId?: string; attendee?: string }): Promise<void> {
    this._initOptions = options;
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[Events] Runtime bootstrap failed:', error);
      this.setData({ loaded: true, initError: true });
      return;
    }
    const familyId = currentFamilyStore.value?.id || options.familyId || '';
    if (!familyId) {
      this.setData({ loaded: true, noFamily: true });
      return;
    }
    // 查看时区必须先解析：todayYmd() 依赖它
    this._resolveViewingTimezone();
    const anchor = options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
      ? options.date
      : todayYmd();
    const uid = userStore.value?.id || '';
    // 带 attendee=me 参数进入时仅本次生效，不覆盖持久化选择
    const scope: EventsScope = options?.attendee === 'me'
      ? 'me'
      : loadEventsScope(familyId, uid);
    this.setData({
      familyId,
      noFamily: false,
      scope,
      scopeLabel: this.labelForScope(scope),
    });
    this.loadMembers();
    this.initialLoad(anchor);
  },

  onShow(): void {
    this.getTabBar()?.setData({ selected: 1 });
    this._subscribeDirty();
    this._startPoll();
    const familyId = currentFamilyStore.value?.id || '';
    // 从无家庭恢复到有家庭
    if (familyId && this.data.noFamily) {
      this.resetForFamily(familyId);
      return;
    }
    // 家庭切换
    if (familyId && this.data.familyId && familyId !== this.data.familyId) {
      this.resetForFamily(familyId);
      return;
    }
    // 变为无家庭
    if (!familyId && this.data.loaded && !this.data.noFamily) {
      this.setData({ noFamily: true });
      return;
    }
    // 新建 / 编辑 / 删除后返回：原地刷新已加载范围，保持成员范围与滚动位置
    if (this.data.loaded && !this.data.noFamily && consumeDirty('events')) {
      this.refreshLoadedRange();
    }
    this._startTick();
  },

  onHide(): void {
    this._unsubscribeDirty();
    this._stopTick();
    this._stopPoll();
  },

  onUnload(): void {
    this._unsubscribeDirty();
    this._stopTick();
    this._stopPoll();
  },

  /**
   * 启动后台轮询：页面可见期间每 60 秒原地重拉一次已加载窗口
   * （refreshLoadedRange 保持成员范围与滚动位置，不会跳回今天）。
   *
   * 注意：
   * - 只在 onShow 启动、onHide / onUnload 停止；
   * - 通过 _lastFetchAt 节流，刚拉过（首屏 / 脏标记 / 扩展窗口 / 切范围）就跳过本轮；
   * - 家庭切换时由 onShow 的 resetForFamily 接管，轮询自身校验 familyId 不发旧请求；
   * - refreshLoadedRange 内部的 _reqSeq + familyId 校验会丢弃过期响应；
   * - 正在双向扩展加载时跳过本轮，避免与窗口扩展互相覆盖。
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

  _poll(): void {
    if (!this.data.loaded || this.data.noFamily) return;
    const familyId = currentFamilyStore.value?.id || '';
    if (!familyId || familyId !== this.data.familyId) return;
    // 正在扩展窗口：本轮跳过，等扩展完成后的下一轮再刷新
    if (this._loadingBack || this._loadingFwd) return;
    if (Date.now() - this._lastFetchAt < POLL_INTERVAL_MS) return;
    this.refreshLoadedRange();
  },

  /** 启动每分钟本地重算：仅用已缓存事件重算「已结束」等展示态，不请求后台 */
  _startTick(): void {
    if (this._tickTimer) return;
    // 立即重算一次：从详情页返回 / 切回 tab 时，缓存的展示态可能已在页面不可见期间
    // 发生变化，应立刻反映，而不是等下一个 60 秒 tick。
    this.recomputeSections();
    this._tickTimer = setInterval(() => this.recomputeSections(), 60 * 1000);
  },

  _stopTick(): void {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  },

  /**
   * 每分钟本地重算：基于已缓存的 _events 重建 sections（主要是 isEnded 置灰态），
   * 不调用任何后台接口。与 refreshLoadedRange 区分开——后者会重新拉取后台数据。
   */
  recomputeSections(): void {
    if (!this.data.loaded || this.data.noFamily) return;
    const { sections } = this.buildSections();
    const fingerprint = sections
      .map(s => s.items.map(i => `${i.id}:${i.isEnded ? 1 : 0}`).join(','))
      .join('|');
    if (fingerprint === this._endedFingerprint) return;
    this._endedFingerprint = fingerprint;
    this._applySections({});
  },

  /** 家庭变化后完全重置（范围偏好按新家庭恢复） */
  resetForFamily(familyId: string): void {
    const uid = userStore.value?.id || '';
    const scope = loadEventsScope(familyId, uid);
    this._members = [];
    this._dotCache = {};
    this._resolveViewingTimezone();
    this.setData({
      familyId,
      noFamily: false,
      scope,
      scopeLabel: this.labelForScope(scope),
      scopeOptions: [],
      calendarExpanded: false,
      showScopeSheet: false,
    });
    this.loadMembers();
    this.initialLoad(todayYmd());
  },

  /**
   * 解析本页唯一的查看时区：设备时区优先，无效时回退家庭时区。
   * 请求参数、列表归组、月历圆点、「今天」判断全部使用这一个值。
   */
  _resolveViewingTimezone(): void {
    // 统一经设置获取查看时区（跟随系统时区 / 指定时区）
    this._viewingTimezone = getViewingTimeZone(currentFamilyStore.value?.timezone);
    viewingTimezoneForToday = this._viewingTimezone;
  },

  _subscribeDirty(): void {
    this._unsubscribeDirty();
    this._dirtyUnsubscribe = subscribe((domain) => {
      if (domain !== 'events') return;
      if (!this.data.loaded || this.data.noFamily) return;
      if (currentFamilyStore.value?.id !== this.data.familyId) return;
      consumeDirty('events');
      this.refreshLoadedRange();
    });
  },

  _unsubscribeDirty(): void {
    if (this._dirtyUnsubscribe) {
      this._dirtyUnsubscribe();
      this._dirtyUnsubscribe = null;
    }
  },

  /* ---------------- 成员范围 ---------------- */

  async loadMembers(): Promise<void> {
    const familyId = this.data.familyId;
    if (!familyId) return;
    try {
      const members = await listFamilyMembers(familyId);
      if (familyId !== this.data.familyId) return;
      this._members = members;
      this.buildScopeOptions();
      // 持久化的成员范围已不在家庭中：回落到「我的日历」
      const scope = this.data.scope;
      if (scope !== 'all' && scope !== 'me' && !members.some(m => m.userId === scope)) {
        this.onScopeFallbackToMe();
      } else {
        this.setData({ scopeLabel: this.labelForScope(scope) });
      }
    } catch (error) {
      // 成员列表加载失败不阻塞时间线；打开选择器时会再尝试
      console.error('[Events] Load members failed:', error);
    }
  },

  onScopeFallbackToMe(): void {
    const uid = userStore.value?.id || '';
    saveEventsScope(this.data.familyId, uid, 'me');
    this._dotCache = {};
    this.setData({ scope: 'me', scopeLabel: this.labelForScope('me') });
    // 成员范围变化：通知首页「今天安排」以新范围重新拉取
    markDirty('events');
    this.initialLoad(todayYmd());
  },

  buildScopeOptions(): void {
    const uid = userStore.value?.id || '';
    const user = userStore.value;
    const options: ScopeOption[] = [
      { key: 'all', label: '全家', avatarUrl: '', showAvatar: false },
      {
        key: 'me',
        label: '我的',
        avatarUrl: safeAvatarUrl(user?.avatarUrl),
        showAvatar: true,
      },
    ];
    this._members
      .filter(m => m.userId !== uid)
      .forEach(m => {
        options.push({
          key: m.userId,
          label: m.displayName,
          avatarUrl: safeAvatarUrl(m.avatarUrl),
          showAvatar: true,
        });
      });
    this.setData({ scopeOptions: options });
  },

  labelForScope(scope: EventsScope): string {
    if (scope === 'all') return '全家';
    if (scope === 'me') return '我的';
    const member = this._members.find(m => m.userId === scope);
    return member ? `${member.displayName}的日历` : '家人日历';
  },

  /** scope -> 接口 attendeeId 参数 */
  attendeeParam(): string | undefined {
    const scope = this.data.scope;
    if (scope === 'all') return undefined;
    if (scope === 'me') return 'me';
    return scope;
  },

  onOpenScope(): void {
    if (this.data.scopeOptions.length === 0) {
      this.buildScopeOptions();
    }
    if (this._members.length === 0) {
      this.loadMembers();
    }
    this.setData({ showScopeSheet: true });
  },

  onCloseScope(): void {
    this.setData({ showScopeSheet: false });
  },

  onSelectScope(e: WechatMiniprogram.TouchEvent): void {
    const key = e.currentTarget.dataset.key as string;
    if (!key) return;
    this.setData({ showScopeSheet: false });
    if (key === this.data.scope) return;
    const uid = userStore.value?.id || '';
    saveEventsScope(this.data.familyId, uid, key);
    this._dotCache = {};
    this.setData({
      scope: key,
      scopeLabel: this.labelForScope(key),
      calendarExpanded: false,
    });
    // 切换成员后回到今天并重新加载
    markDirty('events');
    this.initialLoad(todayYmd());
  },

  /* ---------------- 数据加载 ---------------- */

  /**
   * 拉满一个时间窗口内的所有分页（窗口内游标）。
   *
   * 查询窗口与归组窗口完全一致：两者都以 _viewingTimezone 解释日期，
   * 因此无需再前后各扩几天来「兜底」——那样只会引入窗口外的事件。
   */
  async loadWindow(start: string, end: string): Promise<Event[]> {
    const familyId = this.data.familyId;
    const attendeeId = this.attendeeParam();
    // 记录拉取时间：任何来源（首屏 / 扩展窗口 / 脏标记 / 切范围 / 轮询）都刷新节流窗口
    this._lastFetchAt = Date.now();
    const items: Event[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES_PER_WINDOW; page++) {
      const data = await fetchEventsPage(familyId, {
        startDate: start,
        endDateExclusive: end,
        timezone: this._viewingTimezone,
        ...(attendeeId ? { attendeeId } : {}),
        ...(cursor ? { cursor } : {}),
        limit: 100,
      });
      items.push(...(data.items ?? []));
      if (!data.nextCursor) break;
      cursor = data.nextCursor;
    }
    return items;
  },

  mergeEvents(events: Event[]): void {
    events.forEach(e => {
      this._events[e.id] = e;
    });
  },

  /** 以 anchor 为中心重新加载（首次进入 / 切范围 / 跳远日期 / 回今天） */
  async initialLoad(anchor: string): Promise<void> {
    const familyId = this.data.familyId;
    if (!familyId) return;
    const reqSeq = ++this._reqSeq;
    const today = todayYmd();
    this._minDate = addDaysToDateOnly(today, -RANGE_LIMIT_DAYS);
    this._maxDate = addDaysToDateOnly(today, RANGE_LIMIT_DAYS);
    const start = maxYmd(this._minDate, addDaysToDateOnly(anchor, -INIT_BACK_DAYS));
    const end = minYmd(this._maxDate, addDaysToDateOnly(anchor, INIT_FWD_DAYS));
    this._events = {};
    this._placeholderDates = anchor === today ? [today] : [today, anchor];
    this._sectionTops = [];
    this.setVisibleDate(anchor);
    this._loadingBack = false;
    this._loadingFwd = false;
    this.setData({
      loaded: false,
      initError: false,
      loadingBack: false,
      loadingFwd: false,
      backError: false,
      fwdError: false,
      sections: [],
      isEmpty: false,
      scrollIntoView: '',
      monthLabel: monthLabelOf(anchor),
    });
    try {
      const events = await this.loadWindow(start, end);
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      this.mergeEvents(events);
      this._rangeStart = start;
      this._rangeEnd = end;
      await this._applySections({
        loaded: true,
        reachedEarliest: start <= this._minDate,
        reachedLatest: end >= this._maxDate,
      });
      this.scrollToDate(anchor);
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      console.error('[Events] Initial load failed:', error);
      this.setData({ loaded: false, initError: true });
    }
  },

  onRetryInit(): void {
    // 既覆盖首屏数据加载失败，也覆盖运行时初始化失败：重新走完整 onLoad
    this.onLoad(this._initOptions || {});
  },

  /** 向上扩展一个 30 天窗口，并保持视口内容不跳动 */
  async loadOlder(): Promise<void> {
    if (!this.data.loaded || this._loadingBack || this.data.reachedEarliest) return;
    if (this._rangeStart <= this._minDate) {
      this.setData({ reachedEarliest: true });
      return;
    }
    const familyId = this.data.familyId;
    const reqSeq = this._reqSeq;
    this._loadingBack = true;
    this.setData({ loadingBack: true, backError: false });
    const newStart = maxYmd(this._minDate, addDaysToDateOnly(this._rangeStart, -WINDOW_DAYS));
    try {
      const events = await this.loadWindow(newStart, this._rangeStart);
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      this.mergeEvents(events);
      this._rangeStart = newStart;
      // 头部插入内容前后测量高度差，补偿 scrollTop，保证当前内容不跳动
      const before = await this._measureContentHeight();
      const prevTop = this._scrollTop;
      await this._applySections({
        loadingBack: false,
        reachedEarliest: newStart <= this._minDate,
      });
      const after = await this._measureContentHeight();
      const delta = Math.max(0, after - before);
      if (delta > 0) {
        const target = prevTop + delta;
        this._scrollTop = target;
        this.setData({ scrollTop: target });
      }
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      console.error('[Events] Load older failed:', error);
      this.setData({ loadingBack: false, backError: true });
    } finally {
      this._loadingBack = false;
      if (reqSeq === this._reqSeq && this.data.loadingBack) {
        this.setData({ loadingBack: false });
      }
    }
  },

  /** 向下扩展一个 30 天窗口 */
  async loadNewer(): Promise<void> {
    if (!this.data.loaded || this._loadingFwd || this.data.reachedLatest) return;
    if (this._rangeEnd >= this._maxDate) {
      this.setData({ reachedLatest: true });
      return;
    }
    const familyId = this.data.familyId;
    const reqSeq = this._reqSeq;
    this._loadingFwd = true;
    this.setData({ loadingFwd: true, fwdError: false });
    const newEnd = minYmd(this._maxDate, addDaysToDateOnly(this._rangeEnd, WINDOW_DAYS));
    try {
      const events = await this.loadWindow(this._rangeEnd, newEnd);
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      this.mergeEvents(events);
      this._rangeEnd = newEnd;
      await this._applySections({
        loadingFwd: false,
        reachedLatest: newEnd >= this._maxDate,
      });
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      console.error('[Events] Load newer failed:', error);
      this.setData({ loadingFwd: false, fwdError: true });
    } finally {
      this._loadingFwd = false;
      if (reqSeq === this._reqSeq && this.data.loadingFwd) {
        this.setData({ loadingFwd: false });
      }
    }
  },

  /** 数据变更后原地重拉已加载范围（保持成员范围与滚动位置） */
  async refreshLoadedRange(): Promise<void> {
    const familyId = this.data.familyId;
    if (!familyId || !this._rangeStart || !this._rangeEnd) return;
    const reqSeq = ++this._reqSeq;
    try {
      const events = await this.loadWindow(this._rangeStart, this._rangeEnd);
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      this._events = {};
      this.mergeEvents(events);
      this._dotCache = {};
      await this._applySections({});
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    }
  },

  onTapLoadOlder(): void {
    this.loadOlder();
  },

  onTapLoadNewer(): void {
    this.loadNewer();
  },

  onNearTop(): void {
    if (Date.now() < this._suppressEdgeUntil) return;
    this.loadOlder();
  },

  onNearBottom(): void {
    if (Date.now() < this._suppressEdgeUntil) return;
    this.loadNewer();
  },

  /* ---------------- 时间线构建 ---------------- */

  /** 由 _events 派生 sections 并 setData（可附带其它字段），随后重新测量分组位置 */
  _applySections(extra: Record<string, unknown>): Promise<void> {
    const { sections, total } = this.buildSections();
    // 后台数据已变更，刷新指纹基线，避免下一分钟误判「无变化」而跳过本次派生
    this._endedFingerprint = sections
      .map(s => s.items.map(i => `${i.id}:${i.isEnded ? 1 : 0}`).join(','))
      .join('|');
    return new Promise<void>(resolve => {
      this.setData(
        { sections, isEmpty: total === 0, ...extra } as never,
        () => {
          this._syncSectionTops();
          resolve();
        },
      );
    });
  },

  buildSections(): { sections: DaySection[]; total: number } {
    const rs = this._rangeStart;
    const re = this._rangeEnd;
    const now = Date.now();
    const byDate: Record<string, { e: Event; sortKey: string }[]> = {};
    // total 只统计真正落在已加载范围内、能被展示的事件，
    // 否则会出现「没有任何分组但 total > 0」——列表既无内容也不显示空状态。
    const shownIds = new Set<string>();
    Object.keys(this._events).forEach(id => {
      const e = this._events[id];
      eventDaysInRange(e, rs, re, this._viewingTimezone, instantDate).forEach(d => {
        if (!byDate[d]) byDate[d] = [];
        shownIds.add(e.id);
        // 全天排最前（sortKey '!'），普通日程按查看时区的开始时间升序
        const sortKey = e.isAllDay
          ? '!'
          : formatInstantInTimeZone(e.startAt, this._viewingTimezone).time;
        byDate[d].push({ e, sortKey });
      });
    });
    const total = shownIds.size;
    // 占位日期（今天 / 锚点 / 点选日期）：无日程也保留分组，便于定位
    this._placeholderDates.forEach(d => {
      if (d >= rs && d < re && !byDate[d]) byDate[d] = [];
    });
    const today = todayYmd();
    const thisYear = today.slice(0, 4);
    const sections: DaySection[] = Object.keys(byDate)
      .sort()
      .map(date => {
        const items = byDate[date]
          .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
          .map(({ e }) => this.toItemView(e, now));
        return {
          id: `sec-${date}`,
          date,
          dateLabel: dateLabelOf(date, thisYear),
          weekLabel: weekLabelOf(date),
          monthLabel: monthLabelOf(date),
          isToday: date === today,
          items,
        };
      });
    return { sections, total };
  },

  toItemView(e: Event, now: number): EventItemView {
    let timeText = '';
    if (!e.isAllDay) {
      // 主时间一律用查看时区，与分组所在的那一天保持一致
      const view = this._viewingTimezone;
      const start = formatInstantInTimeZone(e.startAt, view);
      const end = formatInstantInTimeZone(e.endAt, view);
      timeText = start.date === end.date
        ? `${start.time}–${end.time}`
        : `${start.date} ${start.time} → ${end.date} ${end.time}`;
      // 端点地点时区（如航班出发地 / 到达地）仅作为附加标签
      const hint = endpointZoneHint(e, view);
      if (hint) timeText = `${timeText} · ${hint}`;
    }
    const names = e.attendees.map(a => a.displayName);
    const nameText = names.length === 0
      ? ''
      : names.length <= 2
        ? names.join('、')
        : `${names.slice(0, 2).join('、')} 等${names.length}人`;
    const parts: string[] = [];
    if (nameText) parts.push(nameText);
    if (e.location) parts.push(e.location);
    // 已结束：复用纯函数模块（与首页同一套判据）
    const isEnded = isEventEnded(e, now);
    return {
      id: e.id,
      summary: e.summary,
      isAllDay: e.isAllDay,
      timeText,
      metaText: parts.join(' · '),
      isEnded,
    };
  },

  /* ---------------- 滚动联动 ---------------- */

  onScroll(e: WechatMiniprogram.ScrollViewScroll): void {
    const top = e.detail.scrollTop;
    this._scrollTop = top;
    const now = Date.now();
    if (now - this._lastMonthSyncAt < 150) return;
    this._lastMonthSyncAt = now;
    this._syncMonthByScroll(top);
  },

  _syncMonthByScroll(scrollTop: number): void {
    const tops = this._sectionTops;
    if (!tops.length) return;
    let current = tops[0];
    for (let i = 0; i < tops.length; i++) {
      if (tops[i].top <= scrollTop + 8) current = tops[i];
      else break;
    }
    this.setVisibleDate(current.date);
    if (current.monthLabel !== this.data.monthLabel) {
      this.setData({ monthLabel: current.monthLabel });
    }
  },

  /** 测量各日分组在滚动内容中的位置（用于月份联动） */
  _syncSectionTops(): void {
    wx.nextTick(() => {
      const q = wx.createSelectorQuery().in(this);
      q.select('#scroller').boundingClientRect();
      q.select('#scroller').scrollOffset();
      q.selectAll('.day-section').boundingClientRect();
      q.exec(res => {
        const scroller = res[0] as { top: number } | null;
        const offset = res[1] as { scrollTop: number } | null;
        const rects = (res[2] || []) as { top: number; dataset?: { date?: string } }[];
        if (!scroller || !offset) return;
        this._sectionTops = rects
          .map(r => {
            const date = (r.dataset && r.dataset.date) || '';
            return {
              date,
              top: r.top - scroller.top + offset.scrollTop,
              monthLabel: date ? monthLabelOf(date) : '',
            };
          })
          .filter(t => !!t.date);
      });
    });
  },

  _measureContentHeight(): Promise<number> {
    return new Promise(resolve => {
      wx.createSelectorQuery()
        .in(this)
        .select('#timeline-inner')
        .boundingClientRect(rect => {
          resolve(rect ? (rect as { height: number }).height : 0);
        })
        .exec();
    });
  },

  /** 滚动定位到某日期（该日期需在已加载范围内） */
  scrollToDate(date: string): void {
    if (date < this._rangeStart || date >= this._rangeEnd) return;
    const apply = (): void => {
      this.setVisibleDate(date);
      this._suppressEdgeUntil = Date.now() + 700;
      this.setData({ scrollIntoView: `sec-${date}`, monthLabel: monthLabelOf(date) });
      setTimeout(() => {
        this.setData({ scrollIntoView: '' });
      }, 400);
    };
    if (!this._placeholderDates.includes(date) && !this.data.sections.some(s => s.date === date)) {
      // 该日期无分组：插入占位分组后再定位
      this._placeholderDates = [...this._placeholderDates, date];
      this._applySections({}).then(apply);
    } else {
      apply();
    }
  },

  /** 回到今天：范围内直接定位，范围外重新锚定加载 */
  onToday(): void {
    const today = todayYmd();
    this.setData({ calendarExpanded: false });
    if (this.data.loaded && today >= this._rangeStart && today < this._rangeEnd) {
      this.scrollToDate(today);
    } else {
      this.initialLoad(today);
    }
  },

  /* ---------------- 折叠月历 ---------------- */

  onToggleCalendar(): void {
    if (this.data.calendarExpanded) {
      this.setData({ calendarExpanded: false });
      return;
    }
    this.expandCalendar();
  },

  /** 更新当前可见日期，并刷新折叠态周条 */
  setVisibleDate(date: string): void {
    this._visibleDate = date;
    this.setData({
      visibleDate: date,
      weekStrip: this.computeWeekStrip(date),
    });
  },

  /** 以 center 所在周（周一..周日）生成紧凑周条单元格 */
  computeWeekStrip(center: string): { date: string; day: number; isToday: boolean }[] {
    const d = parseDateOnly(center);
    const mondayOffset = (d.getDay() + 6) % 7;
    const monday = addDaysToDateOnly(center, -mondayOffset);
    const today = todayYmd();
    const strip: { date: string; day: number; isToday: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDaysToDateOnly(monday, i);
      strip.push({ date, day: parseDateOnly(date).getDate(), isToday: date === today });
    }
    return strip;
  },

  /** 折叠态周条点选：定位列表但保持折叠 */
  onWeekDayTap(e: WechatMiniprogram.TouchEvent): void {
    const date = e.currentTarget.dataset.date as string;
    if (!date) return;
    if (date < this._minDate || date >= this._maxDate) {
      showError('超出可查看范围');
      return;
    }
    if (date >= this._rangeStart && date < this._rangeEnd) {
      this.scrollToDate(date);
    } else {
      this.initialLoad(date);
    }
  },

  expandCalendar(): void {
    const base = this._visibleDate || todayYmd();
    const d = parseDateOnly(base);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    this.setData({
      calendarExpanded: true,
      calYear: year,
      calMonth: month,
      calendar: buildCalendarMatrix(year, month, todayYmd(), new Set()),
    });
    this.ensureMonthDots(year, month);
  },

  onCalPrevMonth(): void {
    let { calYear: y, calMonth: m } = this.data;
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
    this.setData({
      calYear: y,
      calMonth: m,
      calendar: buildCalendarMatrix(y, m, todayYmd(), new Set()),
    });
    this.ensureMonthDots(y, m);
  },

  onCalNextMonth(): void {
    let { calYear: y, calMonth: m } = this.data;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    this.setData({
      calYear: y,
      calMonth: m,
      calendar: buildCalendarMatrix(y, m, todayYmd(), new Set()),
    });
    this.ensureMonthDots(y, m);
  },

  /** 保证展开月历有「哪天有日程」圆点：范围内直接推导，范围外单独拉取该月并缓存 */
  async ensureMonthDots(year: number, month: number): Promise<void> {
    const monthKey = `${year}-${pad(month)}`;
    const monthStart = `${monthKey}-01`;
    const monthEnd = addMonths(monthStart, 1);
    const familyId = this.data.familyId;
    let dates: string[] | null = null;

    if (monthStart >= this._rangeStart && monthEnd <= this._rangeEnd) {
      const set = new Set<string>();
      Object.keys(this._events).forEach(id => {
        eventDaysInRange(
          this._events[id],
          monthStart,
          monthEnd,
          this._viewingTimezone,
          instantDate,
        ).forEach(d => set.add(d));
      });
      dates = Array.from(set);
    } else {
      const cacheKey = `${this.data.scope}|${monthKey}`;
      if (this._dotCache[cacheKey]) {
        dates = this._dotCache[cacheKey];
      } else {
        try {
          const events = await this.loadWindow(
            maxYmd(monthStart, this._minDate),
            minYmd(monthEnd, this._maxDate),
          );
          if (familyId !== this.data.familyId) return;
          const set = new Set<string>();
          events.forEach(e => {
            eventDaysInRange(
              e,
              monthStart,
              monthEnd,
              this._viewingTimezone,
              instantDate,
            ).forEach(d => set.add(d));
          });
          dates = Array.from(set);
          this._dotCache[cacheKey] = dates;
        } catch (error) {
          console.error('[Events] Load month dots failed:', error);
          return;
        }
      }
    }

    // 用户可能已翻到其它月份 / 收起月历：只在仍展示该月时应用
    if (!this.data.calendarExpanded) return;
    if (this.data.calYear !== year || this.data.calMonth !== month) return;
    const dotSet = new Set(dates);
    const calendar = this.data.calendar.map(row =>
      row.map(c => ({ ...c, hasEvent: dotSet.has(c.date) })),
    );
    this.setData({ calendar });
  },

  onCalDayTap(e: WechatMiniprogram.TouchEvent): void {
    const date = e.currentTarget.dataset.date as string;
    if (!date) return;
    if (date < this._minDate || date >= this._maxDate) {
      showError('超出可查看范围');
      return;
    }
    // 选中日期后自动折叠月历
    this.setData({ calendarExpanded: false });
    if (date >= this._rangeStart && date < this._rangeEnd) {
      this.scrollToDate(date);
    } else {
      // 范围外：以该日期为锚点重新加载
      this.initialLoad(date);
    }
  },

  /** 手势增强：折叠条下滑展开，月历面板上滑收起 */
  onCalTouchStart(e: WechatMiniprogram.TouchEvent): void {
    this._calTouchY = e.touches && e.touches[0] ? e.touches[0].clientY : 0;
  },

  onCalTouchEnd(e: WechatMiniprogram.TouchEvent): void {
    const endY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : 0;
    if (!this._calTouchY || !endY) return;
    const delta = endY - this._calTouchY;
    this._calTouchY = 0;
    if (delta > 50 && !this.data.calendarExpanded) {
      this.expandCalendar();
    } else if (delta < -50 && this.data.calendarExpanded) {
      this.setData({ calendarExpanded: false });
    }
  },

  /* ---------------- 其它交互 ---------------- */

  onCreateFamily(): void {
    wx.navigateTo({ url: '/pages/family/create' });
  },

  onJoinFamily(): void {
    wx.navigateTo({ url: '/pages/family/join' });
  },

  onEventTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({ url: `/pages/events/detail?id=${id}&familyId=${this.data.familyId}` });
  },

  onCreate(): void {
    const date = this._visibleDate || todayYmd();
    wx.navigateTo({
      url: `/pages/events/edit?familyId=${this.data.familyId}&date=${date}`,
    });
  },

  /** 阻止遮罩 / 面板滚动穿透 */
  noop(): void {
    // intentionally empty
  },
});

/* ----------------- 工具函数 ----------------- */

/** 查看时区下的「今天」；查看时区尚未解析时退回设备本地日期 */
function todayYmd(): string {
  if (viewingTimezoneForToday) {
    return instantDate(new Date().toISOString(), viewingTimezoneForToday);
  }
  return formatDateOnly(new Date());
}

/**
 * 端点地点时区标签，例如「上海 09:00 → 巴黎 18:00」。
 *
 * 仅当事件带有端点时区元数据且与查看时区不同才展示；
 * 它是纯展示信息，不参与任何日期归组。
 */
function endpointZoneHint(
  e: Extract<Event, { isAllDay: false }>,
  viewingTimezone: string,
): string {
  const startZone = e.startTimezone;
  const endZone = e.endTimezone;
  const startDiffers = !!startZone && startZone !== viewingTimezone;
  const endDiffers = !!endZone && endZone !== viewingTimezone;
  if (!startDiffers && !endDiffers) return '';
  const zoneOf = (zone: string | null): string => zone || viewingTimezone;
  const startText = `${timeZoneLabel(zoneOf(startZone))} ${formatInstantInTimeZone(e.startAt, zoneOf(startZone)).time}`;
  const endText = `${timeZoneLabel(zoneOf(endZone))} ${formatInstantInTimeZone(e.endAt, zoneOf(endZone)).time}`;
  return `${startText} → ${endText}`;
}
