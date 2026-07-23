/**
 * 账号禁用页
 *
 * 展示账号不可用，提供「重新登录」入口。
 * 重新登录后会回到启动页重新初始化；若仍被禁用，启动页会再次跳转回本页，
 * 不会产生自动无限循环（每次都需要用户主动点击重新登录）。
 */

import { clearAuth } from '../../services/auth';

Page({
  data: {
    retrying: false,
  },

  onLoad(): void {
    // 进入本页即视为处于禁用态，确保本地登录信息已被清除
    clearAuth();
  },

  async onRelogin(): Promise<void> {
    if (this.data.retrying) return;
    this.setData({ retrying: true });
    try {
      clearAuth();
      wx.reLaunch({
        url: '/pages/launch/launch',
      });
    } catch (e) {
      this.setData({ retrying: false });
    }
  },
});
