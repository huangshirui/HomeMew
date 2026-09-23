/**
 * 首次资料设置 / 编辑资料页。
 *
 * 用户可以使用微信头像按钮或从相册/相机选择图片。临时文件会直接上传到
 * HomeMew Core，由 Core 持久化到 R2 并返回正式 avatarUrl。资料保存接口只
 * 更新昵称，不再提交头像路径或任意 URL。
 */

import { updateCurrentUser } from '../../services/users';
import { markNewUserOnboardingComplete } from '../../services/auth';
import { resumePendingEntry } from '../../services/entry-navigation';
import { uploadAvatar } from '../../services/media';
import { loadCurrentUser, userStore } from '../../stores/index';
import { showSuccess, showError, showLoading, hideLoading } from '../../utils/index';

Page({
  data: {
    displayName: '',
    avatarUrl: '',
    isEditMode: false,
    submitting: false,
    avatarUploading: false,
  },

  onLoad(options: { mode?: string }): void {
    const isEditMode = options?.mode === 'edit';
    this.setData({ isEditMode });

    if (isEditMode) {
      const current = userStore.value;
      if (current) {
        this.setData({
          displayName: current.displayName || '',
          avatarUrl: current.avatarUrl || '',
        });
      } else {
        loadCurrentUser()
          .then((user) => {
            if (user) {
              this.setData({
                displayName: user.displayName || '',
                avatarUrl: user.avatarUrl || '',
              });
            }
          })
          .catch(() => {
            /* 预填失败不阻断页面 */
          });
      }
    }
  },

  onDisplayNameInput(e: WechatMiniprogram.Input): void {
    this.setData({ displayName: e.detail.value });
  },

  onNicknameReview(e: WechatMiniprogram.CustomEvent): void {
    const { nickname, pass } = e.detail;
    if (pass && nickname) {
      this.setData({ displayName: nickname });
    }
  },

  async onChooseAvatar(e: WechatMiniprogram.CustomEvent): Promise<void> {
    const { avatarUrl } = e.detail;
    if (!avatarUrl) return;
    await this.uploadAndSet(avatarUrl);
  },

  async onChooseFromAlbum(): Promise<void> {
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
      if (tempFile?.tempFilePath) {
        await this.uploadAndSet(tempFile.tempFilePath);
      }
    } catch (err) {
      const errMsg = String((err as { errMsg?: string })?.errMsg || '');
      if (!errMsg.includes('cancel')) {
        showError('选择图片失败');
      }
    }
  },

  async uploadAndSet(tempFilePath: string): Promise<void> {
    if (this.data.avatarUploading) return;
    this.setData({ avatarUploading: true });
    try {
      const avatarUrl = await uploadAvatar(tempFilePath);
      this.setData({ avatarUrl });
      await loadCurrentUser().catch(() => undefined);
    } catch (err) {
      console.error('[ProfileSetup] Avatar upload failed:', err);
      showError((err as Error)?.message || '头像上传失败，请重试');
    } finally {
      this.setData({ avatarUploading: false });
    }
  },

  async onSubmit(): Promise<void> {
    const { displayName, submitting, isEditMode, avatarUploading } = this.data;

    if (submitting || avatarUploading) return;

    if (!displayName.trim()) {
      showError('请输入昵称');
      return;
    }

    if (displayName.trim().length > 20) {
      showError('昵称不能超过 20 个字');
      return;
    }

    this.setData({ submitting: true });
    showLoading('正在保存...');

    try {
      await updateCurrentUser({
        displayName: displayName.trim(),
      });

      await loadCurrentUser().catch(() => undefined);
      hideLoading();
      showSuccess('设置成功');

      if (isEditMode) {
        setTimeout(() => {
          wx.navigateBack();
        }, 1200);
      } else {
        markNewUserOnboardingComplete();
        setTimeout(() => {
          resumePendingEntry();
        }, 600);
      }
    } catch (error: unknown) {
      hideLoading();
      console.error('[ProfileSetup] Save failed:', error);
      showError('保存失败，请重试');
    } finally {
      this.setData({ submitting: false });
    }
  },
});
