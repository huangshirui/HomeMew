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
 * 时区：Core 返回规范 UTC 时间点；端点时区元数据优先用于显示，
 * 元数据为 null 时回退设备时区。全天事件只做纯日期运算。
 */

import { fetchEventsPage } from '../../services/events';
import { listFamilyMembers } from '../../services/families';
import { currentFamilyStore, userStore } from '../../stores/index';
import { consumeDirty, subscribe } from '../../stores/dirty';
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
  getSystemTimeZone,
  timeZoneLabel,
} from '../../utils/index';
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

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

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

type EventItemView = {
  id: string;
  summary: string;
  isAllDay: boolean;
  /** 普通日程 "16:00–18:00"；全天为空（用标签展示） */
  timeText: string;
  /** "KK、天宝 · 奥体中心" */
  metaText: string;
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
    scopeLabel: '我的日历',
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
  _deviceTimeZone: 'Asia/Shanghai',

  onLoad(options: { date?: string; familyId?: string; attendee?: string }): void {
    const familyId = currentFamilyStore.value?.id || options.familyId || '';
    if (!familyId) {
      this.setData({ loaded: true, noFamily: true });
      return;
    }
    const anchor = options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
      ? options.date
      : todayYmd();
    const uid = userStore.value?.id || '';
    this._deviceTimeZone = getSystemTimeZone(currentFamilyStore.value?.timezone);
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
  },

  onHide(): void {
    this._unsubscribeDirty();
  },

  onUnload(): void {
    this._unsubscribeDirty();
  },

  /** 家庭变化后完全重置（范围偏好按新家庭恢复） */
  resetForFamily(familyId: string): void {
    const uid = userStore.value?.id || '';
    const scope = loadEventsScope(familyId, uid);
    this._members = [];
    this._dotCache = {};
    this._deviceTimeZone = getSystemTimeZone(currentFamilyStore.value?.timezone);
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
    this.initialLoad(todayYmd());
  },

  buildScopeOptions(): void {
    const uid = userStore.value?.id || '';
    const user = userStore.value;
    const options: ScopeOption[] = [
      { key: 'all', label: '全家日历', avatarUrl: '', showAvatar: false },
      {
        key: 'me',
        label: '我的日历',
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
    if (scope === 'all') return '全家日历';
    if (scope === 'me') return '我的日历';
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
    this.initialLoad(todayYmd());
  },

  /* ---------------- 数据加载 ---------------- */

  /** 拉满一个时间窗口内的所有分页（窗口内游标） */
  async loadWindow(start: string, end: string): Promise<Event[]> {
    const familyId = this.data.familyId;
    const attendeeId = this.attendeeParam();
    const items: Event[] = [];
    const queryStart = addDaysToDateOnly(start, -2);
    const queryEnd = addDaysToDateOnly(end, 2);
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES_PER_WINDOW; page++) {
      const data = await fetchEventsPage(familyId, {
        startDate: queryStart,
        endDateExclusive: queryEnd,
        timezone: this._deviceTimeZone,
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
    this.initialLoad(this._visibleDate || todayYmd());
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
    const byDate: Record<string, { e: Event; sortKey: string }[]> = {};
    let total = 0;
    Object.keys(this._events).forEach(id => {
      const e = this._events[id];
      total += 1;
      eventDaysInRange(e, rs, re, this._deviceTimeZone).forEach(d => {
        if (!byDate[d]) byDate[d] = [];
        // 全天排最前（sortKey '!'），普通日程按开始时间升序
        const sortKey = e.isAllDay
          ? '!'
          : formatInstantInTimeZone(
              e.startAt,
              e.startTimezone || this._deviceTimeZone,
            ).time;
        byDate[d].push({ e, sortKey });
      });
    });
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
          .map(({ e }) => this.toItemView(e));
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

  toItemView(e: Event): EventItemView {
    let timeText = '';
    if (!e.isAllDay) {
      const startZone = e.startTimezone || this._deviceTimeZone;
      const endZone = e.endTimezone || this._deviceTimeZone;
      const start = formatInstantInTimeZone(e.startAt, startZone);
      const end = formatInstantInTimeZone(e.endAt, endZone);
      if (startZone === endZone) {
        timeText = start.date === end.date
          ? `${start.time}–${end.time}`
          : `${start.date} ${start.time} → ${end.date} ${end.time}`;
      } else {
        const startText = `${timeZoneLabel(startZone)} ${start.date === end.date ? '' : `${start.date} `}${start.time}`;
        const endText = `${timeZoneLabel(endZone)} ${start.date === end.date ? '' : `${end.date} `}${end.time}`;
        timeText = `${startText} → ${endText}`;
      }
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
    return {
      id: e.id,
      summary: e.summary,
      isAllDay: e.isAllDay,
      timeText,
      metaText: parts.join(' · '),
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
          this._deviceTimeZone,
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
              this._deviceTimeZone,
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

function todayYmd(): string {
  return formatDateOnly(new Date());
}
