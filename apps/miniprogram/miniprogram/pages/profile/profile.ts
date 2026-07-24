/**
 * 我的页面
 *
 * 展示：
 * - 用户头像和昵称
 * - 当前加入的家庭与家庭列表（切换 / 进入详情）
 * - 创建 / 加入家庭入口
 * - 关于家事喵
 * - 调试信息（仅开发版）
 *
 * 微信小程序登录通常为静默恢复身份，因此不提供「退出登录」。
 * 需要重置本地登录状态时，使用开发版「调试信息」中的「清除本地登录状态」。
 */

import { userStore, familiesStore, currentFamilyStore, loadCurrentUser, loadFamilies, clearUserState } from '../../stores/index';
import { showConfirm, showSuccess, showError, safeAvatarUrl } from '../../utils/index';
import { FamilyListItem } from '../../types/index';

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

  /** 创建家庭（独立页面） */
  onCreateFamily(): void {
    wx.navigateTo({
      url: '/pages/family/create',
    });
  },

  /** 加入家庭 */
  onJoinFamily(): void {
    wx.navigateTo({
      url: '/pages/family/join',
    });
  },

  /** 点击某个家庭：设为当前家庭（切换） */
  onFamilyTap(e: WechatMiniprogram.TouchEvent): void {
    const familyId = e.currentTarget.dataset.id as string;
    if (!familyId) return;

    const current = this.data.currentFamily as { id: string } | null;
    if (current && current.id === familyId) {
      showSuccess('已在该家庭');
      return;
    }

    const target = (this.data.families as FamilyListItem[]).find(f => f.id === familyId);
    if (target) {
      setCurrentFamily(target);
      showSuccess(`已切换到 ${target.name}`);
    }
  },

  /** 点击「管理」：进入家庭详情 */
  onManageFamily(e: WechatMiniprogram.TouchEvent): void {
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

  /** 清除本地登录状态（仅开发版，用于重置身份） */
  async onClearLocalAuth(): Promise<void> {
    const confirmed = await showConfirm('清除本地登录状态', '将清除本地用户与家庭缓存并重新初始化，确定吗？');
    if (!confirmed) return;

    clearUserState();
    showSuccess('已清除');

    setTimeout(() => {
      wx.reLaunch({
        url: '/pages/launch/launch',
      });
    }, 1200);
  },
});
