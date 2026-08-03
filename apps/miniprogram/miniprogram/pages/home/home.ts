/**
 * 首页 —— 今天的家庭工作台
 *
 * 首页顺序（见需求「四、首页最终结构」）：
 *   欢迎卡 → 需要关注 → 今天安排 → 待办提醒 → 常用工具
 *
 * 设计目标：
 * - 删除两个统计数字卡片；
 * - 删除原单条 urgent banner，紧急日程并入「需要关注」横向卡片；
 * - 欢迎卡右上角始终显示当前家庭（单家庭只显示头像、多家庭显示下拉箭头）；
 * - 「需要关注」横向滚动聚合：日子关注项 + 逾期待办汇总卡 + 紧急日程卡；
 * - 没有关注项时整个「需要关注」区域隐藏；
 * - 家庭管理统一收归「我的」，首页只展示常用工具入口。
 */

import {
  currentFamilyStore,
  familiesStore,
  userStore,
  loadFamilies,
  loadCurrentUser,
  setCurrentFamily,
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
import { loadEventsScope } from '../../stores/events-scope';
import { listEvents } from '../../services/events';
import { listTasks, completeTask } from '../../services/tasks';
import { listAttentionDayRecords } from '../../services/day-records';
import { mapDayRecordView, DayRecordView } from '../../utils/day-record-view';
import { DayRecordKind } from '../../types/index';
import { Event, Task, FamilyRole } from '../../types/index';

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
    greetingText: '',
    dateText: '',
    greetingSubtitle: '',

    currentFamily: null as FamilyView | null,
    families: [] as FamilyView[],
    canSwitch: false,
    loaded: false,

    todayEvents: [] as TodayEventView[],
    todayEventCount: 0,

    pendingTasks: [] as TaskHomeView[],
    pendingTaskCount: 0,

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
  },

  // 原始列表（不参与渲染，仅用于派生视图与排序）
  _todayEvents: [] as Event[],
  _pendingTasks: [] as Task[],
  _completingIds: new Set<string>(),

  _userUnsubscribe: null as (() => void) | null,
  _familyUnsubscribe: null as (() => void) | null,
  _familiesUnsubscribe: null as (() => void) | null,
  _dirtyUnsubscribe: null as (() => void) | null,
  /** 每分钟本地重算定时器（只重算展示态，不重新拉后台） */
  _tickTimer: null as ReturnType<typeof setInterval> | null,
  /** 上次重算得到的「已结束 / 进行中」指纹，用于跳过无变化的 setData */
  _statusFingerprint: '' as string,

  /** 页面显示：刷新问候 + 订阅状态 + 启动每分钟本地重算 */
  onShow(): void {
    this.getTabBar()?.setData({ selected: 0 });
    this.refreshGreeting();

    const storeFamilyId = currentFamilyStore.value?.id || '';
    const shownFamilyId = this.data.currentFamily?.id || '';
    // 首页只消费自己关心的域（events / tasks / days），不消费 wishes，
    // 避免愿望的变更导致首页全量重新请求。
    const dirty = consumeDirtyDomains(['events', 'tasks', 'days']);
    // 首次加载、家庭在其他页被切换过、或关心的域被标记变更（新建/完成/删除后返回）时重新拉取；
    // 普通切换 tab 不重复请求。
    if (!this.data.loaded || (storeFamilyId && storeFamilyId !== shownFamilyId) || dirty.size > 0) {
      this.loadData();
    }

    this._userUnsubscribe = userStore.subscribe(() => this.refreshGreeting());
    this._familyUnsubscribe = currentFamilyStore.subscribe((family) => {
      const prevId = this.data.currentFamily?.id;
      this.setData({ currentFamily: family as FamilyView | null });
      const newId = (family as FamilyView | null)?.id;
      if (newId && newId !== prevId) {
        this.loadTodayEvents(newId);
        this.loadTasks(newId);
      }
    });
    this._familiesUnsubscribe = familiesStore.subscribe((families) => {
      const cf = currentFamilyStore.value;
      this.setData({
        families: families as FamilyView[],
        canSwitch: (families as FamilyView[]).length > 1,
        loaded: true,
        currentFamily: cf as FamilyView | null,
      });
    });

    this._subscribeDirty();
    this._startTick();
  },

  onHide(): void {
    if (this._userUnsubscribe) this._userUnsubscribe();
    if (this._familyUnsubscribe) this._familyUnsubscribe();
    if (this._familiesUnsubscribe) this._familiesUnsubscribe();
    this._stopTick();
  },

  onUnload(): void {
    this._stopTick();
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

  /** 下拉刷新：家庭信息 + 今日日程 + 待办 */
  async onPullDownRefresh(): Promise<void> {
    await Promise.all([
      this.loadData(),
      this.data.currentFamily ? this.loadTodayEvents(this.data.currentFamily.id) : Promise.resolve(),
      this.data.currentFamily ? this.loadTasks(this.data.currentFamily.id) : Promise.resolve(),
    ]);
    wx.stopPullDownRefresh();
  },

  async loadData(): Promise<void> {
    try {
      await Promise.all([loadFamilies(), this.ensureUser()]);
      const families = familiesStore.value;
      const current = restoreCurrentFamily(families) || currentFamilyStore.value;
      this.setData({
        families: families as FamilyView[],
        currentFamily: current as FamilyView | null,
        canSwitch: families.length > 1,
        loaded: true,
      });

      const app = getApp<IAppOption>();
      if (app) {
        app.globalData.families = families;
        app.globalData.currentFamily = current;
      }

      this.refreshGreeting();

      if (current) {
        this.loadTodayEvents(current.id);
        this.loadTasks(current.id);
        this.loadAttentionDays(current.id);
      }
    } catch (e) {
      console.error('[Home] Load data failed:', e);
      this.setData({ loaded: true });
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

  /** 根据时间 + 用户昵称刷新问候语与日期 */
  refreshGreeting(): void {
    const user = userStore.value;
    const nickname = user?.displayName ? truncateName(user.displayName, 8) : '';
    const greeting = greetingByHour(new Date().getHours());
    const greetingText = nickname ? `${greeting}，${nickname} 👋` : `${greeting} 👋`;
    this.setData({
      greetingText,
      dateText: formatTodayDate(),
    });
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
      // 跟随日程页的「成员日历范围」偏好：all 不传、me 传 'me'、其他传成员 userId
      const scope = loadEventsScope(familyId, userStore.value?.id || '');
      const attendeeId = scope === 'all' || scope === 'me' ? (scope === 'me' ? 'me' : undefined) : scope;
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

  /** 加载待办任务（进行中的任务） */
  async loadTasks(familyId: string): Promise<void> {
    const hasOld = this.data.pendingTasks.length > 0;
    this.setData({
      tasksLoading: !hasOld,
      tasksRefreshing: hasOld,
      tasksError: false,
    });
    try {
      const tasks = await listTasks(familyId, { status: 'pending' });
      if (this.data.currentFamily?.id !== familyId) return;

      this._pendingTasks = tasks;
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
      const records = await listAttentionDayRecords(familyId);
      if (this.data.currentFamily?.id !== familyId) return;
      this.setData({
        attentionDays: records.map(mapDayRecordView),
        daysLoading: false,
      });
    } catch (e) {
      console.error('[Home] Load attention days failed:', e);
      if (this.data.currentFamily?.id !== familyId) return;
      this.setData({ daysLoading: false, daysError: true });
    }
  },

  onRetryDays(): void {
    if (this.data.currentFamily) this.loadAttentionDays(this.data.currentFamily.id);
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
    const pendingTasks = [...this._pendingTasks]
      .sort((a, b) => taskDueRank(a, today, tomorrow) - taskDueRank(b, today, tomorrow))
      .map((t) => {
        const v = mapTaskHome(t, today, tomorrow);
        v.completing = this._completingIds.has(t.id);
        return v;
      });

    const todayEventCount = todayEvents.length;
    const pendingTaskCount = this._pendingTasks.length;
    const overdueCount = pendingTasks.filter((t) => t.isOverdue).length;
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
      '#' +
      attentionCards.map((c) => `${c.kind}:${c.id}:${c.level}`).join('|');
    // 每分钟重算时：若「进行中 / 已结束 / 逾期 / 提交中 / 关注卡」展示态都没有变化，跳过 setData，
    // 避免列表无谓闪动；计数与副标题也随指纹一并稳定。
    if (fingerprint === this._statusFingerprint) return;
    this._statusFingerprint = fingerprint;

    this.setData({
      todayEvents: todayEvents,
      todayEventCount,
      pendingTasks: pendingTasks.slice(0, HOME_LIMIT),
      pendingTaskCount,
      attentionCards,
      greetingSubtitle: buildSubtitle(todayEventCount, pendingTaskCount, attentionCards.length),
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

  /** 切换当前家庭（仅在多个家庭时可用） */
  onSwitchFamily(): void {
    const { families, currentFamily } = this.data;
    if (!families || families.length <= 1) return;

    wx.showActionSheet({
      itemList: families.map((f) => f.name),
      success: (res) => {
        const selected = families[res.tapIndex];
        if (selected.id !== currentFamily?.id) {
          setCurrentFamily(selected);
          showSuccess(`已切换到 ${selected.name}`);
        }
      },
    });
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

function truncateName(name: string, max = 8): string {
  return name.length > max ? `${name.slice(0, max)}…` : name;
}

function greetingByHour(h: number): string {
  if (h >= 5 && h < 11) return '早上好';
  if (h >= 11 && h < 14) return '中午好';
  if (h >= 14 && h < 18) return '下午好';
  return '晚上好';
}

function formatTodayDate(): string {
  const d = new Date();
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${week}`;
}

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

/** 待办截止优先级：已逾期(0) > 今天(1) > 明天(2) > 其他有截止(3) > 无截止(4) */
function taskDueRank(t: Task, today: string, tomorrow: string): number {
  if (t.status !== 'pending') return 99;
  if (!t.dueDate) return 4;
  if (t.dueDate < today) return 0;
  if (t.dueDate === today) return 1;
  if (t.dueDate === tomorrow) return 2;
  return 3;
}

function taskDueLabel(t: Task, today: string, tomorrow: string): string {
  if (!t.dueDate) return (t.assignees || []).map((a) => a.displayName).join('、');
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

function buildSubtitle(
  todayEventCount: number,
  pendingTaskCount: number,
  attentionCount: number,
): string {
  // 有关注事项：今天有 X 个安排，Y 件事情需要关注
  if (attentionCount > 0) {
    return `今天有 ${todayEventCount} 个安排，${attentionCount} 件事情需要关注`;
  }
  // 无关注事项但有待办：今天有 X 个安排，还有 Y 件待办
  if (pendingTaskCount > 0) {
    return `今天有 ${todayEventCount} 个安排，还有 ${pendingTaskCount} 件待办`;
  }
  // 只有日程：今天有 X 个安排，记得按时参加
  if (todayEventCount > 0) {
    return `今天有 ${todayEventCount} 个安排，记得按时参加`;
  }
  // 全部为空：今天也要元气满满哦
  return '今天也要元气满满哦';
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
