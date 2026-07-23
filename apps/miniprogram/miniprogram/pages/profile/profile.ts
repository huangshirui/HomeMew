/**
 * 我的页面
 *
 * 展示：
 * - 用户头像和昵称
 * - 当前加入的家庭
 * - 创建/加入家庭入口
 * - 关于 HomeMew
 * - 退出登录
 */

import { userStore, familiesStore, currentFamilyStore, loadCurrentUser, loadFamilies } from '../../stores/index';
import { clearAuth } from '../../services/auth';
import { showConfirm, showSuccess, showError, safeAvatarUrl } from '../../utils/index';

Page({
  data: {
    userInfo: null as unknown as { id: string; displayName: string; avatarUrl: string | null; status: string } | null,
    families: [] as unknown as { id: string; name: string; avatarUrl: string | null; role: string; memberCount: number }[],
    currentFamily: null as unknown as { id: string; name: string; avatarUrl: string | null; role: string; memberCount: number } | null,
    loaded: false,
    isDev: false,
  },

  onShow(): void {
    // 检查是否开发版本
    const accountInfo = wx.getAccountInfoSync();
    this.setData({ isDev: accountInfo.miniProgram.envVersion === 'develop' });

    this.loadData();

    // 订阅状态变化
    this._userUnsubscribe = userStore.subscribe((user) => {
      this.setData({ userInfo: user });
    });
    this._familiesUnsubscribe = familiesStore.subscribe((families) => {
      this.setData({ families });
    });
    this._familyUnsubscribe = currentFamilyStore.subscribe((family) => {
      this.setData({ currentFamily: family });
    });
  },

  onHide(): void {
    if (this._userUnsubscribe) this._userUnsubscribe();
    if (this._familiesUnsubscribe) this._familiesUnsubscribe();
    if (this._familyUnsubscribe) this._familyUnsubscribe();
  },

  _userUnsubscribe: null as (() => void) | null,
  _familiesUnsubscribe: null as (() => void) | null,
  _familyUnsubscribe: null as (() => void) | null,

  async loadData(): Promise<void> {
    try {
      const [user, families] = await Promise.all([
        loadCurrentUser(),
        loadFamilies(),
      ]);

      this.setData({
        userInfo: user,
        families,
        currentFamily: currentFamilyStore.value,
        loaded: true,
      });

      // 同步 globalData
      const app = getApp<IAppOption>();
      if (app) {
        app.globalData.userInfo = user;
        app.globalData.families = families;
        app.globalData.currentFamily = currentFamilyStore.value;
      }
    } catch (e) {
      console.error('[Profile] Load data failed:', e);
      this.setData({ loaded: true });
    }
  },

  /** 编辑资料 */
  onEditProfile(): void {
    wx.navigateTo({
      url: '/pages/profile-setup/profile-setup?mode=edit',
    });
  },

  /** 创建家庭（跳转首页内联创建） */
  onCreateFamily(): void {
    wx.switchTab({
      url: '/pages/home/home',
    });
  },

  /** 加入家庭 */
  onJoinFamily(): void {
    wx.navigateTo({
      url: '/pages/family/join',
    });
  },

  /** 点击某个家庭，进入其详情 */
  onFamilyTap(e: WechatMiniprogram.TouchEvent): void {
    const familyId = e.currentTarget.dataset.id as string;
    if (!familyId) return;
    wx.navigateTo({
      url: `/pages/family/detail?familyId=${familyId}`,
    });
  },

  /** 关于 */
  onAbout(): void {
    wx.showModal({
      title: '关于家事喵',
      content: '家事喵 v0.1.0\n\n一个帮助家庭成员管理日程与待办的工具。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  /** 调试信息（仅开发版） */
  onDebugInfo(): void {
    const token = wx.getStorageSync('accessToken');
    const expiresAt = wx.getStorageSync('tokenExpiresAt');
    const familyId = wx.getStorageSync('currentFamilyId');

    wx.showModal({
      title: '调试信息',
      content: `Token: ${token ? token.substring(0, 20) + '...' : '无'}\n过期: ${expiresAt || '无'}\n当前家庭: ${familyId || '无'}`,
      showCancel: false,
      confirmText: '关闭',
    });
  },

  /** 退出登录 */
  async onLogout(): Promise<void> {
    const confirmed = await showConfirm('退出登录', '确定要退出登录吗？');
    if (!confirmed) return;

    clearAuth();
    showSuccess('已退出登录');

    // 回到启动页重新初始化
    setTimeout(() => {
      wx.reLaunch({
        url: '/pages/launch/launch',
      });
    }, 1500);
  },
});
