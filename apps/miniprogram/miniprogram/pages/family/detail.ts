/**
 * 家庭详情页
 *
 * 展示：
 * - 家庭大图 / 名称 / 成员数 / 当前用户角色
 * - 管理员显示「编辑家庭资料」入口
 *
 * 管理分组：
 * - 家庭成员（右侧展示人数）
 * - 邀请家人加入（仅管理员）
 * - 退出家庭（危险操作）
 *
 * 编辑名称与图片统一在独立「编辑家庭资料」页完成。
 * 唯一管理员退出失败时提示：请先将其他成员设为管理员，再退出家庭。
 */

import { getFamily, leaveFamily } from '../../services/families';
import {
  loadFamilies,
  currentFamilyStore,
  setCurrentFamily,
  refreshFamilyState,
} from '../../stores/index';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  showConfirm,
  getErrorMessage,
} from '../../utils/index';
import { FamilyDetail } from '../../types/index';

Page({
  data: {
    familyId: '',
    detail: null as FamilyDetail | null,
    leaving: false,
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
    this.loadDetail();
  },

  onShow(): void {
    // 从子页面（成员 / 邀请 / 编辑）返回时刷新角色与成员数
    if (this.data.familyId && this.data.detail) {
      this.loadDetail();
    }
  },

  async loadDetail(): Promise<void> {
    try {
      const detail = await getFamily(this.data.familyId);
      this.setData({ detail, loaded: true });
    } catch (error: unknown) {
      console.error('[FamilyDetail] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
    }
  },

  /** 当前用户是否为该家庭管理员 */
  isAdmin(): boolean {
    return this.data.detail?.currentUserRole === 'admin';
  },

  /** 编辑家庭资料（独立页面，管理员） */
  onEditProfile(): void {
    if (!this.isAdmin()) return;
    wx.navigateTo({
      url: `/pages/family/edit?familyId=${this.data.familyId}`,
    });
  },

  onViewMembers(): void {
    wx.navigateTo({ url: `/pages/family/members?familyId=${this.data.familyId}` });
  },

  onViewInvites(): void {
    wx.navigateTo({ url: `/pages/family/invites?familyId=${this.data.familyId}` });
  },

  /** 外部系统管理（仅管理员） */
  onViewIntegrations(): void {
    if (!this.isAdmin()) return;
    wx.navigateTo({ url: `/pages/integrations/list?familyId=${this.data.familyId}` });
  },

  async onLeave(): Promise<void> {
    if (this.data.leaving) return;
    const confirmed = await showConfirm('退出家庭', '确定要退出该家庭吗？');
    if (!confirmed) return;

    this.setData({ leaving: true });
    showLoading('退出中...');
    try {
      await leaveFamily(this.data.familyId);
      hideLoading();

      const families = await loadFamilies();
      refreshFamilyState(families);
      showSuccess('已退出家庭');
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/home' });
      }, 1200);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ leaving: false });
      console.error('[FamilyDetail] Leave failed:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'LAST_ADMIN_CANNOT_BE_REMOVED') {
        showError('请先将其他成员设为管理员，再退出家庭');
        return;
      }
      showError(getErrorMessage(err.code, err.message));
    }
  },
});
