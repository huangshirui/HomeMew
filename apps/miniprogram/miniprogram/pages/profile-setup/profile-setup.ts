/**
 * 用户资料编辑页。
 *
 * 首次进入不会强制打开本页。新用户直接使用后端分配的“微信用户xxxxxx”
 * 昵称与客户端默认头像浏览产品；用户从“我的”主动进入本页后再修改资料。
 *
 * 用户可以使用微信头像按钮或从相册/相机选择图片。临时文件会直接上传到
 * HomeMew BFF / LifeSpace Identity，由 Identity 持久化并返回正式 avatarUrl。
 * 昵称保存时不能为空。
 */

import { updateCurrentUser } from '../../services/users';
import { uploadAvatar } from '../../services/media';
import { loadCurrentUser, userStore } from '../../stores/index';
import { showSuccess, showError, showLoading, hideLoading } from '../../utils/index';

Page({
  data: {
    displayName: '',
    avatarUrl: '',
    submitting: false,
    avatarUploading: false,
  },

  onLoad(): void {
    const current = userStore.value;
    if (current) {
      this.setData({
        displayName: current.displayName || '',
        avatarUrl: current.avatarUrl || '',
      });
      return;
    }

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
    const { displayName, submitting, avatarUploading } = this.data;

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

      setTimeout(() => {
        wx.navigateBack({
          delta: 1,
          fail: () => wx.switchTab({ url: '/pages/more/more' }),
        });
      }, 600);
    } catch (error: unknown) {
      hideLoading();
      console.error('[ProfileSetup] Save failed:', error);
      showError('保存失败，请重试');
    } finally {
      this.setData({ submitting: false });
    }
  },
});
