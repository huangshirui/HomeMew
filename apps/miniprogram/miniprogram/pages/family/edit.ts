/**
 * 编辑家庭资料页
 *
 * 管理员可：
 * - 点击图片更换家庭头像（即时上传）
 * - 修改家庭名称并保存
 *
 * 保存成功后同步当前家庭与家庭列表 store，并返回详情页。
 */

import { getFamily, updateFamily } from '../../services/families';
import { uploadFamilyAvatar } from '../../services/media';
import {
  loadFamilies,
  currentFamilyStore,
  setCurrentFamily,
  updateFamilyAvatar,
} from '../../stores/index';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  getErrorMessage,
} from '../../utils/index';
import { FamilyDetail } from '../../types/index';

Page({
  data: {
    familyId: '',
    name: '',
    nameDraft: '',
    avatarUrl: '/assets/images/default-family.png',
    avatarTempPath: '' as string,
    uploading: false,
    saving: false,
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

  async loadDetail(): Promise<void> {
    try {
      const detail: FamilyDetail = await getFamily(this.data.familyId);
      this.setData({
        name: detail.name,
        nameDraft: detail.name,
        avatarUrl: detail.avatarUrl || '/assets/images/default-family.png',
        loaded: true,
      });
    } catch (error: unknown) {
      console.error('[EditFamily] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
    }
  },

  onNameInput(e: WechatMiniprogram.Input): void {
    this.setData({ nameDraft: e.detail.value });
  },

  async onChooseAvatar(): Promise<void> {
    if (this.data.uploading) return;
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

      this.setData({ uploading: true, avatarUrl: tempFile.tempFilePath, avatarTempPath: tempFile.tempFilePath });
      const avatarUrl = await uploadFamilyAvatar(this.data.familyId, tempFile.tempFilePath);
      this.setData({ avatarUrl, avatarTempPath: '' });
      updateFamilyAvatar(this.data.familyId, avatarUrl);
      showSuccess('已更新图片');
    } catch (error: unknown) {
      const err = error as { errMsg?: string; code?: string; message?: string };
      const errMsg = String(err?.errMsg || '');
      if (!errMsg.includes('cancel')) {
        console.error('[EditFamily] Avatar upload failed:', error);
        showError(getErrorMessage(err.code, err.message) || '头像上传失败，请重试');
      }
    } finally {
      this.setData({ uploading: false });
    }
  },

  async onSave(): Promise<void> {
    if (this.data.saving) return;
    const name = (this.data.nameDraft || '').trim();
    if (!name) {
      showError('请输入家庭名称');
      return;
    }

    this.setData({ saving: true });
    showLoading('保存中...');
    try {
      let updatedName = this.data.name;
      if (name !== this.data.name) {
        await updateFamily(this.data.familyId, { name });
        updatedName = name;
      }

      // 同步当前家庭 store 的名称（保持角色不变）
      const current = currentFamilyStore.value;
      if (current && current.id === this.data.familyId) {
        setCurrentFamily({ ...current, name: updatedName });
      }
      // 刷新家庭列表确保列表项名称一致
      await loadFamilies();

      hideLoading();
      this.setData({ name: updatedName, saving: false });
      showSuccess('已保存');
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ saving: false });
      console.error('[EditFamily] Save failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message) || '保存失败，请重试');
    }
  },
});
