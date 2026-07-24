/**
 * 外部系统列表页
 *
 * 仅家庭管理员可进入（Core 再次校验 admin）。
 * 展示已接入的外部系统：名称、状态、权限摘要、最近使用时间。
 * 支持进入详情、添加外部系统。
 */

import { listIntegrations } from '../../services/integrations';
import {
  showError,
  getErrorMessage,
  formatDate,
  timeAgo,
  summarizePermissions,
} from '../../utils/index';
import { Integration } from '../../types/index';

type IntegrationView = Integration & {
  statusText: string;
  permissionSummary: string;
  lastUsedText: string;
};

const STATUS_TEXT: Record<string, string> = {
  active: '已启用',
  disabled: '已停用',
  deleted: '已删除',
};

Page({
  data: {
    familyId: '',
    integrations: [] as IntegrationView[],
    loaded: false,
  },

  onLoad(options: { familyId?: string }): void {
    const familyId = options?.familyId;
    if (!familyId) {
      showError('缺少家庭参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ familyId });
    this.loadList();
  },

  onShow(): void {
    // 从创建 / 详情返回时刷新
    if (this.data.familyId && this.data.loaded) {
      this.loadList();
    }
  },

  mapView(list: Integration[]): IntegrationView[] {
    return list.map(item => ({
      ...item,
      statusText: STATUS_TEXT[item.status] || item.status,
      permissionSummary: summarizePermissions(item.permissions),
      lastUsedText: item.lastUsedAt
        ? `最近使用 ${formatDate(item.lastUsedAt, 'datetime')} · ${timeAgo(item.lastUsedAt)}`
        : '尚未使用',
    }));
  },

  async loadList(): Promise<void> {
    try {
      const list = await listIntegrations(this.data.familyId);
      this.setData({ integrations: this.mapView(list), loaded: true });
    } catch (error: unknown) {
      console.error('[Integrations] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
    }
  },

  onTapItem(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/integrations/detail?familyId=${this.data.familyId}&id=${id}`,
    });
  },

  onCreate(): void {
    wx.navigateTo({
      url: `/pages/integrations/edit?familyId=${this.data.familyId}`,
    });
  },
});
