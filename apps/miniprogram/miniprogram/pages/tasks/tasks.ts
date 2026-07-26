/**
 * 待办任务列表页
 *
 * 顶部两段式统计/切换（进行中 N | 已完成 M）+ 任务列表。
 * - 默认进入「进行中」。
 * - 按当前 tab 的 status 请求数据；进行中 / 已完成两份数据一次性加载并缓存，切换 tab 不再请求网络。
 * - 空状态按当前 tab 文案区分。
 * - 无家庭时展示统一引导（创建 / 加入家庭）。
 * - 点击复选框可切换完成 / 恢复状态；点击卡片进入详情。
 * - 删除操作已迁移至详情页，列表不再常驻删除入口。
 */

import { listTasks, completeTask, reopenTask } from '../../services/tasks';
import { currentFamilyStore } from '../../stores/index';
import { consumeDirty, markDirty, subscribe } from '../../stores/dirty';
import { showError, showSuccess, getErrorMessage, isVersionConflict } from '../../utils/index';
import { Task } from '../../types/index';

type TabType = 'pending' | 'completed';

type TaskView = {
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

Page({
  data: {
    activeTab: 'pending' as TabType,
    pendingCount: 0,
    completedCount: 0,
    pendingTasks: [] as TaskView[],
    completedTasks: [] as TaskView[],
    displayTasks: [] as TaskView[],
    loaded: false,
    listError: false,
    noFamily: false,
    familyId: '' as string,
  },

  /** 请求序号：用于丢弃过期（家庭切换 / 慢网络）返回结果 */
  _reqSeq: 0,

  // 脏标记订阅句柄：页面可见期间订阅，隐藏时取消，避免误刷新与泄漏
  _dirtyUnsubscribe: null as (() => void) | null,

  onLoad(options: { familyId?: string }): void {
    const familyId = currentFamilyStore.value?.id || options.familyId || '';
    if (!familyId) {
      this.setData({ loaded: true, noFamily: true });
      return;
    }
    this.setData({ familyId, noFamily: false });
    this.loadTasks();
  },

  onShow(): void {
    this._subscribeDirty();
    const familyId = currentFamilyStore.value?.id || '';
    // 从无家庭恢复到有家庭
    if (familyId && this.data.noFamily) {
      this.setData({ familyId, noFamily: false });
      this.loadTasks();
      return;
    }
    // 家庭切换
    if (familyId && this.data.familyId && familyId !== this.data.familyId) {
      this.setData({ familyId });
      this.loadTasks();
      return;
    }
    // 变为无家庭
    if (!familyId && this.data.loaded && !this.data.noFamily) {
      this.setData({ noFamily: true });
      return;
    }
    if (this.data.loaded && !this.data.noFamily) {
      // 已加载：仅当数据被标记变更（新建 / 编辑 / 删除 / 完成 / 恢复后返回）时才重新拉取
      if (consumeDirty('tasks')) {
        this.loadTasks();
      }
      return;
    }
  },

  _subscribeDirty(): void {
    this._unsubscribeDirty();
    this._dirtyUnsubscribe = subscribe((domain) => {
      if (domain !== 'tasks') return;
      if (!this.data.loaded || this.data.noFamily) return;
      if (currentFamilyStore.value?.id !== this.data.familyId) return;
      this.loadTasks();
    });
  },

  _unsubscribeDirty(): void {
    if (this._dirtyUnsubscribe) {
      this._dirtyUnsubscribe();
      this._dirtyUnsubscribe = null;
    }
  },

  async loadTasks(): Promise<void> {
    const familyId = this.data.familyId;
    if (!familyId) return;
    const reqSeq = ++this._reqSeq;
    this.setData({ listError: false });
    try {
      const [pending, completed] = await Promise.all([
        listTasks(familyId, { status: 'pending' }),
        listTasks(familyId, { status: 'completed' }),
      ]);
      // 家庭已切换 / 存在更新的请求：丢弃过期结果，避免旧家庭数据覆盖当前页面
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      const pendingTasks = this.mapTasks(pending);
      const completedTasks = this.mapTasks(completed);
      this.setData({
        pendingTasks,
        completedTasks,
        pendingCount: pendingTasks.length,
        completedCount: completedTasks.length,
        displayTasks: this.data.activeTab === 'pending' ? pendingTasks : completedTasks,
        loaded: true,
        listError: false,
      });
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      console.error('[Tasks] Load failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loaded: true, listError: true });
      showError(getErrorMessage(err.code, err.message));
    }
  },

  onRetry(): void {
    this.loadTasks();
  },

  mapTasks(tasks: Task[]): TaskView[] {
    const today = formatYmd(new Date());
    return tasks.map(t => {
      const isOverdue = t.status === 'pending' && !!t.due && (t.due as string) < today;
      const dueText = formatDueText(t.due, t.status as 'pending' | 'completed', today);
      const assigneeText = formatAssignees((t.assignees || []).map(a => a.displayName));
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
    });
  },

  onTabChange(e: WechatMiniprogram.TouchEvent): void {
    const tab = e.currentTarget.dataset.tab as TabType;
    if (!tab || tab === this.data.activeTab) return;
    this.setData({
      activeTab: tab,
      displayTasks: tab === 'pending' ? this.data.pendingTasks : this.data.completedTasks,
    });
  },

  async onToggleStatus(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const id = e.currentTarget.dataset.id as string;
    const familyId = this.data.familyId;
    const inPending = this.data.pendingTasks.find(t => t.id === id);
    const inCompleted = this.data.completedTasks.find(t => t.id === id);
    const task = inPending || inCompleted;
    if (!task || task.completing) return;

    // 乐观置为 loading
    this.setCompleting(id, true);

    try {
      const updated = task.status === 'pending'
        ? await completeTask(familyId, id, task.version)
        : await reopenTask(familyId, id, task.version);
      // 家庭已切换：不再改动当前页面
      if (familyId !== this.data.familyId) return;
      showSuccess(task.status === 'pending' ? '已完成' : '已恢复');
      // 直接用返回结果在两份列表间移动，立即消除 loading；再后台静默刷新校准
      this.applyToggledTask(id, updated);
      // mark dirty so home / other tabs refresh on return, and this page refreshes live via subscription
      markDirty('tasks');
    } catch (error: unknown) {
      if (familyId !== this.data.familyId) return;
      this.setCompleting(id, false);
      console.error('[Tasks] Toggle status failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError(getErrorMessage(err.code) || '内容已被其他家庭成员修改，请刷新后重试');
        this.loadTasks();
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '操作失败，请重试');
    }
  },

  /** 根据返回的最新 Task，在「进行中 / 已完成」两份列表间移动该任务 */
  applyToggledTask(id: string, updated: Task): void {
    const mapped = this.mapTasks([updated])[0];
    const pendingTasks = this.data.pendingTasks.filter(t => t.id !== id);
    const completedTasks = this.data.completedTasks.filter(t => t.id !== id);
    if (mapped.status === 'pending') {
      pendingTasks.unshift(mapped);
    } else {
      completedTasks.unshift(mapped);
    }
    this.setData({
      pendingTasks,
      completedTasks,
      pendingCount: pendingTasks.length,
      completedCount: completedTasks.length,
      displayTasks: this.data.activeTab === 'pending' ? pendingTasks : completedTasks,
    });
  },

  setCompleting(id: string, completing: boolean): void {
    const upd = (list: TaskView[]) => list.map(t => (t.id === id ? { ...t, completing } : t));
    const pendingTasks = upd(this.data.pendingTasks);
    const completedTasks = upd(this.data.completedTasks);
    this.setData({
      pendingTasks,
      completedTasks,
      displayTasks: this.data.activeTab === 'pending' ? pendingTasks : completedTasks,
    });
  },

  onTaskTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/tasks/detail?id=${id}&familyId=${this.data.familyId}`,
    });
  },

  onCreate(): void {
    if (!this.data.familyId) return;
    wx.navigateTo({
      url: `/pages/tasks/edit?familyId=${this.data.familyId}`,
    });
  },

  onCreateFamily(): void {
    wx.navigateTo({ url: '/pages/family/create' });
  },

  onJoinFamily(): void {
    wx.navigateTo({ url: '/pages/family/join' });
  },
});

/* ----------------- 工具函数 ----------------- */

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 负责人折叠：超过 2 人显示「A、B 等N人」 */
function formatAssignees(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join('、');
  return `${names.slice(0, 2).join('、')} 等${names.length}人`;
}

/**
 * 友好截止文案：
 * - 进行中且已逾期：已逾期N天
 * - 今天到期 / 明天到期
 * - 其他：M月D日
 */
function formatDueText(due: string | null, status: 'pending' | 'completed', today: string): string {
  if (!due) return '';
  const dueDate = new Date(`${due}T00:00:00`);
  if (isNaN(dueDate.getTime())) return due;

  const month = dueDate.getMonth() + 1;
  const day = dueDate.getDate();
  const label = `${month}月${day}日`;

  if (status === 'completed') return label;

  const todayDate = new Date(`${today}T00:00:00`);
  const diffDays = Math.round((dueDate.getTime() - todayDate.getTime()) / 86400000);

  if (diffDays < 0) return `已逾期${-diffDays}天`;
  if (diffDays === 0) return '今天到期';
  if (diffDays === 1) return '明天到期';
  return label;
}
