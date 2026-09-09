/**
 * 待办任务创建/编辑页
 *
 * 创建与编辑共用同一页面：
 * - 通过 ?id= 是否存在判断模式
 * - 任务名称：必填
 * - 描述：可选
 * - 截止日期：可选，只到天（按 SPEC 10.3）
 * - 负责人：可多选，从当前家庭成员列表中选择
 *
 * 遵循 SPEC 10.3、10.5。
 */

import { getTask, createTask, updateTask } from '../../services/tasks';
import { listFamilyMembers } from '../../services/families';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  getErrorMessage,
  isVersionConflict,
} from '../../utils/index';
import { Task, FamilyMember, CreateTaskRequest, UpdateTaskRequest, TaskCreationDraft } from '../../types/index';
import { markDirty } from '../../stores/dirty';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { consumePendingDraft } from '../../stores/draft-buffer';

type MemberOption = {
  userId: string;
  displayName: string;
  avatarUrl: string;
  selected: boolean;
};

type Mode = 'create' | 'edit';

Page({
  data: {
    mode: 'create' as Mode,
    familyId: '',
    taskId: '',
    version: 0,
    loaded: false,
    loadError: false,
    submitting: false,
    members: [] as MemberOption[],
    name: '',
    description: '',
    dueDate: '',
    /** 视图用派生 */
    dueText: '请选择截止日期',
    /** picker 最小日期 */
    minDate: '',
    /** 月历弹层显隐 */
    showCalendar: false,
  },

  async onLoad(options: { familyId?: string; id?: string }): Promise<void> {
    const familyId = options?.familyId;
    if (!familyId) {
      showError('缺少家庭参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    // 补全运行时上下文（用户/家庭/时区），失败也不阻塞编辑页加载（请求层会自动登录）
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[TaskEdit] Runtime bootstrap failed:', error);
    }
    const today = formatYmd(new Date());
    this.setData({
      familyId,
      mode: options?.id ? 'edit' : 'create',
      taskId: options?.id || '',
      minDate: today,
      dueText: '请选择截止日期（选填）',
    });
    wx.setNavigationBarTitle({
      title: options?.id ? '编辑待办' : '添加待办',
    });
    if (options?.id) {
      this.loadTask();
    } else {
      this.loadMembersAndInit();
    }
  },

  onRetryLoad(): void {
    if (this.data.mode === 'edit') {
      this.loadTask();
    } else {
      this.loadMembersAndInit();
    }
  },

  async loadTask(): Promise<void> {
    showLoading('加载任务中...');
    this.setData({ loadError: false });
    try {
      const [task, members] = await Promise.all([
        getTask(this.data.familyId, this.data.taskId),
        listFamilyMembers(this.data.familyId),
      ]);
      hideLoading();
      this.applyTask(task, members);
    } catch (error: unknown) {
      hideLoading();
      console.error('[TaskEdit] Load task failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadError: true });
      showError(getErrorMessage(err.code, err.message) || '任务加载失败');
    }
  },

  async loadMembersAndInit(): Promise<void> {
    showLoading('加载成员中...');
    this.setData({ loadError: false });
    try {
      const members = await listFamilyMembers(this.data.familyId);
      hideLoading();
      this.setData({
        members: members.map(m => ({
          userId: m.userId,
          displayName: m.displayName,
          avatarUrl: m.avatarUrl || '/assets/images/default-avatar.png',
          selected: false,
        })),
        loaded: true,
      });
      this.refreshDerived();
      this.applyConsumedDraft();
    } catch (error: unknown) {
      hideLoading();
      console.error('[TaskEdit] Load members failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadError: true });
      showError(getErrorMessage(err.code, err.message) || '成员加载失败');
    }
  },

  /** 喵一下：消费草稿后预填待办字段（创建模式、成员加载完成后调用） */
  applyConsumedDraft(): void {
    if (this.data.mode !== 'create') return;
    const draft = consumePendingDraft('task');
    if (!draft || draft.status !== 'ready' || draft.kind !== 'task') return;
    const d = (draft as TaskCreationDraft).draft;
    const patch: Record<string, unknown> = {};
    if (d.name != null) patch.name = d.name;
    if (d.description != null) patch.description = d.description;
    if (d.dueDate != null) patch.dueDate = d.dueDate;
    if (d.assigneeIds && d.assigneeIds.length) {
      patch.members = this.data.members.map((m) => ({
        ...m,
        selected: d.assigneeIds.includes(m.userId),
      }));
    }
    this.setData(patch);
    this.refreshDerived();
  },

  applyTask(task: Task, members: FamilyMember[]): void {
    const selectedIds = new Set(task.assignees.map(a => a.userId));
    this.setData({
      name: task.name,
      description: task.description || '',
      dueDate: task.dueDate || '',
      version: task.version,
      members: members.map(m => ({
        userId: m.userId,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl || '/assets/images/default-avatar.png',
        selected: selectedIds.has(m.userId),
      })),
      loaded: true,
    });
    this.refreshDerived();
  },

  /* ----------------- 表单输入 ----------------- */

  onNameInput(e: WechatMiniprogram.Input): void {
    this.setData({ name: e.detail.value });
  },

  onDescriptionInput(e: WechatMiniprogram.Input): void {
    this.setData({ description: e.detail.value });
  },

  onOpenCalendar(): void {
    this.setData({ showCalendar: true });
  },

  onCloseCalendar(): void {
    this.setData({ showCalendar: false });
  },

  onCalendarSelect(e: WechatMiniprogram.CustomEvent): void {
    const date = e.detail.date as string;
    if (!date) return;
    this.setData({ dueDate: date, showCalendar: false });
    this.refreshDerived();
  },

  onClearDue(): void {
    this.setData({ dueDate: '' });
    this.refreshDerived();
  },

  onMemberToggle(e: WechatMiniprogram.TouchEvent): void {
    const userId = e.currentTarget.dataset.id as string;
    const members = this.data.members.map(m =>
      m.userId === userId ? { ...m, selected: !m.selected } : m,
    );
    this.setData({ members });
  },

  onSelectAll(): void {
    const allSelected = this.data.members.length > 0 && this.data.members.every(m => m.selected);
    const members = this.data.members.map(m => ({ ...m, selected: !allSelected }));
    this.setData({ members });
  },

  /* ----------------- 派生展示文本 ----------------- */

  refreshDerived(): void {
    const { dueDate } = this.data;
    let dueText = '请选择截止日期（选填）';
    if (dueDate) {
      dueText = dueDate;
    }
    this.setData({ dueText });
  },

  /* ----------------- 提交 ----------------- */

  async onSubmit(): Promise<void> {
    if (this.data.submitting) return;

    const name = (this.data.name || '').trim();
    if (!name) {
      showError('请输入任务名称');
      return;
    }

    const assigneeIds = this.data.members.filter(m => m.selected).map(m => m.userId);

    const payload: CreateTaskRequest = {
      name,
      description: this.data.description.trim() || null,
      dueDate: this.data.dueDate || null,
      assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
    };

    this.setData({ submitting: true });
    showLoading(this.data.mode === 'edit' ? '保存中...' : '创建中...');
    try {
      if (this.data.mode === 'edit') {
        const updatePayload: UpdateTaskRequest = { ...payload, version: this.data.version };
        await updateTask(this.data.familyId, this.data.taskId, updatePayload);
      } else {
        await createTask(this.data.familyId, payload);
      }
      hideLoading();
      showSuccess(this.data.mode === 'edit' ? '已保存' : '已创建');
      markDirty('tasks');
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ submitting: false });
      console.error('[TaskEdit] Submit failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError('该任务已被其他成员修改，请重新进入编辑');
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '保存失败，请重试');
    }
  },

  onCancel(): void {
    wx.navigateBack();
  },
});

/* ----------------- 工具函数 ----------------- */

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
