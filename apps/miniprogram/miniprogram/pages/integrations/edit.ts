/**
 * 创建 / 编辑外部系统页
 *
 * - 创建（无 id）：填写名称、说明、权限 → 创建成功后进入详情页选择凭证类型。
 * - 编辑（有 id）：修改名称、说明、权限（状态在详情页调整）。
 *
 * 权限交互规则：
 * - 勾选 write 时自动勾选对应的 read；
 * - 取消 read 时自动取消对应的 write；
 * - 不展示成员管理、邀请管理、删除家庭等高危权限；
 * - 默认可以只读。
 */

import {
  createIntegration,
  getIntegration,
  updateIntegration,
} from '../../services/integrations';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  getErrorMessage,
} from '../../utils/index';
import {
  SystemPermission,
  CreateIntegrationRequest,
  UpdateIntegrationRequest,
} from '../../types/index';

Page({
  data: {
    familyId: '',
    integrationId: '',
    isEdit: false,
    loaded: false,
    submitting: false,

    name: '',
    description: '',

    // 权限勾选状态
    permFamilyRead: false,
    permEventsRead: true,
    permEventsWrite: false,
    permTasksRead: true,
    permTasksWrite: false,
  },

  onLoad(options: { familyId?: string; id?: string }): void {
    const familyId = options?.familyId;
    if (!familyId) {
      showError('缺少家庭参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    const integrationId = options?.id || '';
    this.setData({ familyId, integrationId, isEdit: Boolean(integrationId) });

    if (integrationId) {
      wx.setNavigationBarTitle({ title: '编辑外部系统' });
      this.loadDetail();
    } else {
      wx.setNavigationBarTitle({ title: '添加外部系统' });
      this.setData({ loaded: true });
    }
  },

  async loadDetail(): Promise<void> {
    try {
      const item = await getIntegration(this.data.familyId, this.data.integrationId);
      const p = item.permissions || [];
      this.setData({
        name: item.name,
        description: item.description || '',
        permFamilyRead: p.includes('family:read'),
        permEventsRead: p.includes('events:read'),
        permEventsWrite: p.includes('events:write'),
        permTasksRead: p.includes('tasks:read'),
        permTasksWrite: p.includes('tasks:write'),
        loaded: true,
      });
    } catch (error: unknown) {
      console.error('[IntegrationEdit] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
    }
  },

  onNameInput(e: WechatMiniprogram.Input): void {
    this.setData({ name: e.detail.value });
  },

  onDescInput(e: WechatMiniprogram.Input): void {
    this.setData({ description: e.detail.value });
  },

  /** 切换权限：处理 read/write 联动 */
  onTogglePerm(e: WechatMiniprogram.TouchEvent): void {
    const key = e.currentTarget.dataset.key as string;
    const patch: Record<string, boolean> = {};
    switch (key) {
      case 'familyRead':
        patch.permFamilyRead = !this.data.permFamilyRead;
        break;
      case 'eventsRead': {
        const next = !this.data.permEventsRead;
        patch.permEventsRead = next;
        if (!next) patch.permEventsWrite = false; // 取消 read 同时取消 write
        break;
      }
      case 'eventsWrite': {
        const next = !this.data.permEventsWrite;
        patch.permEventsWrite = next;
        if (next) patch.permEventsRead = true; // 勾选 write 自动勾选 read
        break;
      }
      case 'tasksRead': {
        const next = !this.data.permTasksRead;
        patch.permTasksRead = next;
        if (!next) patch.permTasksWrite = false;
        break;
      }
      case 'tasksWrite': {
        const next = !this.data.permTasksWrite;
        patch.permTasksWrite = next;
        if (next) patch.permTasksRead = true;
        break;
      }
      default:
        return;
    }
    this.setData(patch);
  },

  collectPermissions(): SystemPermission[] {
    const perms: SystemPermission[] = [];
    if (this.data.permFamilyRead) perms.push('family:read');
    if (this.data.permEventsRead) perms.push('events:read');
    if (this.data.permEventsWrite) perms.push('events:write');
    if (this.data.permTasksRead) perms.push('tasks:read');
    if (this.data.permTasksWrite) perms.push('tasks:write');
    return perms;
  },

  async onSubmit(): Promise<void> {
    if (this.data.submitting) return;

    const name = this.data.name.trim();
    if (!name) {
      showError('请填写系统名称');
      return;
    }
    const permissions = this.collectPermissions();
    if (permissions.length === 0) {
      showError('请至少选择一项权限');
      return;
    }

    this.setData({ submitting: true });
    showLoading(this.data.isEdit ? '保存中...' : '创建中...');
    const description = this.data.description.trim() || null;

    try {
      if (this.data.isEdit) {
        const payload: UpdateIntegrationRequest = { name, description, permissions };
        await updateIntegration(this.data.familyId, this.data.integrationId, payload);
        hideLoading();
        showSuccess('已保存');
        setTimeout(() => wx.navigateBack(), 800);
      } else {
        const payload: CreateIntegrationRequest = { name, description, permissions };
        const created = await createIntegration(this.data.familyId, payload);
        hideLoading();
        showSuccess('已创建');
        // 进入详情页选择并生成凭证；用 redirectTo 使返回直接回到列表
        setTimeout(() => {
          wx.redirectTo({
            url: `/pages/integrations/detail?familyId=${this.data.familyId}&id=${created.id}&created=1`,
          });
        }, 600);
      }
    } catch (error: unknown) {
      hideLoading();
      this.setData({ submitting: false });
      console.error('[IntegrationEdit] Submit failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    }
  },
});
