/**
 * 首页
 *
 * 有家庭时：展示当前家庭的工作台
 * - 当前家庭头部（图片 / 名称 / 人数 / 切换）
 * - 今日日程（占位，查看全部进入日程 Tab）
 * - 待办任务（占位，查看全部进入待办 Tab）
 *
 * 无家庭时：保留创建 / 加入家庭引导。
 *
 * 家庭管理（创建、加入、详情、成员、邀请）统一收归「我的」，
 * 首页只负责当前家庭的日常协作入口。
 */

import { currentFamilyStore, familiesStore, loadFamilies, setCurrentFamily, restoreCurrentFamily } from '../../stores/index';
import { showSuccess, showError } from '../../utils/index';

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
    canSwitch: false,
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
      const cf = currentFamilyStore.value;
      this.setData({
        families: families as FamilyView[],
        canSwitch: (families as FamilyView[]).length > 1,
        loaded: true,
        currentFamily: (cf as FamilyView | null),
      });
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
      // 确保当前家庭已恢复并有效
      const current = restoreCurrentFamily(families) || currentFamilyStore.value;
      this.setData({
        families: families as FamilyView[],
        currentFamily: current as FamilyView | null,
        canSwitch: families.length > 1,
        loaded: true,
      });

      // 同步 globalData
      const app = getApp<IAppOption>();
      if (app) {
        app.globalData.families = families;
        app.globalData.currentFamily = current;
      }
    } catch (e) {
      console.error('[Home] Load data failed:', e);
      this.setData({ loaded: true });
    }
  },

  /** 切换家庭（仅在多个家庭时可用） */
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

  /** 查看全部日程 */
  onViewEvents(): void {
    wx.switchTab({ url: '/pages/events/events' });
  },

  /** 查看全部待办 */
  onViewTasks(): void {
    wx.switchTab({ url: '/pages/tasks/tasks' });
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
