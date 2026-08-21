/**
 * 我的页面
 *
 * 展示：
 * - 用户头像和昵称
 * - 当前加入的家庭与家庭列表（切换 / 进入详情）
 * - 创建 / 加入家庭入口
 * - 关于家事喵
 */

import { userStore, familiesStore, currentFamilyStore, loadCurrentUser, loadFamilies, setCurrentFamily } from '../../stores/index';
import { showSuccess, showError, safeAvatarUrl } from '../../utils/index';
import { FamilyListItem } from '../../types/index';

Page({
  data: {
    userInfo: null as unknown as { id: string; displayName: string; avatarUrl: string | null; status: string } | null,
    families: [] as unknown as { id: string; name: string; avatarUrl: string | null; role: string; memberCount: number }[],
    currentFamily: null as unknown as { id: string; name: string; avatarUrl: string | null; role: string; memberCount: number } | null,
    loaded: false,
  },

  onShow(): void {
    this.getTabBar()?.setData({ selected: 3 });
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

  /** 设置 */
  onOpenSettings(): void {
    wx.navigateTo({
      url: '/pages/settings/settings',
    });
  },

  /** 关于与运行诊断 */
  onAbout(): void {
    wx.navigateTo({
      url: '/pages/about/about',
    });
  },
});
