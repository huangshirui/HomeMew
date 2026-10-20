/**
 * 已完成待办列表页（待办页右上角入口）
 *
 * - 继承待办页的成员范围偏好（stores/tasks-scope），本页不再提供筛选器，
 *   顶部只做只读展示，避免两处筛选状态互相打架。
 * - 只拉 status=completed，按最近更新倒序。
 * - 支持下拉刷新；点击复选框可恢复为进行中；点击卡片进入详情。
 * - 完成 / 恢复后 markDirty('tasks')，待办页与首页随之刷新。
 */

import { listTasks, reopenTask } from '../../services/tasks';
import { listFamilyMembers } from '../../services/families';
import { currentFamilyStore, userStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { consumeDirty, markDirty, subscribe } from '../../stores/dirty';
import { loadTasksScope, assigneeParamOf, TasksScope } from '../../stores/tasks-scope';
import {
  showError,
  showSuccess,
  getErrorMessage,
  isVersionConflict,
  formatDate,
} from '../../utils/index';
import { Task, FamilyMember } from '../../types/index';
import { downloadRecordIconImage } from '../../services/record-icons';

type TaskView = {
  id: string;
  name: string;
  iconEmoji: string;
  iconImagePath: string;
  completedText: string;
  assigneeText: string;
  version: number;
  reopening: boolean;
};

Page({
  data: {
    scope: 'me' as TasksScope,
    scopeLabel: '我的待办',
    tasks: [] as TaskView[],
    total: 0,
    loaded: false,
    listError: false,
    familyId: '' as string,

    /** 下拉刷新指示器状态（scroll-view refresher） */
    refreshing: false,
  },

  /** 请求序号：用于丢弃过期返回结果 */
  _reqSeq: 0,
  /** 缓存 onLoad 入参，供初始化失败后重试复用 */
  _initOptions: null as { familyId?: string } | null,
  _members: [] as FamilyMember[],
  _dirtyUnsubscribe: null as (() => void) | null,

  async onLoad(options: { familyId?: string }): Promise<void> {
    this._initOptions = options;
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[CompletedTasks] Runtime bootstrap failed:', error);
      this.setData({ loaded: true, listError: true });
      return;
    }
    const familyId = currentFamilyStore.value?.id || options.familyId || '';
    if (!familyId) {
      this.setData({ loaded: true, listError: true });
      return;
    }
    const scope = loadTasksScope(familyId, userStore.value?.id || '');
    this.setData({ familyId, scope, scopeLabel: labelForScope(scope, this._members) });
    this.loadMembers();
    this.loadTasks();
  },

  onShow(): void {
    this._subscribeDirty();
    if (this.data.loaded && this.data.familyId && consumeDirty('tasks')) {
      this.syncScope();
      this.loadTasks();
    }
  },

  onHide(): void {
    this._unsubscribeDirty();
  },

  onUnload(): void {
    this._unsubscribeDirty();
  },

  _subscribeDirty(): void {
    this._unsubscribeDirty();
    this._dirtyUnsubscribe = subscribe((domain) => {
      if (domain !== 'tasks') return;
      if (!this.data.loaded || !this.data.familyId) return;
      if (currentFamilyStore.value?.id !== this.data.familyId) return;
      consumeDirty('tasks');
      this.syncScope();
      this.loadTasks();
    });
  },

  _unsubscribeDirty(): void {
    if (this._dirtyUnsubscribe) {
      this._dirtyUnsubscribe();
      this._dirtyUnsubscribe = null;
    }
  },

  /** 待办页可能已切换成员范围：重新读取共享偏好 */
  syncScope(): void {
    const scope = loadTasksScope(this.data.familyId, userStore.value?.id || '');
    if (scope !== this.data.scope) {
      this.setData({ scope, scopeLabel: labelForScope(scope, this._members) });
    }
  },

  async loadMembers(): Promise<void> {
    const familyId = this.data.familyId;
    if (!familyId) return;
    try {
      const members = await listFamilyMembers(familyId);
      if (familyId !== this.data.familyId) return;
      this._members = members;
      this.setData({ scopeLabel: labelForScope(this.data.scope, members) });
    } catch (error) {
      console.error('[TasksCompleted] Load members failed:', error);
    }
  },

  async loadTasks(): Promise<void> {
    const familyId = this.data.familyId;
    if (!familyId) return;
    const reqSeq = ++this._reqSeq;
    this.setData({ listError: false });
    try {
      const assigneeId = assigneeParamOf(this.data.scope);
      const tasks = await listTasks(familyId, {
        status: 'completed',
        includeNoDue: true,
        sort: 'updated_desc',
        ...(assigneeId ? { assigneeId } : {}),
      });
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      const views = tasks.map(mapTask);
      this.setData({ tasks: views, total: views.length, loaded: true, listError: false });
      for (const task of tasks) {
        if (task.presentation?.icon?.type !== 'image') continue;
        void downloadRecordIconImage(familyId, 'task', task.id, task.presentation.icon.fileId)
          .then(iconImagePath => {
            if (familyId !== this.data.familyId || reqSeq !== this._reqSeq) return;
            this.setData({ tasks: this.data.tasks.map(item => item.id === task.id ? { ...item, iconImagePath } : item) });
          }).catch(() => undefined);
      }
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      console.error('[TasksCompleted] Load failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loaded: true, listError: true });
      showError(getErrorMessage(err.code, err.message));
    }
  },

  onRetry(): void {
    // 既覆盖首屏数据加载失败，也覆盖运行时初始化失败：重新走完整 onLoad
    this.onLoad(this._initOptions || {});
  },

  /** 下拉刷新：仅内容区下拉（nav-bar 固定），重新拉取已完成待办 */
  onRefresh(): void {
    this.setData({ refreshing: true });
    Promise.resolve(this.loadTasks())
      .then(() => this.setData({ refreshing: false }))
      .catch(() => this.setData({ refreshing: false }));
  },

  /** 恢复为进行中 */
  async onReopen(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const id = e.currentTarget.dataset.id as string;
    const familyId = this.data.familyId;
    const task = this.data.tasks.find(t => t.id === id);
    if (!task || task.reopening) return;

    this.setReopening(id, true);
    try {
      await reopenTask(familyId, id, task.version);
      if (familyId !== this.data.familyId) return;
      showSuccess('已恢复');
      const tasks = this.data.tasks.filter(t => t.id !== id);
      this.setData({ tasks, total: tasks.length });
      markDirty('tasks');
    } catch (error: unknown) {
      if (familyId !== this.data.familyId) return;
      this.setReopening(id, false);
      console.error('[TasksCompleted] Reopen failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError(getErrorMessage(err.code) || '内容已被其他家庭成员修改，请刷新后重试');
        this.loadTasks();
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '操作失败，请重试');
    }
  },

  setReopening(id: string, reopening: boolean): void {
    this.setData({
      tasks: this.data.tasks.map(t => (t.id === id ? { ...t, reopening } : t)),
    });
  },

  onTaskTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/tasks/detail?id=${id}&familyId=${this.data.familyId}`,
    });
  },
});

/* ----------------- 工具函数 ----------------- */

function labelForScope(scope: TasksScope, members: FamilyMember[]): string {
  if (scope === 'all') return '全家';
  if (scope === 'me') return '我的';
  const member = members.find(m => m.userId === scope);
  return member ? `${member.displayName}的待办` : '家人待办';
}

function mapTask(t: Task): TaskView {
  return {
    id: t.id,
    name: t.name,
    iconEmoji: t.presentation?.icon?.type === 'emoji' ? t.presentation.icon.value : '',
    iconImagePath: '',
    completedText: t.completedAt ? `${formatDate(t.completedAt, 'datetime')} 完成` : '已完成',
    assigneeText: formatAssignees((t.assignees || []).map(a => a.displayName)),
    version: t.version,
    reopening: false,
  };
}

/** 负责人折叠：超过 2 人显示「A、B 等N人」 */
function formatAssignees(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join('、');
  return `${names.slice(0, 2).join('、')} 等${names.length}人`;
}
