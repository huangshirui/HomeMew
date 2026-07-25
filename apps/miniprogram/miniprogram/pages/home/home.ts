/**
 * 首页
 *
 * 有家庭时：展示当前家庭的工作台
 * - 当前家庭头部（图片 / 名称 / 人数 / 切换）
 * - 今日日程（进行中任务列表，查看全部进入日程 Tab）
 * - 待办任务（进行中任务列表，可快速勾选完成 / 恢复，查看全部进入待办 Tab）
 *
 * 无家庭时：保留创建 / 加入家庭引导。
 *
 * 家庭管理（创建、加入、详情、成员、邀请）统一收归「我的」，
 * 首页只负责当前家庭的日常协作入口。
 */

import { currentFamilyStore, familiesStore, loadFamilies, setCurrentFamily, restoreCurrentFamily } from '../../stores/index';
import { showSuccess, showError, getErrorMessage, formatDate } from '../../utils/index';
import { listEvents } from '../../services/events';
import { listTasks, completeTask, reopenTask } from '../../services/tasks';
import { Event, Task } from '../../types/index';

type FamilyView = {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  memberCount: number;
};

type UpcomingEventView = {
  id: string;
  summary: string;
  dateText: string;
  timeText: string;
  attendeeText: string;
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

/** 首页每个模块最多展示的条目数，超出由「查看全部」进入对应 Tab */
const HOME_LIMIT = 3;

Page({
  data: {
    currentFamily: null as FamilyView | null,
    families: [] as FamilyView[],
    canSwitch: false,
    isAdmin: false,
    loaded: false,
    upcomingEvents: [] as UpcomingEventView[],
    upcomingTotal: 0,
    eventsLoading: false,
    eventsError: false,
    tasks: [] as TaskHomeView[],
    pendingTaskCount: 0,
    tasksLoading: false,
    tasksError: false,
  },

  /** 监听页面显示 */
  onShow(): void {
    this.loadData();
    // 订阅当前家庭变化
    this._familyUnsubscribe = currentFamilyStore.subscribe((family) => {
      const prevId = this.data.currentFamily?.id;
      this.setData({
        currentFamily: family as FamilyView | null,
        isAdmin: (family as FamilyView | null)?.role === 'admin',
      });
      const newId = (family as FamilyView | null)?.id;
      if (newId && newId !== prevId) {
        this.loadUpcomingEvents(newId);
        this.loadTasks(newId);
      }
    });
    this._familiesUnsubscribe = familiesStore.subscribe((families) => {
      const cf = currentFamilyStore.value;
      this.setData({
        families: families as FamilyView[],
        canSwitch: (families as FamilyView[]).length > 1,
        loaded: true,
        currentFamily: (cf as FamilyView | null),
        isAdmin: (cf as FamilyView | null)?.role === 'admin',
      });
    });
  },

  /** 取消订阅 */
  onHide(): void {
    if (this._familyUnsubscribe) this._familyUnsubscribe();
    if (this._familiesUnsubscribe) this._familiesUnsubscribe();
  },

  _familyUnsubscribe: null as (() => void) | null,
  _familiesUnsubscribe: null as (() => void) | null,

  async loadData(): Promise<void> {
    try {
      const families = await loadFamilies();
      // 确保当前家庭已恢复并有效
      const current = restoreCurrentFamily(families) || currentFamilyStore.value;
      this.setData({
        families: families as FamilyView[],
        currentFamily: current as FamilyView | null,
        canSwitch: families.length > 1,
        isAdmin: (current as FamilyView | null)?.role === 'admin',
        loaded: true,
      });

      // 同步 globalData
      const app = getApp<IAppOption>();
      if (app) {
        app.globalData.families = families;
        app.globalData.currentFamily = current;
      }

      // 近期日程与待办任务独立加载，失败不影响页面其余部分
      if (current) {
        this.loadUpcomingEvents(current.id);
        this.loadTasks(current.id);
      }
    } catch (e) {
      console.error('[Home] Load data failed:', e);
      this.setData({ loaded: true });
    }
  },

  /** 加载近期日程（未来 7 天，独立于家庭信息加载） */
  async loadUpcomingEvents(familyId: string): Promise<void> {
    this.setData({ eventsLoading: true, eventsError: false });
    try {
      const today = new Date();
      const start = formatYmd(today);
      const end = new Date(today);
      end.setDate(end.getDate() + 7);
      const endStr = formatYmd(end);

      const events = await listEvents(familyId, { start, end: endStr, status: 'active' });
      // 家庭已切换则丢弃过期结果
      if (this.data.currentFamily?.id !== familyId) return;

      // 按开始时间升序，确保"最近"的排在最前
      const sorted = [...events].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
      );
      const all = sorted.map(mapUpcomingEvent);
      this.setData({
        upcomingEvents: all.slice(0, HOME_LIMIT),
        upcomingTotal: all.length,
        eventsLoading: false,
      });
    } catch (e) {
      console.error('[Home] Load upcoming events failed:', e);
      if (this.data.currentFamily?.id !== familyId) return;
      this.setData({ eventsLoading: false, eventsError: true });
    }
  },

  /** 点击某条日程进入详情 */
  onEventTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id || !this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/events/detail?id=${id}&familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 重试加载近期日程 */
  onRetryEvents(): void {
    if (!this.data.currentFamily) return;
    this.loadUpcomingEvents(this.data.currentFamily.id);
  },

  /** 加载待办任务（独立于家庭信息加载，默认展示进行中的任务） */
  async loadTasks(familyId: string): Promise<void> {
    this.setData({ tasksLoading: true, tasksError: false });
    try {
      const tasks = await listTasks(familyId, { status: 'pending' });
      // 家庭已切换则丢弃过期结果
      if (this.data.currentFamily?.id !== familyId) return;

      const all = tasks.map(mapTaskHome);
      this.setData({
        tasks: all.slice(0, HOME_LIMIT),
        pendingTaskCount: all.length,
        tasksLoading: false,
      });
    } catch (e) {
      console.error('[Home] Load tasks failed:', e);
      if (this.data.currentFamily?.id !== familyId) return;
      this.setData({ tasksLoading: false, tasksError: true });
    }
  },

  /** 点击某条待办进入详情 */
  onTaskTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id || !this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/tasks/detail?id=${id}&familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 重试加载待办任务 */
  onRetryTasks(): void {
    if (!this.data.currentFamily) return;
    this.loadTasks(this.data.currentFamily.id);
  },

  /** 在首页快速切换任务完成 / 恢复状态 */
  async onToggleTaskStatus(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const id = e.currentTarget.dataset.id as string;
    const task = this.data.tasks.find(t => t.id === id);
    if (!task || task.completing || !this.data.currentFamily) return;

    try {
      const updatedTasks = this.data.tasks.map(t =>
        t.id === id ? { ...t, completing: true } : t,
      );
      this.setData({ tasks: updatedTasks });

      if (task.status === 'pending') {
        await completeTask(this.data.currentFamily.id, id, task.version);
        this.setData({
          tasks: this.data.tasks.filter(t => t.id !== id),
          pendingTaskCount: Math.max(0, this.data.pendingTaskCount - 1),
        });
        showSuccess('已完成');
      } else {
        await reopenTask(this.data.currentFamily.id, id, task.version);
        this.setData({
          tasks: this.data.tasks.map(t =>
            t.id === id ? { ...t, status: 'pending' as const, completing: false } : t,
          ),
          pendingTaskCount: this.data.pendingTaskCount + 1,
        });
        showSuccess('已恢复');
      }
    } catch (error: unknown) {
      this.setData({
        tasks: this.data.tasks.map(t =>
          t.id === id ? { ...t, completing: false } : t,
        ),
      });
      console.error('[Home] Toggle task status failed:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'CONFLICT' || err.code === 'VERSION_CONFLICT') {
        showError('内容已被其他家庭成员修改，请刷新后重试');
        this.loadTasks(this.data.currentFamily.id);
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '操作失败，请重试');
    }
  },

  /** 切换家庭（仅在多个家庭时可用） */
  onSwitchFamily(): void {
    const { families, currentFamily } = this.data;
    if (!families || families.length <= 1) return;

    wx.showActionSheet({
      itemList: families.map(f => f.name),
      success: (res) => {
        const selected = families[res.tapIndex];
        if (selected.id !== currentFamily?.id) {
          setCurrentFamily(selected);
          showSuccess(`已切换到 ${selected.name}`);
        }
      },
    });
  },

  /** 创建家庭（独立页面） */
  onCreateFamily(): void {
    wx.navigateTo({
      url: '/pages/family/create',
    });
  },

  /** 加入家庭 */
  onJoinFamily(): void {
    wx.navigateTo({
      url: '/pages/family/join',
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

  /** 邀请家人（仅管理员可见入口） */
  onInviteFamily(): void {
    if (!this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/family/invites?familyId=${this.data.currentFamily.id}`,
    });
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

function mapUpcomingEvent(e: Event): UpcomingEventView {
  const start = new Date(e.start);
  const today = formatYmd(new Date());
  const tomorrow = formatYmd(addDays(new Date(), 1));
  const startDate = formatYmd(start);
  let dateText = '今天';
  if (startDate === tomorrow) dateText = '明天';
  else if (startDate !== today) {
    dateText = `${start.getMonth() + 1}/${start.getDate()}`;
  }

  let timeText = '全天';
  if (!e.isAllDay) {
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const end = new Date(e.end);
    timeText = `${pad(start.getHours())}:${pad(start.getMinutes())} - ${pad(end.getHours())}:${pad(end.getMinutes())}`;
  }
  const names = e.attendees.map(a => a.displayName);
  const attendeeText = names.length > 0 ? names.join('、') : '';
  return { id: e.id, summary: e.summary, dateText, timeText, attendeeText };
}

function mapTaskHome(t: Task): TaskHomeView {
  const today = formatYmd(new Date());
  const dueText = t.due ? formatDate(t.due, 'date') : '';
  const isOverdue = t.status === 'pending' && t.due ? t.due < today : false;
  const assigneeText = (t.assignees || []).map(a => a.displayName).join('、');
  return {
    id: t.id,
    name: t.name,
    status: t.status as 'pending' | 'completed',
    due: t.due,
    dueText,
    isOverdue,
    assigneeText,
    version: t.version,
    completing: false,
  };
}
