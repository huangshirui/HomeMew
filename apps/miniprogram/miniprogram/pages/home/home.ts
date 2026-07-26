/**
 * 首页 —— 今天的家庭工作台
 *
 * 打开后马上知道：
 * - 今天有什么安排（今日日程）
 * - 还有什么没做（待办提醒）
 *
 * 设计目标（见需求）：
 * - 不再展示独立的家庭资料卡 / 快速操作卡；
 * - 当前家庭以欢迎卡右上角的小入口呈现，点击切换；
 * - 悬浮「＋」提供快速新建日程 / 待办；
 * - 条件式紧急提醒只在确需关注时出现；
 * - 空状态提供直接创建入口。
 *
 * 家庭管理（成员 / 邀请 / 创建加入 / 资料编辑 / 外部系统）统一收归「我的」。
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
  parseDateOnly,
} from '../../utils/index';
import { consumeAnyDirty, markDirty, subscribe } from '../../stores/dirty';
import { listEvents } from '../../services/events';
import { listTasks, completeTask } from '../../services/tasks';
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
};

type TaskHomeView = {
  id: string;
  name: string;
  status: 'pending' | 'completed';
  due: string | null;
  dueText: string;
  isOverdue: boolean;
  assigneeText: string;
  version: number;
  completing: boolean;
};

type UrgentReminder = {
  type: 'event' | 'overdue';
  text: string;
  action: 'event' | 'tasks';
  id: string;
};

/** 首页每个模块最多展示的条目数，超出由「查看全部」进入对应 Tab */
const HOME_LIMIT = 3;

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

    urgentReminder: null as UrgentReminder | null,

    eventsLoading: false,
    eventsRefreshing: false,
    eventsError: false,
    tasksLoading: false,
    tasksRefreshing: false,
    tasksError: false,

    fabOpen: false,
  },

  // 原始列表（不参与渲染，仅用于派生视图与排序）
  _todayEvents: [] as Event[],
  _pendingTasks: [] as Task[],
  _completingIds: new Set<string>(),

  _userUnsubscribe: null as (() => void) | null,
  _familyUnsubscribe: null as (() => void) | null,
  _familiesUnsubscribe: null as (() => void) | null,
  _dirtyUnsubscribe: null as (() => void) | null,

  /** 页面显示：刷新问候 + 订阅状态 */
  onShow(): void {
    this.refreshGreeting();

    const storeFamilyId = currentFamilyStore.value?.id || '';
    const shownFamilyId = this.data.currentFamily?.id || '';
    // 首次加载、家庭在其他页被切换过、或数据被标记变更（新建/完成/删除后返回）时重新拉取；
    // 普通切换 tab 不重复请求。
    if (!this.data.loaded || (storeFamilyId && storeFamilyId !== shownFamilyId) || consumeAnyDirty()) {
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
  },

  onHide(): void {
    if (this._userUnsubscribe) this._userUnsubscribe();
    if (this._familyUnsubscribe) this._familyUnsubscribe();
    if (this._familiesUnsubscribe) this._familiesUnsubscribe();
  },

  _subscribeDirty(): void {
    this._unsubscribeDirty();
    this._dirtyUnsubscribe = subscribe((domain) => {
      const cf = this.data.currentFamily;
      if (!cf || !this.data.loaded) return;
      if (domain === 'tasks') this.loadTasks(cf.id);
      else if (domain === 'events') this.loadTodayEvents(cf.id);
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

  /** 加载今日日程（今天 00:00 ～ 明天 00:00） */
  async loadTodayEvents(familyId: string): Promise<void> {
    // 已有数据时进入非破坏性「后台刷新」态，保留旧列表继续展示，避免整块闪现「加载中」
    const hasOld = this.data.todayEvents.length > 0;
    this.setData({
      eventsLoading: !hasOld,
      eventsRefreshing: hasOld,
      eventsError: false,
    });
    try {
      const today = new Date();
      const start = formatYmd(today);
      const end = formatYmd(addDays(today, 1));
      const events = await listEvents(familyId, { start, end, status: 'active' });
      if (this.data.currentFamily?.id !== familyId) return;

      this._todayEvents = events;
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

  /** 由原始数据派生所有展示字段：列表、计数、副标题、紧急提醒 */
  recompute(): void {
    const today = formatYmd(new Date());
    const tomorrow = formatYmd(addDays(new Date(), 1));

    const todayEvents = this._todayEvents.map(mapTodayEvent);
    const pendingTasks = [...this._pendingTasks]
      .sort((a, b) => taskDueRank(a, today, tomorrow) - taskDueRank(b, today, tomorrow))
      .map((t) => {
        const v = mapTaskHome(t, today);
        v.completing = this._completingIds.has(t.id);
        return v;
      });

    const todayEventCount = this._todayEvents.length;
    const pendingTaskCount = this._pendingTasks.length;
    const overdueCount = pendingTasks.filter((t) => t.isOverdue).length;
    const urgent = findUrgentEvent(this._todayEvents);

    this.setData({
      todayEvents: todayEvents.slice(0, HOME_LIMIT),
      todayEventCount,
      pendingTasks: pendingTasks.slice(0, HOME_LIMIT),
      pendingTaskCount,
      greetingSubtitle: buildSubtitle(todayEventCount, pendingTaskCount, overdueCount, urgent),
      urgentReminder: buildUrgent(urgent, overdueCount),
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

  /** 点击紧急提醒：进入对应内容 */
  onUrgentTap(e: WechatMiniprogram.TouchEvent): void {
    const { action, id } = e.currentTarget.dataset as { action: string; id: string };
    if (action === 'event' && id && this.data.currentFamily) {
      wx.navigateTo({
        url: `/pages/events/detail?id=${id}&familyId=${this.data.currentFamily.id}`,
      });
    } else if (action === 'tasks') {
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

  /** 悬浮新增按钮 */
  onFabTap(): void {
    this.setData({ fabOpen: true });
  },

  onFabClose(): void {
    this.setData({ fabOpen: false });
  },

  /** 阻止点击菜单内部冒泡到遮罩 */
  noop(): void {},

  /** 新建日程 */
  onCreateEvent(): void {
    this.setData({ fabOpen: false });
    if (!this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/events/edit?familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 新建待办 */
  onCreateTask(): void {
    this.setData({ fabOpen: false });
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

function formatYmd(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

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

function mapTodayEvent(e: Event): TodayEventView {
  // 全天日程 start 为纯日期，按天解析（不走 UTC），否则负时区会偏移一天
  const start = e.isAllDay ? parseDateOnly(e.start) : new Date(e.start);
  let timeText = '全天';
  if (!e.isAllDay) {
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    timeText = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  }
  return { id: e.id, summary: e.summary, timeText, isAllDay: e.isAllDay };
}

/** 待办截止优先级：已逾期(0) > 今天(1) > 明天(2) > 其他有截止(3) > 无截止(4) */
function taskDueRank(t: Task, today: string, tomorrow: string): number {
  if (t.status !== 'pending') return 99;
  if (!t.due) return 4;
  if (t.due < today) return 0;
  if (t.due === today) return 1;
  if (t.due === tomorrow) return 2;
  return 3;
}

function taskDueLabel(t: Task, today: string, tomorrow: string): string {
  if (!t.due) return (t.assignees || []).map((a) => a.displayName).join('、');
  if (t.due < today) return '已逾期';
  if (t.due === today) return '今天';
  if (t.due === tomorrow) return '明天';
  return formatDate(t.due, 'date');
}

function mapTaskHome(t: Task, today: string): TaskHomeView {
  const isOverdue = t.status === 'pending' && !!t.due && t.due < today;
  const assigneeText = (t.assignees || []).map((a) => a.displayName).join('、');
  return {
    id: t.id,
    name: t.name,
    status: t.status as 'pending' | 'completed',
    due: t.due,
    dueText: taskDueLabel(t, today, formatYmd(addDays(new Date(), 1))),
    isOverdue,
    assigneeText,
    version: t.version,
    completing: false,
  };
}

/** 找出 30 分钟内即将开始的日程（仅限非全天） */
function findUrgentEvent(events: Event[]): { id: string; summary: string; minutes: number } | null {
  const now = Date.now();
  let best: { id: string; summary: string; minutes: number } | null = null;
  for (const e of events) {
    if (e.isAllDay) continue;
    const start = new Date(e.start).getTime();
    const diff = start - now;
    if (diff >= 0 && diff <= 30 * 60000) {
      const minutes = Math.max(1, Math.round(diff / 60000));
      if (!best || minutes < best.minutes) {
        best = { id: e.id, summary: e.summary, minutes };
      }
    }
  }
  return best;
}

function buildSubtitle(
  todayEventCount: number,
  pendingTaskCount: number,
  overdueCount: number,
  urgent: { summary: string; minutes: number } | null,
): string {
  if (urgent) return `${urgent.summary}还有 ${urgent.minutes} 分钟开始`;
  if (overdueCount > 0) return `有 ${overdueCount} 件待办已经逾期`;
  if (todayEventCount > 0) return `今天有 ${todayEventCount} 个安排，记得按时参加`;
  if (pendingTaskCount === 0) return '今天的待办已经全部完成啦';
  return '今天也要元气满满哦';
}

function buildUrgent(
  urgent: { id: string; summary: string; minutes: number } | null,
  overdueCount: number,
): UrgentReminder | null {
  if (urgent) {
    return {
      type: 'event',
      text: `⏰ ${urgent.summary}将在 ${urgent.minutes} 分钟后开始`,
      action: 'event',
      id: urgent.id,
    };
  }
  if (overdueCount > 0) {
    return {
      type: 'overdue',
      text: `⚠ ${overdueCount} 件待办已经逾期`,
      action: 'tasks',
      id: '',
    };
  }
  return null;
}
