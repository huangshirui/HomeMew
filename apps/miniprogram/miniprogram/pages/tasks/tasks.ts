/**
 * 待办任务列表页
 *
 * 顶部统计卡片（进行中 / 已完成）+ 三标签筛选 + 任务列表。
 * - 默认展示「全部」标签下的所有任务。
 * - 支持切换：全部 / 进行中 / 已完成。
 * - 点击复选框可切换完成/恢复状态。
 * - 点击任务卡片进入详情。
 * - 右下角悬浮按钮：新建待办。
 */

import { listTasks, completeTask, reopenTask, deleteTask } from '../../services/tasks';
import { currentFamilyStore } from '../../stores/index';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  showConfirm,
  getErrorMessage,
} from '../../utils/index';
import { Task } from '../../types/index';

type TabType = 'all' | 'pending' | 'completed';

type TaskView = {
  id: string;
  name: string;
  status: 'pending' | 'completed';
  due: string | null;
  dueText: string;
  isOverdue: boolean;
  assignees: { userId: string; displayName: string }[];
  assigneeText: string;
  version: number;
  completing: boolean;
};

Page({
  data: {
    activeTab: 'all' as TabType,
    pendingCount: 0,
    completedCount: 0,
    tasks: [] as TaskView[],
    loaded: false,
    familyId: '' as string,
  },

  onLoad(options: { familyId?: string }): void {
    const familyId = currentFamilyStore.value?.id || options.familyId || '';
    if (!familyId) {
      showError('缺少家庭信息');
      this.setData({ loaded: true });
      return;
    }
    this.setData({ familyId });
    this.loadTasks();
  },

  onShow(): void {
    const familyId = currentFamilyStore.value?.id;
    if (familyId && this.data.familyId && familyId !== this.data.familyId) {
      this.setData({ familyId });
      this.loadTasks();
      return;
    }
    if (this.data.loaded) {
      this.loadTasks();
    }
  },

  async loadTasks(): Promise<void> {
    if (!this.data.familyId) return;
    showLoading('加载中...');
    try {
      const [allTasks, pendingTasks, completedTasks] = await Promise.all([
        listTasks(this.data.familyId),
        listTasks(this.data.familyId, { status: 'pending' }),
        listTasks(this.data.familyId, { status: 'completed' }),
      ]);
      hideLoading();
      const allViews = this.mapTasks(allTasks);
      this.setData({
        tasks: allViews,
        pendingCount: pendingTasks.length,
        completedCount: completedTasks.length,
        loaded: true,
      });
      this.applyTabFilter();
    } catch (error: unknown) {
      hideLoading();
      console.error('[Tasks] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
    }
  },

  mapTasks(tasks: Task[]): TaskView[] {
    const today = formatYmd(new Date());
    return tasks.map(t => {
      const dueText = t.due ? formatDate(t.due, 'date') : '';
      const isOverdue = t.status === 'pending' && t.due ? t.due < today : false;
      const assignees = (t.assignees || []).map(a => ({ userId: a.userId, displayName: a.displayName }));
      let assigneeText = '';
      if (assignees.length > 0) {
        assigneeText = assignees.map(a => a.displayName).join('、');
      }
      return {
        id: t.id,
        name: t.name,
        status: t.status as 'pending' | 'completed',
        due: t.due,
        dueText,
        isOverdue,
        assignees,
        assigneeText,
        version: t.version,
        completing: false,
      };
    });
  },

  applyTabFilter(): void {
    // 实际筛选在 wxml 中通过 wx:if 处理，这里仅记录当前 tab 状态
    // 数据已全部加载，由模板根据 activeTab 过滤展示
  },

  onTabChange(e: WechatMiniprogram.TouchEvent): void {
    const tab = e.currentTarget.dataset.tab as TabType;
    if (!tab) return;
    this.setData({ activeTab: tab });
  },

  getFilteredTasks(): TaskView[] {
    const { tasks, activeTab } = this.data;
    if (activeTab === 'pending') return tasks.filter(t => t.status === 'pending');
    if (activeTab === 'completed') return tasks.filter(t => t.status === 'completed');
    return tasks;
  },

  async onToggleStatus(e: WechatMiniprogram.TouchEvent): Promise<void> {
    // 阻止事件冒泡，避免触发 onTaskTap
    const id = e.currentTarget.dataset.id as string;
    const task = this.data.tasks.find(t => t.id === id);
    if (!task || task.completing) return;

    try {
      const updatedTasks = this.data.tasks.map(t =>
        t.id === id ? { ...t, completing: true } : t,
      );
      this.setData({ tasks: updatedTasks });

      if (task.status === 'pending') {
        await completeTask(this.data.familyId, id, task.version);
        // 更新本地状态
        this.setData({
          tasks: this.data.tasks.map(t =>
            t.id === id ? { ...t, status: 'completed', completing: false } : t,
          ),
          pendingCount: Math.max(0, this.data.pendingCount - 1),
          completedCount: this.data.completedCount + 1,
        });
        showSuccess('已完成');
      } else {
        await reopenTask(this.data.familyId, id, task.version);
        this.setData({
          tasks: this.data.tasks.map(t =>
            t.id === id ? { ...t, status: 'pending', completing: false } : t,
          ),
          pendingCount: this.data.pendingCount + 1,
          completedCount: Math.max(0, this.data.completedCount - 1),
        });
        showSuccess('已恢复');
      }
    } catch (error: unknown) {
      this.setData({
        tasks: this.data.tasks.map(t =>
          t.id === id ? { ...t, completing: false } : t,
        ),
      });
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

  onTaskTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/tasks/detail?id=${id}&familyId=${this.data.familyId}`,
    });
  },

  async onDelete(e: WechatMiniprogram.TouchEvent): Promise<void> {
    e.stopPropagation();
    const id = e.currentTarget.dataset.id as string;
    const task = this.data.tasks.find(t => t.id === id);
    if (!task) return;

    const confirmed = await showConfirm('删除待办', `确定要删除「${task.name}」吗？`);
    if (!confirmed) return;

    showLoading('删除中...');
    try {
      await deleteTask(this.data.familyId, id, task.version);
      hideLoading();
      showSuccess('已删除');
      // 从列表移除并更新计数
      const remaining = this.data.tasks.filter(t => t.id !== id);
      const pendingCount = remaining.filter(t => t.status === 'pending').length;
      const completedCount = remaining.filter(t => t.status === 'completed').length;
      this.setData({ tasks: remaining, pendingCount, completedCount });
    } catch (error: unknown) {
      hideLoading();
      console.error('[Tasks] Delete failed:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'CONFLICT' || err.code === 'VERSION_CONFLICT') {
        showError('内容已被其他家庭成员修改，请刷新后重试');
        this.loadTasks();
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '删除失败，请重试');
    }
  },

  onCreate(): void {
    wx.navigateTo({
      url: `/pages/tasks/edit?familyId=${this.data.familyId}`,
    });
  },
});

/* ----------------- 工具函数 ----------------- */

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDate(dateStr: string, format: 'date' | 'datetime' | 'time' = 'date'): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  switch (format) {
    case 'date':
      return `${year}-${month}-${day}`;
    default:
      return `${year}-${month}-${day}`;
  }
}
