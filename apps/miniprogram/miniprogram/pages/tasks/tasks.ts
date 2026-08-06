/**
 * 待办任务列表页（进行中）
 *
 * 顶栏（对齐日程页）：左「成员范围」选择器 + 右「已完成」入口。
 * - 成员范围：全家待办 / 我的待办 / 指定成员，默认「我的待办」，按
 *   (familyId, userId) 本地持久化（stores/tasks-scope），与日程页相互独立。
 * - 切换成员会 markDirty('tasks')，首页「待办提醒」随之以新范围重新拉取。
 * - 已完成任务移至独立子页 pages/tasks/completed。
 * - 顶部统计只展示「进行中 / 已逾期」，不再展示已完成。
 * - 支持下拉刷新。
 * - 点击复选框完成任务；点击卡片进入详情。
 */

import { listTasks, completeTask } from '../../services/tasks';
import { listFamilyMembers } from '../../services/families';
import { currentFamilyStore, userStore } from '../../stores/index';
import { consumeDirty, markDirty, subscribe } from '../../stores/dirty';
import {
  loadTasksScope,
  saveTasksScope,
  assigneeParamOf,
  TasksScope,
} from '../../stores/tasks-scope';
import {
  showError,
  showSuccess,
  getErrorMessage,
  isVersionConflict,
  formatInstantInTimeZone,
  safeAvatarUrl,
} from '../../utils/index';
import { getViewingTimeZone } from '../../services/settings';
import { Task, FamilyMember } from '../../types/index';

