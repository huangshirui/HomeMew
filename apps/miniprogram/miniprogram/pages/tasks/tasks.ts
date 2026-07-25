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
import { showError, showSuccess, getErrorMessage } from '../../utils/index';
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
      this.loadTasks();
    }
  },

  async loadTasks(): Promise<void> {
    if (!this.data.familyId) return;
    if (!this.data.loaded) {
      // 首次加载展示加载态；刷新时静默
    }
    this.setData({ listError: false });
    try {
      const [pending, completed] = await Promise.all([
        listTasks(this.data.familyId, { status: 'pending' }),
        listTasks(this.data.familyId, { status: 'completed' }),
      ]);
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
    const inPending = this.data.pendingTasks.find(t => t.id === id);
    const inCompleted = this.data.completedTasks.find(t => t.id === id);
    const task = inPending || inCompleted;
    if (!task || task.completing) return;

    // 乐观置为 loading
    this.setCompleting(id, true);

    try {
      if (task.status === 'pending') {
        await completeTask(this.data.familyId, id, task.version);
        showSuccess('已完成');
      } else {
        await reopenTask(this.data.familyId, id, task.version);
        showSuccess('已恢复');
      }
      // 操作成功后重新拉取，保证两份列表与计数一致
      this.loadTasks();
    } catch (error: unknown) {
      this.setCompleting(id, false);
      console.error('[Tasks] Toggle status failed:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'CONFLICT' || err.code === 'VERSION_CONFLICT') {
        showError('内容已被其他家庭成员修改，请刷新后重试');
        this.loadTasks();
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '操作失败，请重试');
    }
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
