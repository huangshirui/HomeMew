/**
 * 待办任务详情页
 *
 * 展示任务完整信息并支持编辑、删除、完成/恢复操作。
 * 遵循 SPEC 10.4 - 10.8。
 */

import { getTask, deleteTask, completeTask, reopenTask } from '../../services/tasks';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  showConfirm,
  getErrorMessage,
  isVersionConflict,
  formatDate,
  timeAgo,
} from '../../utils/index';
import { Task } from '../../types/index';
import { markDirty } from '../../stores/dirty';

Page({
  data: {
    familyId: '',
    taskId: '',
    task: null as Task | null,
    /** 视图层使用的派生字段 */
    name: '',
    description: '',
    dueDate: '' as string | null,
    dueText: '无',
    status: '' as 'pending' | 'completed' | 'cancelled',
    statusText: '',
    assigneeNames: '',
    createdByText: '',
    createdBySystem: false,
    completedByText: '',
    completedBySystem: false,
    completedAtText: '',
    updatedByText: '',
    updatedBySystem: false,
    createdAtText: '',
    updatedAtText: '',
    loaded: false,
    deleting: false,
    toggling: false,
  },

  onLoad(options: { id?: string; familyId?: string }): void {
    const taskId = options?.id;
    const familyId = options?.familyId;
    if (!taskId || !familyId) {
      showError('缺少任务参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ taskId, familyId });
    this.loadTask();
  },

  onShow(): void {
    // 从编辑页返回后刷新，避免继续展示编辑前的旧数据
    if (this.data.loaded && this.data.taskId) {
      this.loadTask();
    }
  },

  async loadTask(): Promise<void> {
    try {
      const task = await getTask(this.data.familyId, this.data.taskId);
      this.applyTask(task);
    } catch (error: unknown) {
      console.error('[TaskDetail] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message) || '任务加载失败');
      this.setData({ loaded: true });
    }
  },

  applyTask(task: Task): void {
    const assignees = task.assignees || [];
    const today = formatYmd(new Date());
    const isOverdue =
      task.status === 'pending' && task.dueDate ? task.dueDate < today : false;

    let statusText = '';
    switch (task.status) {
      case 'pending':
        statusText = isOverdue ? '已逾期' : '进行中';
        break;
      case 'completed':
        statusText = '已完成';
        break;
      case 'cancelled':
        statusText = '已取消';
        break;
    }

    this.setData({
      task,
      name: task.name,
      description: task.description || '',
      dueDate: task.dueDate,
      dueText: task.dueDate ? formatDate(task.dueDate, 'date') : '无',
      status: task.status,
      statusText,
      assigneeNames: assignees.length ? assignees.map(a => a.displayName).join('、') : '未指定（家庭公共待办）',
      createdByText: task.createdBy?.name || '',
      createdBySystem: task.createdBy?.type === 'system',
      completedByText: task.completedBy ? `${task.completedBy.name}` : '',
      completedBySystem: task.completedBy?.type === 'system',
      completedAtText: task.completedAt ? `${formatDate(task.completedAt, 'datetime')} · ${timeAgo(task.completedAt)}` : '',
      updatedByText: task.updatedBy?.name || '',
      updatedBySystem: task.updatedBy?.type === 'system',
      createdAtText: `${formatDate(task.createdAt, 'datetime')} · ${timeAgo(task.createdAt)}`,
      updatedAtText: `${formatDate(task.updatedAt, 'datetime')} · ${timeAgo(task.updatedAt)}`,
      loaded: true,
      // 重新加载后复位操作态，避免完成/恢复成功后按钮永久停留在「处理中...」
      toggling: false,
      deleting: false,
    });
  },

  onEdit(): void {
    if (!this.data.task) return;
    wx.navigateTo({
      url: `/pages/tasks/edit?familyId=${this.data.familyId}&id=${this.data.task.id}`,
    });
  },

  async onToggleStatus(): Promise<void> {
    const task = this.data.task;
    if (!task || this.data.toggling) return;

    const action = task.status === 'pending' ? 'complete' : 'reopen';
    const confirmText = task.status === 'pending'
      ? `确定要标记「${task.name}」为已完成吗？`
      : `确定要恢复「${task.name}」为待完成状态吗？`;

    const confirmed = await showConfirm(confirmText.includes('完成') ? '完成任务' : '恢复任务', confirmText);
    if (!confirmed) return;

    this.setData({ toggling: true });
    showLoading(action === 'complete' ? '完成中...' : '恢复中...');
    try {
      const updated = action === 'complete'
        ? await completeTask(this.data.familyId, task.id, task.version)
        : await reopenTask(this.data.familyId, task.id, task.version);
      hideLoading();
      showSuccess(action === 'complete' ? '已完成' : '已恢复');
      markDirty('tasks');
      // 直接用返回的最新 Task 更新视图（applyTask 会复位 toggling）
      this.applyTask(updated);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ toggling: false });
      console.error('[TaskDetail] Toggle failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError(getErrorMessage(err.code) || '内容已被其他家庭成员修改，请刷新后重试');
        this.loadTask();
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '操作失败，请重试');
    }
  },

  async onDelete(): Promise<void> {
    const task = this.data.task;
    if (!task || this.data.deleting) return;
    const confirmed = await showConfirm('删除待办', `确定要删除「${task.name}」吗？`);
    if (!confirmed) return;
    this.setData({ deleting: true });
    showLoading('删除中...');
    try {
      await deleteTask(this.data.familyId, task.id, task.version);
      hideLoading();
      showSuccess('已删除');
      markDirty('tasks');
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ deleting: false });
      console.error('[TaskDetail] Delete failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError(getErrorMessage(err.code) || '内容已被其他家庭成员修改，请刷新后重试');
        this.loadTask();
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '删除失败，请重试');
    }
  },
});

/* ----------------- 工具函数 ----------------- */

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
