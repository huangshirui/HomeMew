import { AppError } from '../../services/api';
import { confirmWebAccessLink, normalizeAccessLinkChallengeId } from '../../services/account-link';

Page({
  data: {
    challengeId: '',
    submitting: false,
  },

  onChallengeInput(event: WechatMiniprogram.Input): void {
    this.setData({ challengeId: event.detail.value });
  },

  pasteChallenge(): void {
    wx.getClipboardData({
      success: (result) => {
        this.setData({ challengeId: (result.data || '').trim() });
      },
      fail: () => {
        wx.showToast({ title: '无法读取剪贴板', icon: 'none' });
      },
    });
  },

  async confirmLink(): Promise<void> {
    if (this.data.submitting) return;

    let challengeId: string;
    try {
      challengeId = normalizeAccessLinkChallengeId(this.data.challengeId);
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '关联码格式不正确',
        icon: 'none',
      });
      return;
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '确认关联 Web 登录？',
        content: '确认后，这次 Web 登录将使用你当前的小程序账号、家庭和数据。',
        confirmText: '确认关联',
        success: (result) => resolve(result.confirm),
        fail: () => resolve(false),
      });
    });
    if (!confirmed) return;

    this.setData({ submitting: true });
    try {
      await confirmWebAccessLink(challengeId);
      wx.showToast({ title: '关联成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error) {
      const appError = error as AppError;
      let message = appError?.message || '关联失败，请稍后重试';
      if (appError?.code === 'ACCESS_LINK_CHALLENGE_INVALID') {
        message = '关联码已失效，请在 Web 重新生成';
      }
      wx.showModal({
        title: '关联失败',
        content: appError?.requestId ? `${message}\nRequest ID: ${appError.requestId}` : message,
        showCancel: false,
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
