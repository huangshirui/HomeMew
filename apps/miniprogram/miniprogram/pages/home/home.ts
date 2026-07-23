/**
 * 首页
 *
 * 展示当前家庭并支持：
 * - 当前家庭名称 / 人数 / 当前角色
 * - 多家庭切换
 * - 无家庭空状态
 * - 创建家庭（内联输入名称）
 * - 加入家庭
 * - 进入家庭详情
 *
 * 日程与待办编辑入口暂未实现，点击提示「功能即将上线」。
 * 当前家庭状态统一来自 familiesStore / currentFamilyStore。
 */

import { currentFamilyStore, familiesStore, loadFamilies, setCurrentFamily } from '../../stores/index';
import { createFamily } from '../../services/families';
import { showConfirm, showSuccess, showError, showLoading, hideLoading } from '../../utils/index';

type FamilyView = {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  memberCount: number;
};

Page({
  data: {
    currentFamily: null as FamilyView | null,
    families: [] as FamilyView[],
    loaded: false,
  },

  /** 监听页面显示 */
  onShow(): void {
    this.loadData();
    // 订阅当前家庭变化
    this._familyUnsubscribe = currentFamilyStore.subscribe((family) => {
      this.setData({ currentFamily: family as FamilyView | null });
    });
    this._familiesUnsubscribe = familiesStore.subscribe((families) => {
      this.setData({ families: families as FamilyView[], loaded: true });
    });
  },

  /** 取消订阅 */
  onHide(): void {
    if (this._familyUnsubscribe) this._familyUnsubscribe();
    if (this._familiesUnsubscribe) this._familiesUnsubscribe();
  },

  _familyUnsubscribe: null as (() => void) | null,
  _familiesUnsubscribe: null as (() => void) | null,

  async loadData(): Promise<void> {
    try {
      const families = await loadFamilies();
      const currentFamily = currentFamilyStore.value;

      this.setData({
        families: families as FamilyView[],
        currentFamily: currentFamily as FamilyView | null,
        loaded: true,
      });

      // 同步 globalData
      const app = getApp<IAppOption>();
      if (app) {
        app.globalData.families = families;
        app.globalData.currentFamily = currentFamily;
      }
    } catch (e) {
      console.error('[Home] Load data failed:', e);
      this.setData({ loaded: true });
    }
  },

  /** 切换家庭 */
  onSwitchFamily(): void {
    const { families, currentFamily } = this.data;
    if (!families || families.length <= 1) return;

    wx.showActionSheet({
      itemList: families.map(f => f.name),
      success: (res) => {
        const selected = families[res.tapIndex];
        if (selected.id !== currentFamily?.id) {
          setCurrentFamily(selected);
          showSuccess(`已切换到 ${selected.name}`);
        }
      },
    });
  },

  /** 进入家庭详情 */
  onViewDetail(): void {
    const { currentFamily } = this.data;
    if (!currentFamily) return;
    wx.navigateTo({
      url: `/pages/family/detail?familyId=${currentFamily.id}`,
    });
  },

  /** 创建家庭（内联输入名称，不允许固定名称） */
  async onCreateFamily(): Promise<void> {
    const res = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>((resolve) => {
      wx.showModal({
        title: '创建家庭',
        editable: true,
        placeholderText: '请输入家庭名称',
        success: resolve,
        fail: () => resolve({ confirm: false } as WechatMiniprogram.ShowModalSuccessCallbackResult),
      });
    });
    if (!res.confirm) return;

    const name = (res.content || '').trim();
    if (!name) {
      showError('请输入家庭名称');
      return;
    }

    showLoading('正在创建...');
    try {
      const result = await createFamily({ name });
      hideLoading();
      showSuccess('创建成功');

      // 刷新家庭列表并设置当前家庭
      const families = await loadFamilies();
      const newFamily = families.find(f => f.id === result.id) || result;
      setCurrentFamily(newFamily);
    } catch (error: unknown) {
      hideLoading();
      console.error('[Home] Create family failed:', error);
      const err = error as { code?: string; message?: string };
      showError(err?.message || '创建失败，请重试');
    }
  },

  /** 加入家庭 */
  onJoinFamily(): void {
    wx.navigateTo({
      url: '/pages/family/join',
    });
  },

  /** 新建日程（暂未开放） */
  onCreateEvent(): void {
    showError('功能即将上线');
  },

  /** 新建待办（暂未开放） */
  onCreateTask(): void {
    showError('功能即将上线');
  },
});
