/**
 * 首次资料设置 / 编辑资料页
 *
 * 用户可二选一地设置昵称与头像：
 * - 直接使用微信昵称与头像（input type=nickname / open-type=chooseAvatar）
 * - 手工录入昵称，或从相册/拍照选择头像
 *
 * 选择的头像会先上传到微信云存储，得到可长期访问的 cloud:// 文件 ID 再保存，
 * 避免把本地临时路径写入 Core 导致换设备后头像失效。
 */

import { updateCurrentUser } from '../../services/users';
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

    // 编辑模式下，预填当前用户资料
    if (isEditMode) {
      const current = userStore.value;
      if (current) {
        this.setData({
          displayName: current.displayName || '',
          avatarUrl: current.avatarUrl || '',
        });
      } else {
        loadCurrentUser()
          .then((u) => {
            if (u) {
              this.setData({
                displayName: u.displayName || '',
                avatarUrl: u.avatarUrl || '',
              });
            }
          })
          .catch(() => {
            /* 预填失败不阻断页面 */
          });
      }
    }
  },

  /** 输入昵称（支持手工录入，也可点键盘上的「微信」直接填入微信昵称） */
  onDisplayNameInput(e: WechatMiniprogram.Input): void {
    this.setData({ displayName: e.detail.value });
  },

  /** 选择微信头像（open-type=chooseAvatar） */
  async onChooseAvatar(e: WechatMiniprogram.CustomEvent): Promise<void> {
    const { avatarUrl } = e.detail;
    if (!avatarUrl) return;
    await this.uploadAndSet(avatarUrl);
  },

  /** 从相册 / 拍照选择头像（手工选择） */
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
      if (tempFile && tempFile.tempFilePath) {
        await this.uploadAndSet(tempFile.tempFilePath);
      }
    } catch (err) {
      // 用户主动取消选择时不提示
      const errMsg = String((err as { errMsg?: string })?.errMsg || '');
      if (!errMsg.includes('cancel')) {
        showError('选择图片失败');
      }
    }
  },

  /** 上传本地头像文件并设置为当前头像 */
  async uploadAndSet(tempFilePath: string): Promise<void> {
    if (this.data.avatarUploading) return;
    this.setData({ avatarUploading: true });
    try {
      const fileID = await uploadAvatar(tempFilePath);
      this.setData({ avatarUrl: fileID });
    } catch (err) {
      console.error('[ProfileSetup] Avatar upload failed:', err);
      showError('头像上传失败，请重试');
    } finally {
      this.setData({ avatarUploading: false });
    }
  },

  /** 提交资料 */
  async onSubmit(): Promise<void> {
    const { displayName, avatarUrl, submitting, isEditMode } = this.data;

    if (submitting) return;

    // 校验
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
        avatarUrl: avatarUrl || null,
      });

      // 编辑模式下刷新全局用户状态，确保「我的」页面同步更新
      if (isEditMode) {
        await loadCurrentUser().catch(() => undefined);
      }

      hideLoading();
      showSuccess('设置成功');

      if (isEditMode) {
        setTimeout(() => {
          wx.navigateBack();
        }, 1200);
      } else {
        // 跳转到首页（TabBar 页面）
        setTimeout(() => {
          wx.switchTab({
            url: '/pages/home/home',
          });
        }, 1500);
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