type TaskView = {
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

type ScopeOption = {
  key: string;
  label: string;
  avatarUrl: string;
  showAvatar: boolean;
};

Page({
  data: {
    // 成员范围
    scope: 'me' as TasksScope,
    scopeLabel: '我的待办',
    scopeOptions: [] as ScopeOption[],
    showScopeSheet: false,

    pendingCount: 0,
    overdueCount: 0,
    pendingTasks: [] as TaskView[],
    loaded: false,
    listError: false,
    noFamily: false,
    familyId: '' as string,
  },

  /** 请求序号：用于丢弃过期（家庭切换 / 范围切换 / 慢网络）返回结果 */
  _reqSeq: 0,

  /** 家庭成员（用于范围选择器） */
  _members: [] as FamilyMember[],

  // 脏标记订阅句柄：页面可见期间订阅，隐藏时取消，避免误刷新与泄漏
  _dirtyUnsubscribe: null as (() => void) | null,

  onLoad(options: { familyId?: string }): void {
    const familyId = currentFamilyStore.value?.id || options.familyId || '';
    if (!familyId) {
      this.setData({ loaded: true, noFamily: true });
      return;
    }
    const scope = loadTasksScope(familyId, userStore.value?.id || '');
    this.setData({
      familyId,
      noFamily: false,
      scope,
      scopeLabel: this.labelForScope(scope),
    });
    this.loadMembers();
    this.loadTasks();
  },

  onShow(): void {
    this.getTabBar()?.setData({ selected: 2 });
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
    if (this.data.loaded && !this.data.noFamily) {
      // 已加载：仅当数据被标记变更（新建 / 编辑 / 删除 / 完成 / 恢复后返回）时才重新拉取
      if (consumeDirty('tasks')) {
        this.loadTasks();
      }
      return;
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
    const scope = loadTasksScope(familyId, userStore.value?.id || '');
    this._members = [];
    this.setData({
      familyId,
      noFamily: false,
      scope,
      scopeLabel: this.labelForScope(scope),
      scopeOptions: [],
      showScopeSheet: false,
    });
    this.loadMembers();
    this.loadTasks();
  },

  _subscribeDirty(): void {
    this._unsubscribeDirty();
    this._dirtyUnsubscribe = subscribe((domain) => {
      if (domain !== 'tasks') return;
      if (!this.data.loaded || this.data.noFamily) return;
      if (currentFamilyStore.value?.id !== this.data.familyId) return;
      consumeDirty('tasks');
      this.loadTasks();
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
      // 持久化的成员范围已不在家庭中：回落到「我的待办」
      const scope = this.data.scope;
      if (scope !== 'all' && scope !== 'me' && !members.some(m => m.userId === scope)) {
        this.onScopeFallbackToMe();
      } else {
        this.setData({ scopeLabel: this.labelForScope(scope) });
      }
    } catch (error) {
      // 成员列表加载失败不阻塞任务列表；打开选择器时会再尝试
      console.error('[Tasks] Load members failed:', error);
    }
  },

  onScopeFallbackToMe(): void {
    saveTasksScope(this.data.familyId, userStore.value?.id || '', 'me');
    this.setData({ scope: 'me', scopeLabel: this.labelForScope('me') });
    // 成员范围变化：通知首页「待办提醒」以新范围重新拉取
    markDirty('tasks');
    this.loadTasks();
  },

  buildScopeOptions(): void {
    const uid = userStore.value?.id || '';
    const user = userStore.value;
    const options: ScopeOption[] = [
      { key: 'all', label: '全家待办', avatarUrl: '', showAvatar: false },
      {
        key: 'me',
        label: '我的待办',
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

  labelForScope(scope: TasksScope): string {
    if (scope === 'all') return '全家待办';
    if (scope === 'me') return '我的待办';
    const member = this._members.find(m => m.userId === scope);
    return member ? `${member.displayName}的待办` : '家人待办';
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
    saveTasksScope(this.data.familyId, userStore.value?.id || '', key);
    this.setData({ scope: key, scopeLabel: this.labelForScope(key) });
    // 通知首页「待办提醒」与已完成子页以新范围重新拉取
    markDirty('tasks');
    this.loadTasks();
  },

  noop(): void {
    // 阻止弹层内容点击穿透 / 蒙层滚动穿透
  },

  /* ---------------- 数据加载 ---------------- */

  async loadTasks(): Promise<void> {
    const familyId = this.data.familyId;
    if (!familyId) return;
    const reqSeq = ++this._reqSeq;
    this.setData({ listError: false });
    try {
      const assigneeId = assigneeParamOf(this.data.scope);
      const tasks = await listTasks(familyId, {
        status: 'pending',
        includeNoDue: true,
        sort: 'due_asc',
        ...(assigneeId ? { assigneeId } : {}),
      });
      // 家庭已切换 / 存在更新的请求：丢弃过期结果，避免旧数据覆盖当前页面
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      const pendingTasks = this.mapTasks(tasks);
      this.setData({
        pendingTasks,
        pendingCount: pendingTasks.length,
        overdueCount: pendingTasks.filter(t => t.isOverdue).length,
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

  async onPullDownRefresh(): Promise<void> {
    if (this.data.noFamily) {
      wx.stopPullDownRefresh();
      return;
    }
    await Promise.all([this.loadTasks(), this.loadMembers()]);
    wx.stopPullDownRefresh();
  },

  mapTasks(tasks: Task[]): TaskView[] {
    // 「今天」边界跟随用户在「设置」中的时区偏好
    const viewingTimezone = getViewingTimeZone(currentFamilyStore.value?.timezone);
    const today = formatInstantInTimeZone(new Date().toISOString(), viewingTimezone).date;
    return tasks.map(t => {
      const isOverdue =
        t.status === 'pending' && !!t.dueDate && t.dueDate < today;
      const dueText = formatDueText(
        t.dueDate,
        t.status as 'pending' | 'completed',
        today,
      );
      const assigneeText = formatAssignees((t.assignees || []).map(a => a.displayName));
      return {
        id: t.id,
        name: t.name,
        status: t.status as 'pending' | 'completed',
        dueDate: t.dueDate,
        dueText,
        isOverdue,
        assigneeText,
        version: t.version,
        completing: false,
      };
    });
  },

  /* ---------------- 交互 ---------------- */

  async onToggleStatus(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const id = e.currentTarget.dataset.id as string;
    const familyId = this.data.familyId;
    const task = this.data.pendingTasks.find(t => t.id === id);
    if (!task || task.completing) return;

    // 乐观置为 loading
    this.setCompleting(id, true);

    try {
      await completeTask(familyId, id, task.version);
      // 家庭已切换：不再改动当前页面
      if (familyId !== this.data.familyId) return;
      showSuccess('已完成');
      // 从进行中列表移除，立即消除 loading
      const pendingTasks = this.data.pendingTasks.filter(t => t.id !== id);
      this.setData({
        pendingTasks,
        pendingCount: pendingTasks.length,
        overdueCount: pendingTasks.filter(t => t.isOverdue).length,
      });
      // 通知首页 / 已完成子页刷新
      markDirty('tasks');
    } catch (error: unknown) {
      if (familyId !== this.data.familyId) return;
      this.setCompleting(id, false);
      console.error('[Tasks] Complete failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError(getErrorMessage(err.code) || '内容已被其他家庭成员修改，请刷新后重试');
        this.loadTasks();
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '操作失败，请重试');
    }
  },

  setCompleting(id: string, completing: boolean): void {
    this.setData({
      pendingTasks: this.data.pendingTasks.map(t => (t.id === id ? { ...t, completing } : t)),
    });
  },

  onTaskTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/tasks/detail?id=${id}&familyId=${this.data.familyId}`,
    });
  },

  /** 进入已完成待办子页 */
  onViewCompleted(): void {
    if (!this.data.familyId) return;
    wx.navigateTo({
      url: `/pages/tasks/completed?familyId=${this.data.familyId}`,
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
function formatDueText(
  dueDateValue: string | null,
  status: 'pending' | 'completed',
  today: string,
): string {
  if (!dueDateValue) return '';
  const dueDate = new Date(`${dueDateValue}T00:00:00`);
  if (isNaN(dueDate.getTime())) return dueDateValue;

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
