/**
 * 家庭详情页
 *
 * 展示：
 * - 家庭名称 / 头像 / 成员数 / 当前用户角色
 * - 成员入口、邀请入口、退出家庭入口
 *
 * 管理员可编辑家庭名称（PATCH /families/{id}，返回 FamilySummary）。
 * 不新增家庭头像上传能力。
 *
 * 唯一管理员退出失败时提示：请先将其他成员设为管理员，再退出家庭。
 */

import { getFamily, updateFamily, leaveFamily } from '../../services/families';
import { uploadFamilyAvatar } from '../../services/media';
import {
  loadFamilies,
  currentFamilyStore,
  setCurrentFamily,
  refreshFamilyState,
  updateFamilyAvatar,
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
    editingName: false,
    nameDraft: '',
    leaving: false,
    avatarUploading: false,
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
    // 从子页面（成员/邀请）返回时刷新角色与成员数
    if (this.data.familyId && this.data.detail) {
      this.loadDetail();
    }
  },

  async loadDetail(): Promise<void> {
    try {
      const detail = await getFamily(this.data.familyId);
      this.setData({ detail, nameDraft: detail.name, loaded: true });
    } catch (error: unknown) {
      console.error('[FamilyDetail] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
    }
  },

  get isAdmin(): boolean {
    return this.data.detail?.currentUserRole === 'admin';
  },

  onEditName(): void {
    if (!this.isAdmin) return;
    this.setData({ editingName: true, nameDraft: this.data.detail?.name || '' });
  },

  onNameInput(e: WechatMiniprogram.Input): void {
    this.setData({ nameDraft: e.detail.value });
  },

  onCancelEdit(): void {
    this.setData({ editingName: false, nameDraft: this.data.detail?.name || '' });
  },

  async onSaveName(): Promise<void> {
    const name = (this.data.nameDraft || '').trim();
    if (!name) {
      showError('请输入家庭名称');
      return;
    }
    showLoading('保存中...');
    try {
      const updated = await updateFamily(this.data.familyId, { name });
      // 同步当前家庭 store 的名称（保持角色不变）
      const current = currentFamilyStore.value;
      if (current && current.id === updated.id) {
        setCurrentFamily({ ...current, name: updated.name });
      }
      // 刷新家庭列表确保列表项名称一致
      await loadFamilies();
      this.setData({ editingName: false, detail: { ...this.data.detail!, name: updated.name } });
      showSuccess('已保存');
    } catch (error: unknown) {
      hideLoading();
      console.error('[FamilyDetail] Save name failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    }
  },

  onViewMembers(): void {
    wx.navigateTo({ url: `/pages/family/members?familyId=${this.data.familyId}` });
  },

  async onChooseFamilyAvatar(): Promise<void> {
    if (!this.isAdmin || this.data.avatarUploading) return;
    try {
      const res = await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult>((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          sizeType: ['compressed'],
          success: resolve,
          fail: reject,
        });
      });
      const tempFile = res.tempFiles && res.tempFiles[0];
      if (!tempFile?.tempFilePath) return;

      this.setData({ avatarUploading: true });
      const avatarUrl = await uploadFamilyAvatar(this.data.familyId, tempFile.tempFilePath);
      updateFamilyAvatar(this.data.familyId, avatarUrl);
      this.setData({ detail: { ...this.data.detail!, avatarUrl } });
      showSuccess('已更新');
    } catch (error: unknown) {
      const err = error as { errMsg?: string; code?: string; message?: string };
      const errMsg = String(err?.errMsg || '');
      if (!errMsg.includes('cancel')) {
        console.error('[FamilyDetail] Avatar upload failed:', error);
        showError(getErrorMessage(err.code, err.message) || '头像上传失败，请重试');
      }
    } finally {
      this.setData({ avatarUploading: false });
    }
  },

  onViewInvites(): void {
    wx.navigateTo({ url: `/pages/family/invites?familyId=${this.data.familyId}` });
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
