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
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
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

/**
 * 后台轮询间隔（毫秒）：页面可见期间每 60 秒重新拉取一次待办，
 * 让其他家庭成员的新增 / 完成 / 删除在无需用户操作时也能自动出现。
 * 页面隐藏时停止，不消耗流量。
 */
const POLL_INTERVAL_MS = 60 * 1000;

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

    /** 下拉刷新指示器状态（scroll-view refresher） */
    refreshing: false,
  },

  /** 请求序号：用于丢弃过期（家庭切换 / 范围切换 / 慢网络）返回结果 */
  _reqSeq: 0,
  /** 缓存 onLoad 入参，供初始化失败后重试复用 */
  _initOptions: null as { familyId?: string } | null,

  /** 家庭成员（用于范围选择器） */
  _members: [] as FamilyMember[],

  // 脏标记订阅句柄：页面可见期间订阅，隐藏时取消，避免误刷新与泄漏
  _dirtyUnsubscribe: null as (() => void) | null,

  /** 后台轮询定时器（页面可见期间才运行，拉取其他成员的变更） */
  _pollTimer: null as ReturnType<typeof setInterval> | null,
  /** 上次真正发起后台拉取的时间戳，用于轮询节流 */
  _lastFetchAt: 0,

  async onLoad(options: { familyId?: string }): Promise<void> {
    this._initOptions = options;
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[Tasks] Runtime bootstrap failed:', error);
      this.setData({ loaded: true, listError: true });
      return;
    }
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
    this._startPoll();
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
    this._stopPoll();
  },

  onUnload(): void {
    this._unsubscribeDirty();
    this._stopPoll();
  },

  /**
   * 启动后台轮询：页面可见期间每 60 秒重新拉取一次待办列表。
   *
   * 注意：
   * - 只在 onShow 启动、onHide / onUnload 停止；
   * - 通过 _lastFetchAt 节流，刚拉过（onShow / 下拉刷新 / 脏标记 / 切范围）就跳过本轮；
   * - 每轮以 currentFamilyStore 为准校验家庭，家庭切换时交给 onShow 的
   *   resetForFamily 处理，轮询自身不会用旧 familyId 发请求；
   * - loadTasks 内部的 _reqSeq + familyId 校验会丢弃过期响应，不会串数据。
   */
  _startPoll(): void {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  },

  _stopPoll(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  _poll(): void {
    if (!this.data.loaded || this.data.noFamily) return;
    const familyId = currentFamilyStore.value?.id || '';
    // 家庭已切换但页面尚未重置：本轮不请求，等 onShow / resetForFamily 接管
    if (!familyId || familyId !== this.data.familyId) return;
    if (Date.now() - this._lastFetchAt < POLL_INTERVAL_MS) return;
    this.loadTasks();
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
      { key: 'all', label: '全家', avatarUrl: '', showAvatar: false },
      {
        key: 'me',
        label: '我的',
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
    if (scope === 'all') return '全家';
    if (scope === 'me') return '我的';
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
    // 记录拉取时间：任何来源（首屏 / 下拉 / 脏标记 / 切范围 / 轮询）都刷新节流窗口
    this._lastFetchAt = Date.now();
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
    // 既覆盖首屏数据加载失败，也覆盖运行时初始化失败：重新走完整 onLoad
    this.onLoad(this._initOptions || {});
  },

  /** 下拉刷新：仅内容区下拉（nav-bar 固定），重新拉取待办与成员 */
  onRefresh(): void {
    if (this.data.noFamily) {
      this.setData({ refreshing: false });
      return;
    }
    this.setData({ refreshing: true });
    Promise.all([this.loadTasks(), this.loadMembers()])
      .then(() => this.setData({ refreshing: false }))
      .catch(() => this.setData({ refreshing: false }));
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
