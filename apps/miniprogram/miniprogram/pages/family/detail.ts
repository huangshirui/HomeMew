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
 * - 普通成员 / 管理员：退出家庭
 * - Space Owner：注销家庭（危险操作）
 *
 * 高级外部系统接入统一在 HomeMew Web 管理，小程序不提供凭据或集成配置能力。
 * 编辑名称与图片统一在独立「编辑家庭资料」页完成。
 * 注销家庭直接调用 LifeSpace Space close；HomeMew 不自行删除家庭数据或清理授权关系。
 */

import { closeFamily, getFamily, isFamilyOwner, leaveFamily } from '../../services/families';
import {
  loadFamilies,
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
    isOwner: false,
    leaving: false,
    closing: false,
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
    // 从子页面（成员 / 邀请 / 编辑）返回时刷新角色、Owner 身份与成员数
    if (this.data.familyId && this.data.detail) {
      this.loadDetail();
    }
  },

  async loadDetail(): Promise<void> {
    try {
      const [detail, isOwner] = await Promise.all([
        getFamily(this.data.familyId),
        isFamilyOwner(this.data.familyId),
      ]);
      this.setData({ detail, isOwner, loaded: true });
    } catch (error: unknown) {
      console.error('[FamilyDetail] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
    }
  },

  /** 当前用户是否为该家庭管理员（包含 owner） */
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

  async onLeave(): Promise<void> {
    if (this.data.leaving || this.data.isOwner) return;
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
      if (err.code === 'LAST_SPACE_MANAGER') {
        showError('请先保留另一位家庭管理员，再退出家庭');
        return;
      }
      showError(getErrorMessage(err.code, err.message));
    }
  },

  async onClose(): Promise<void> {
    if (this.data.closing || !this.data.isOwner) return;
    const detail = this.data.detail;
    const firstConfirmed = await showConfirm(
      '注销家庭',
      '注销后，所有家庭成员和外部系统将立即失去访问权限。家庭数据不会立即物理删除，当前版本也不支持自行恢复。确定继续吗？',
    );
    if (!firstConfirmed) return;

    const secondConfirmed = await showConfirm(
      '再次确认',
      `确定注销「${detail?.name ?? '当前家庭'}」吗？`,
    );
    if (!secondConfirmed) return;

    this.setData({ closing: true });
    showLoading('注销中...');
    try {
      await closeFamily(this.data.familyId);
      hideLoading();

      const families = await loadFamilies();
      refreshFamilyState(families);
      showSuccess('家庭已注销');
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/home' });
      }, 1200);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ closing: false });
      console.error('[FamilyDetail] Close failed:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'SPACE_OWNER_REQUIRED') {
        showError('只有家庭所有者可以注销家庭');
        await this.loadDetail();
        return;
      }
      if (err.code === 'SPACE_VERSION_CONFLICT') {
        showError('家庭资料已更新，请刷新后重试');
        await this.loadDetail();
        return;
      }
      showError(getErrorMessage(err.code, err.message));
    }
  },
});
