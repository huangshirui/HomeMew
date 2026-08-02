/**
 * 创建家庭页
 *
 * 支持：
 * - 选择家庭图片（可选）
 * - 输入家庭名称（必填）
 * - 创建成功后自动设为当前家庭并返回首页
 *
 * 创建接口仅接收名称，图片在创建成功后用家庭头像上传接口补充。
 */

import { createFamily } from '../../services/families';
import { uploadFamilyAvatar } from '../../services/media';
import { loadFamilies, setCurrentFamily } from '../../stores/index';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  getErrorMessage,
} from '../../utils/index';
import { CreateFamilyResult } from '../../types/index';

/** 创建家庭时使用的默认时区，与 Core 默认值一致。 */
const DEFAULT_TIMEZONE = 'Asia/Shanghai';

Page({
  data: {
    name: '',
    avatarUrl: '/assets/images/default-family.png',
    avatarTempPath: '' as string,
    submitting: false,
    timezoneValue: DEFAULT_TIMEZONE,
    preferredTimeZones: [DEFAULT_TIMEZONE],
  },

  onNameInput(e: WechatMiniprogram.Input): void {
    this.setData({ name: e.detail.value });
  },

  /** 时区选择组件回调：写入 IANA 时区 id */
  onTimezoneSelect(e: WechatMiniprogram.CustomEvent<{ value: string }>): void {
    const value = e.detail.value;
    if (!value) return;
    this.setData({ timezoneValue: value });
  },

  async onChooseAvatar(): Promise<void> {
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
      this.setData({ avatarUrl: tempFile.tempFilePath, avatarTempPath: tempFile.tempFilePath });
    } catch (error: unknown) {
      const err = error as { errMsg?: string };
      if (!String(err?.errMsg || '').includes('cancel')) {
        showError('选择图片失败，请重试');
      }
    }
  },

  async onCreate(): Promise<void> {
    if (this.data.submitting) return;
    const name = (this.data.name || '').trim();
    if (!name) {
      showError('请输入家庭名称');
      return;
    }

    this.setData({ submitting: true });
    showLoading('正在创建...');
    try {
      const created: CreateFamilyResult = await createFamily({ name, timezone: this.data.timezoneValue });

      // 若用户选择了图片，创建成功后补充上传家庭头像
      if (this.data.avatarTempPath) {
        try {
          const avatarUrl = await uploadFamilyAvatar(created.id, this.data.avatarTempPath);
          created.avatarUrl = avatarUrl;
        } catch (uploadErr: unknown) {
          // 头像上传失败不影响家庭创建，仅提示
          const err = uploadErr as { code?: string; message?: string };
          console.error('[CreateFamily] Avatar upload failed:', err);
        }
      }

      // 刷新家庭列表并设置当前家庭
      const families = await loadFamilies();
      const newFamily = families.find(f => f.id === created.id) || created;
      setCurrentFamily(newFamily);

      hideLoading();
      showSuccess('创建成功');
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/home' });
      }, 1000);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ submitting: false });
      console.error('[CreateFamily] Create failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message) || '创建失败，请重试');
    }
  },

  onCancel(): void {
    wx.navigateBack();
  },
});
